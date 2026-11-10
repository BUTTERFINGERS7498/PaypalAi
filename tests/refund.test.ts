// Feature B1: refund on breach. In-process with the mock PayPal client, so every PayPal call can be inspected.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServices } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { MockPaypalClient } from '../src/server/paypal/mock.ts';
import { mintTicket } from '../src/server/paypal/ticket.ts';
import { HttpError } from '../src/server/util.ts';

function boot() {
  const cfg = loadConfig({ PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off', DATABASE_PATH: ':memory:' });
  const s = createServices(cfg);
  const ins = s.db.prepare("INSERT INTO catalog_items (sku,name,category,price_value,currency_code,merchant) VALUES (?, ?, ?, ?, 'USD', 'Demo')");
  for (const [sku, name, cat, price] of [['GRO-OAT-01', 'Rolled oats 1kg', 'groceries', '4.50'], ['ELE-GAME-01', 'Games console', 'electronics', '299.00']]) ins.run(sku, name, cat, price);
  const mandate = s.mandates.create({ label: 'groceries', limits: { monthly_cap: '400', categories: ['groceries'], approval_above: '350' } });
  return { s, mandate, paypal: s.paypal as MockPaypalClient };
}

/** Agent buys, the buyer approves at (mock) PayPal, the gate captures: a completed purchase with a capture id. */
async function completedPurchase(b: ReturnType<typeof boot>, text: string, rogue: boolean) {
  const r = await b.s.agent.handle({ mandate_id: b.mandate.id, text, demo_rogue: rogue });
  assert.equal(r.outcome, 'awaiting_payer', r.reply);
  const p = await b.s.gate.onOrderApproved(r.purchase!.paypal_order_id!);
  assert.equal(p?.status, 'completed');
  return p!;
}

test('a MANDATE_BREACH dispute refunds the capture at PayPal, restores the budget and records it in the chain', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  assert.equal(b.s.store.spentMoney(b.mandate.id), '299.00');

  const d = b.s.disputes.simulate(p.id);
  const assembled = await b.s.disputes.assemble(d.id);
  assert.equal(assembled.packet!.verdict, 'MANDATE_BREACH');
  const submitted = await b.s.disputes.submit(d.id, 'qa');

  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.packet!.paypal_response!.simulated, true, 'no PayPal dispute exists for a simulated one');
  const refund = submitted.packet!.refund!;
  assert.match(refund.paypal_refund_id, /^REFUND-MOCK-/);
  assert.equal(refund.source, 'refund_api');
  assert.deepEqual(refund.amount, { currency_code: 'USD', value: '299.00' });

  assert.equal(b.s.store.getPurchase(p.id)!.status, 'refunded');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '0.00', 'a refunded purchase no longer counts against the cap');

  const call = b.paypal.calls.find((c) => c.op === 'refund')!;
  assert.equal(call.subject_id, d.id, 'the ticket was minted for the dispute');
  assert.equal(call.target, p.paypal_capture_id);

  const ev = b.s.evidence.forPurchase(p.id).find((e) => e.decision === 'refunded')!;
  assert.equal(ev.data.paypal_refund_id, refund.paypal_refund_id);
  assert.equal(ev.data.authorised_by, 'human:qa');
  assert.equal(ev.budget_before, '299.00');
  assert.equal(ev.budget_after, '0.00');
  assert.equal(b.s.evidence.verify().valid, true);
});

test('a DEFENSIBLE dispute never refunds', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku GRO-OAT-01', false);
  const d = b.s.disputes.simulate(p.id);
  assert.equal((await b.s.disputes.assemble(d.id)).packet!.verdict, 'DEFENSIBLE');
  const submitted = await b.s.disputes.submit(d.id, 'qa');
  assert.equal(submitted.packet!.refund, null);
  assert.equal(b.paypal.calls.filter((c) => c.op === 'refund').length, 0);
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'disputed');
  // And the gate refuses outright if asked directly.
  await assert.rejects(() => b.s.gate.refundForBreach(b.s.store.getDispute(d.id)!, submitted.packet!, 'qa'), /Only a MANDATE_BREACH/);
});

test('if PayPal refuses the refund, the dispute is not marked submitted and the failure is in the evidence', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  b.s.store.updatePurchase(p.id, { paypal_capture_id: 'CAP-TEST-NOREFUND' });
  const d = b.s.disputes.simulate(p.id);
  await b.s.disputes.assemble(d.id);
  await assert.rejects(() => b.s.disputes.submit(d.id, 'qa'), (e: unknown) => e instanceof HttpError && e.status === 502 && /refused the refund/.test(e.message));
  assert.equal(b.s.store.getDispute(d.id)!.status, 'evidence_assembled', 'still open, so it can be retried');
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'disputed');
  const failed = b.s.evidence.forPurchase(p.id).find((e) => e.decision === 'refund_failed')!;
  assert.match(String((failed.data.error as { message: string }).message), /refused the refund/);
  assert.equal(b.s.evidence.verify().valid, true);
});

