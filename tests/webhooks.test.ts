import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from './helpers/server.ts';
import { envelope, orderApproved, captureEvent, disputeCreated, disputeUpdated, disputeResolved } from './helpers/webhooks.ts';

test('approved webhook captures once; replay and later capture completion do not duplicate evidence', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const result = await s.instruct(m.id);
  const event = orderApproved(result.purchase.paypal_order_id);
  assert.deepEqual(await s.post('/webhooks/paypal', event), { received: true, duplicate: false });
  const completed = await s.get(`/api/purchases/${result.purchase.id}`);
  assert.equal(completed.status, 'completed');
  assert(completed.paypal_capture_id);
  const before = (await s.get('/api/evidence?limit=500')).records;
  assert.deepEqual(await s.post('/webhooks/paypal', event), { received: true, duplicate: true });
  await s.post('/webhooks/paypal', captureEvent(completed.paypal_order_id, completed.paypal_capture_id, 'COMPLETED'));
  const after = (await s.get('/api/evidence?limit=500')).records;
  assert.deepEqual(after, before);
  assert.equal(after.filter((r: any) => r.purchase_id === completed.id && r.decision === 'captured').length, 1);
  const events = (await s.get('/api/webhooks?limit=50')).events;
  assert.equal(events.filter((e: any) => e.id === event.id).length, 1);
  const stored = events.find((e: any) => e.id === event.id);
  assert.equal(stored.processed, true);
  assert.equal(stored.verified, false);
  assert.equal(stored.purchase_id, completed.id);
});

for (const status of ['COMPLETED', 'DENIED'] as const) {
  test(`capture ${status.toLowerCase()} webhook links by related order id`, async t => {
    const s = await startServer(t);
    const m = await s.mandate();
    const result = await s.instruct(m.id);
    const event = captureEvent(result.purchase.paypal_order_id, 'QA-CAPTURE-1', status);
    await s.post('/webhooks/paypal', event);
    const purchase = await s.get(`/api/purchases/${result.purchase.id}`);
    assert.equal(purchase.status, status === 'COMPLETED' ? 'completed' : 'failed');
    if (status === 'COMPLETED') {
      assert.equal(purchase.paypal_capture_id, 'QA-CAPTURE-1');
      assert(purchase.completed_at);
    }
    const before = (await s.get('/api/evidence?limit=500')).records;
    assert.equal((await s.post('/webhooks/paypal', event)).duplicate, true);
    assert.deepEqual((await s.get('/api/evidence?limit=500')).records, before);
  });
}

test('unknown order and dispute ids are stored unprocessed; unknown types are stored without ledger changes', async t => {
  const s = await startServer(t);
  const before = (await s.get('/api/evidence?limit=500')).records;
  const unknown = [
    orderApproved('QA-UNKNOWN-ORDER'),
    captureEvent('QA-UNKNOWN-ORDER', 'QA-UNKNOWN-CAPTURE', 'COMPLETED'),
    disputeCreated('QA-UNKNOWN-ORDER', 'QA-UNKNOWN-DISPUTE'),
    disputeUpdated('QA-UNKNOWN-DISPUTE'),
    disputeResolved('QA-UNKNOWN-DISPUTE'),
  ];
  for (const event of unknown) {
    assert.deepEqual(await s.post('/webhooks/paypal', event), { received: true, duplicate: false });
  }
  const unknownType = envelope('QA.UNKNOWN', 'qa', {});
  await s.post('/webhooks/paypal', unknownType);
  const events = (await s.get('/api/webhooks?limit=50')).events;
  for (const event of unknown) {
    const stored = events.find((e: any) => e.id === event.id);
    assert(stored);
    assert.equal(stored.processed, false);
    assert.equal(stored.error, 'unknown_purchase');
    assert.equal(stored.verified, false);
  }
  assert(events.some((e: any) => e.id === unknownType.id));
  assert.deepEqual((await s.get('/api/evidence?limit=500')).records, before);
});

test('dispute webhooks create, update, and resolve the linked purchase without extra evidence', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const result = await s.instruct(m.id);
  await s.post('/webhooks/paypal', orderApproved(result.purchase.paypal_order_id));
  const before = (await s.get('/api/evidence?limit=500')).records;
  const created = disputeCreated(result.purchase.paypal_order_id, 'QA-PP-D-1');
  await s.post('/webhooks/paypal', created);
  const disputes = (await s.get('/api/disputes')).disputes;
  const dispute = disputes.find((d: any) => d.paypal_dispute_id === 'QA-PP-D-1');
  assert(dispute);
  assert.equal(dispute.purchase_id, result.purchase.id);
  assert.equal(dispute.simulated, false);
  assert.equal(dispute.status, 'open');
  assert.equal((await s.get(`/api/purchases/${result.purchase.id}`)).status, 'disputed');
  assert.equal((await s.post('/webhooks/paypal', created)).duplicate, true);
  const updated = disputeUpdated('QA-PP-D-1');
  await s.post('/webhooks/paypal', updated);
  const events = (await s.get('/api/webhooks?limit=50')).events;
  assert.equal(events.find((e: any) => e.id === updated.id).processed, true);
  assert.equal((await s.get('/api/disputes')).disputes.filter((d: any) => d.paypal_dispute_id === 'QA-PP-D-1').length, 1);
  await s.post('/webhooks/paypal', disputeResolved('QA-PP-D-1'));
  assert.equal((await s.get(`/api/disputes/${dispute.id}`)).status, 'resolved');
  assert.equal((await s.get(`/api/purchases/${result.purchase.id}`)).status, 'dispute_resolved');
  assert.equal((await s.get(`/api/mandates/${m.id}`)).budget.spent, '4.50');
  assert.deepEqual((await s.get('/api/evidence?limit=500')).records, before);
});
