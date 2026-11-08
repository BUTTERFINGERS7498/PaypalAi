import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from './helpers/server.ts';
import { assertDecision } from './helpers/evidence.ts';

test('category breach blocks the choice with exactly one decision and no purchase or approval', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const before = (await s.get('/api/evidence?limit=500')).records.length;
  const result = await s.instruct(m.id, 'QA-ELE-129');
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.purchase, null);
  assert.equal(result.approval, null);
  assert.equal((await s.get(`/api/purchases?mandate_id=${m.id}`)).purchases.length, 0);
  assert.equal((await s.get('/api/approvals?status=pending')).approvals.length, 0);
  const records = (await s.get('/api/evidence?limit=500')).records;
  assert.equal(records.length, before + 1);
  const record = await s.get(`/api/evidence/${result.evidence_record_id}`);
  assertDecision(record, m, 'blocked');
  assert.equal(record.within_mandate, false);
  assert.deepEqual(record.breaches, ['category_not_allowed']);
  assert.equal(record.paypal_order_id, null);
  assert.equal(record.budget_before, '0.00');
  assert.equal(record.budget_after, '129.00');
});

test('above threshold queues approval without checkout; approval executes once', async t => {
  const s = await startServer(t);
  const m = await s.mandate({ approval_above: '40.00' });
  const result = await s.instruct(m.id, 'QA-GRO-42');
  assert.equal(result.outcome, 'needs_approval');
  assert.equal(result.purchase.status, 'pending_approval');
  assert.equal(result.purchase.paypal_order_id, null);
  assert.equal(result.purchase.paypal_capture_id, null);
  assert.equal(result.approval.status, 'pending');
  assert.deepEqual(result.approval.reasons, ['above_approval_threshold']);
  assert.deepEqual(result.purchase.breaches, []);
  const trail = (await s.get(`/api/purchases/${result.purchase.id}/evidence`)).records;
  assert.deepEqual(trail.map((r: any) => r.decision), ['needs_approval']);
  const approved = await s.post(`/api/approvals/${result.approval.id}/approve`, { decided_by: 'qa' });
  assert.equal(approved.approval.status, 'approved');
  assert.equal(approved.purchase.status, 'awaiting_payer');
  assert(approved.purchase.paypal_order_id);
  assert.equal(approved.purchase.paypal_capture_id, null);
  const replay = await s.post(`/api/approvals/${result.approval.id}/approve`, { decided_by: 'qa' }, 409);
  assert.equal(replay.error.code, 'invalid_state');
  const records = (await s.get(`/api/purchases/${result.purchase.id}/evidence`)).records;
  assert.deepEqual(records.map((r: any) => r.decision), ['needs_approval', 'approved', 'order_created']);
});

test('threshold and monthly cap are inclusive; awaiting payer reserves budget', async t => {
  const s = await startServer(t);
  const m = await s.mandate({ monthly_cap: '84.00', approval_above: '42.00' });
  for (let i = 0; i < 2; i++) {
    const result = await s.instruct(m.id, 'QA-GRO-42');
    assert.equal(result.outcome, 'awaiting_payer');
    assert.equal(result.approval, null);
  }
  const current = await s.get(`/api/mandates/${m.id}`);
  assert.equal(current.budget.spent, '84.00');
  assert.equal(current.budget.remaining, '0.00');
  assert.equal(current.budget.period, new Date().toISOString().slice(0, 7));
  const blocked = await s.instruct(m.id);
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.purchase, null);
  const record = await s.get(`/api/evidence/${blocked.evidence_record_id}`);
  assert.deepEqual(record.breaches, ['exceeds_monthly_cap']);
  assert.equal(record.budget_before, '84.00');
  assert.equal(record.budget_after, '88.50');
  assert.equal((await s.get(`/api/purchases?mandate_id=${m.id}`)).purchases.length, 2);
});

for (const reason of ['revoked', 'budget_consumed', 'category_changed'] as const) {
  test(`approval rechecks current mandate when ${reason}`, async t => {
    const s = await startServer(t);
    const m = await s.mandate({ monthly_cap: '60.00', approval_above: '40.00' });
    const pending = await s.instruct(m.id, 'QA-GRO-42');
    assert.equal(pending.outcome, 'needs_approval');
    let expected: string;
    if (reason === 'revoked') {
      await s.post(`/api/mandates/${m.id}/revoke`);
      expected = 'inactive_mandate';
    } else if (reason === 'category_changed') {
      await s.post(`/api/mandates/${m.id}/limits`, { categories: ['household'] });
      expected = 'category_not_allowed';
    } else {
      for (let i = 0; i < 5; i++) assert.equal((await s.instruct(m.id)).outcome, 'awaiting_payer');
      expected = 'exceeds_monthly_cap';
    }
    const result = await s.post(`/api/approvals/${pending.approval.id}/approve`, { decided_by: 'qa' });
    assert.equal(result.approval.status, 'approved');
    assert.equal(result.purchase.status, 'failed');
    assert(result.purchase.breaches.includes(expected));
    assert.equal(result.purchase.paypal_order_id, null);
    assert.equal(result.purchase.paypal_capture_id, null);
    const records = (await s.get(`/api/purchases/${pending.purchase.id}/evidence`)).records;
    assert.equal(records.filter((r: any) => r.decision === 'approved').length, 1);
    assert.equal(records.filter((r: any) => r.decision === 'order_created').length, 0);
  });
}

test('rejection is final, records evidence once, and never creates an order', async t => {
  const s = await startServer(t);
  const m = await s.mandate({ approval_above: '40.00' });
  const pending = await s.instruct(m.id, 'QA-GRO-42');
  const result = await s.post(`/api/approvals/${pending.approval.id}/reject`, { decided_by: 'qa', note: 'Declined' });
  assert.equal(result.approval.status, 'rejected');
  assert.equal(result.purchase.status, 'rejected');
  assert.equal(result.purchase.paypal_order_id, null);
  for (const action of ['reject', 'approve']) {
    assert.equal((await s.post(`/api/approvals/${pending.approval.id}/${action}`, { decided_by: 'qa' }, 409)).error.code, 'invalid_state');
  }
  assert.deepEqual((await s.get(`/api/purchases/${pending.purchase.id}/evidence`)).records.map((r: any) => r.decision), ['needs_approval', 'rejected']);
});

test('no match produces exactly one no_match decision without checkout', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const before = (await s.get('/api/evidence?limit=500')).records.length;
  const result = await s.instruct(m.id, 'QA-NONEXISTENT-SKU');
  assert.equal(result.outcome, 'no_match');
  assert.equal(result.purchase, null);
  assert.equal(result.approval, null);
  const record = await s.get(`/api/evidence/${result.evidence_record_id}`);
  assertDecision(record, m, 'no_match');
  assert.equal(record.choice, null);
  assert.equal(record.budget_before, record.budget_after);
  assert.equal((await s.get('/api/evidence?limit=500')).records.length, before + 1);
});