test('a retried refund is idempotent, and a second refund of the same capture is refused', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  const t1 = mintTicket('dsp_x', 'human:qa');
  const req = { amount: { currency_code: 'USD', value: '299.00' }, note: 'test', requestId: 'dsp_x' };
  const a = await b.paypal.refundCapture(t1, p.paypal_capture_id!, req);
  const again = await b.paypal.refundCapture(t1, p.paypal_capture_id!, req);
  assert.equal(again.paypal_refund_id, a.paypal_refund_id, 'same request id -> same refund');
  await assert.rejects(() => b.paypal.refundCapture(t1, p.paypal_capture_id!, { ...req, requestId: 'other' }), /CAPTURE_FULLY_REFUNDED/);
});

test('a refund needs a ticket minted by the gate', async () => {
  const b = boot();
  const forged = Object.freeze({ subject_id: 'dsp_x', authorised_by: 'human:me' });
  await assert.rejects(() => b.paypal.refundCapture(forged, 'CAP-1', { amount: { currency_code: 'USD', value: '1.00' }, note: 'x', requestId: 'x' }), /no approved ticket/);
});

test('a real PayPal dispute is not refunded by Sentry (PayPal refunds on accept-claim); the webhook records it once', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  const d = b.s.disputes.open({ paypal_dispute_id: 'PP-D-1', simulated: false, purchase: p, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', amount: p.amount });
  await b.s.disputes.assemble(d.id);
  const submitted = await b.s.disputes.submit(d.id, 'qa');
  assert.equal(submitted.packet!.refund, null);
  assert.ok(b.paypal.calls.some((c) => c.op === 'accept_claim'));
  assert.equal(b.paypal.calls.filter((c) => c.op === 'refund').length, 0, 'no second refund on top of PayPal\'s own');

  const event = (id: string) => ({
    id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource_type: 'refund',
    resource: {
      id: 'REF-PP-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '299.00' },
      seller_payable_breakdown: { total_refunded_amount: { currency_code: 'USD', value: '299.00' } },
      links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${p.paypal_capture_id}` }],
    },
  });
  await b.s.webhooks.handle({}, event('WH-R-1'));
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'refunded');
  await b.s.webhooks.handle({}, event('WH-R-2')); // a second, different delivery about the same refund
  const refunds = b.s.evidence.forPurchase(p.id).filter((e) => e.decision === 'refunded');
  assert.equal(refunds.length, 1, 'recorded once');
  assert.equal(refunds[0].data.source, 'accept_claim');
  assert.equal(refunds[0].data.paypal_refund_id, 'REF-PP-1');
});

test('a partial refund from PayPal is recorded but the purchase still counts against the cap', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  const ev = (id: string, value: string, total: string) => ({
    id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource_type: 'refund',
    resource: {
      id: `REF-${id}`, status: 'COMPLETED', amount: { currency_code: 'USD', value },
      seller_payable_breakdown: { total_refunded_amount: { currency_code: 'USD', value: total } },
      links: [{ rel: 'up', href: `https://api.sandbox.paypal.com/v2/payments/captures/${p.paypal_capture_id}` }],
    },
  });
  await b.s.webhooks.handle({}, ev('WH-P-1', '100.00', '100.00'));
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'completed', 'a partial refund does not free the whole amount');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '299.00');
  const partial = b.s.evidence.forPurchase(p.id).find((e) => e.decision === 'refunded')!;
  assert.equal(partial.data.final, false);
  // The rest arrives: now the total covers the purchase, so it is refunded and the budget is restored.
  await b.s.webhooks.handle({}, ev('WH-P-2', '199.00', '299.00'));
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'refunded');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '0.00');
});

test('a PENDING refund is recorded but keeps counting until PayPal completes it', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  b.s.store.updatePurchase(p.id, { paypal_capture_id: 'CAP-TEST-PENDING' });
  const d = b.s.disputes.simulate(p.id);
  await b.s.disputes.assemble(d.id);
  const submitted = await b.s.disputes.submit(d.id, 'qa');
  assert.equal(submitted.packet!.refund!.status, 'PENDING');
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'disputed', 'not refunded yet');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '299.00');
  // PayPal later completes it.
  await b.s.webhooks.handle({}, {
    id: 'WH-PEND-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource_type: 'refund',
    resource: { id: submitted.packet!.refund!.paypal_refund_id, status: 'COMPLETED', amount: { currency_code: 'USD', value: '299.00' },
      links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAP-TEST-PENDING' }] },
  });
  assert.equal(b.s.store.getPurchase(p.id)!.status, 'refunded');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '0.00');
});

test('a refund PayPal reports as FAILED leaves the dispute open and the budget unchanged', async () => {
  const b = boot();
  const p = await completedPurchase(b, 'buy sku ELE-GAME-01', true);
  b.s.store.updatePurchase(p.id, { paypal_capture_id: 'CAP-TEST-REFUNDFAILS' });
  const d = b.s.disputes.simulate(p.id);
  await b.s.disputes.assemble(d.id);
  await assert.rejects(() => b.s.disputes.submit(d.id, 'qa'), (e: unknown) => e instanceof HttpError && e.status === 502);
  assert.equal(b.s.store.getDispute(d.id)!.status, 'evidence_assembled');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '299.00');
  assert.ok(b.s.evidence.forPurchase(p.id).some((e) => e.decision === 'refund_failed' && e.data.paypal_status === 'FAILED'));
});
