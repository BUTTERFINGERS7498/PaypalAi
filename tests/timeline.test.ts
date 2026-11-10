// Feature B7: the PayPal events that arrived for one purchase, through the real HTTP server.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from './helpers/server.ts';
import { captureEvent, orderApproved } from './helpers/webhooks.ts';

test('a purchase lists the PayPal webhooks that arrived for it, oldest first, with verified and applied flags', async (t) => {
  const s = await startServer(t);
  const m = await s.mandate();
  const r = await s.instruct(m.id);
  const orderId = r.purchase.paypal_order_id;

  const empty = await s.get(`/api/purchases/${r.purchase.id}/webhooks`);
  assert.deepEqual(empty.events, []);
  assert.equal(empty.webhook_verify, 'off', 'the test server runs with WEBHOOK_VERIFY=off, and the UI says so');

  await s.post('/webhooks/paypal', orderApproved(orderId, 'WH-T-1'));
  await s.post('/webhooks/paypal', captureEvent(orderId, 'CAP-T-1', 'COMPLETED', 'WH-T-2'));
  await s.post('/webhooks/paypal', orderApproved('ORD-NOT-OURS', 'WH-T-3')); // belongs to no purchase

  const { events } = await s.get(`/api/purchases/${r.purchase.id}/webhooks`);
  assert.deepEqual(events.map((e: any) => e.id), ['WH-T-1', 'WH-T-2']);
  assert.deepEqual(events.map((e: any) => e.event_type), ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED']);
  for (const e of events) {
    assert.equal(e.processed, true);
    assert.equal(e.verified, false);
    assert.equal(e.purchase_id, r.purchase.id);
  }
  assert.equal((await s.request('GET', '/api/purchases/pur_nope/webhooks', undefined, 404)).error.code, 'not_found');
});
