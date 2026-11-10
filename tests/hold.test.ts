// Feature B2: authorize, then capture. A purchase that needs human approval is HELD at PayPal (authorization), then
// captured on approve or voided on reject. In-process with the mock PayPal client.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServices } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { MockPaypalClient } from '../src/server/paypal/mock.ts';

function boot(env: Record<string, string> = {}) {
  const cfg = loadConfig({
    PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off', DATABASE_PATH: ':memory:',
    CHECKOUT_MODE: 'card', APPROVAL_HOLD: 'authorize', ...env,
  });
  const s = createServices(cfg);
  const ins = s.db.prepare("INSERT INTO catalog_items (sku,name,category,price_value,currency_code,merchant) VALUES (?, ?, ?, ?, 'USD', 'Demo')");
  for (const [sku, name, price] of [['GRO-OAT-01', 'Rolled oats 1kg', '4.50'], ['GRO-PANTRY-42', 'Pantry basics bundle', '42.00'], ['GRO-BIG-FAIL', 'Doomed bundle', '50.00']]) ins.run(sku, name, 'groceries', price);
  const mandate = s.mandates.create({ label: 'groceries', limits: { monthly_cap: '200', categories: ['groceries'], approval_above: '20' } });
  return { s, mandate, paypal: s.paypal as MockPaypalClient };
}

async function heldPurchase(b: ReturnType<typeof boot>) {
  const r = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'buy sku GRO-PANTRY-42' });
  assert.equal(r.outcome, 'needs_approval', r.reply);
  return r;
}

test('a purchase above the approval line is held at PayPal, not charged, and the hold is in the evidence', async () => {
  const b = boot();
  const r = await heldPurchase(b);
  assert.equal(r.purchase!.status, 'pending_approval');
  assert.match(r.purchase!.paypal_authorization_id!, /^AUTH-MOCK-/);
  assert.match(r.reply, /held at PayPal until you decide/);
  assert.equal(b.s.store.spentMoney(b.mandate.id), '0.00', 'held money is not spent');
  const create = b.paypal.calls.find((c) => c.op === 'create_order')!;
  assert.deepEqual(create.detail, { intent: 'AUTHORIZE' });
  assert.equal(create.subject_id, r.purchase!.id);
  const ev = b.s.evidence.forPurchase(r.purchase!.id).find((e) => e.decision === 'authorized')!;
  assert.equal(ev.data.paypal_authorization_id, r.purchase!.paypal_authorization_id);
  assert.equal(ev.data.authorised_by, 'mandate:hold');
});

test('approving captures the held money', async () => {
  const b = boot();
  const r = await heldPurchase(b);
  const out = await b.s.gate.approve(r.approval!.id, 'qa', null);
  assert.equal(out.purchase.status, 'completed');
  assert.match(out.purchase.paypal_capture_id!, /^CAP-MOCK-/);
  assert.equal(b.s.store.spentMoney(b.mandate.id), '42.00');
  const cap = b.paypal.calls.find((c) => c.op === 'capture_authorization')!;
  assert.equal(cap.target, r.purchase!.paypal_authorization_id);
  const ev = b.s.evidence.forPurchase(r.purchase!.id).find((e) => e.decision === 'captured')!;
  assert.equal(ev.data.source, 'authorization');
  assert.equal(ev.data.authorised_by, 'human:qa');
  assert.equal(b.paypal.calls.filter((c) => c.op === 'create_order').length, 1, 'no second order: the hold is captured');
  assert.equal(b.s.evidence.verify().valid, true);
});

test('rejecting releases the held money', async () => {
  const b = boot();
  const r = await heldPurchase(b);
  const out = await b.s.gate.reject(r.approval!.id, 'qa', 'not needed');
  assert.equal(out.purchase.status, 'rejected');
  assert.ok(b.paypal.calls.some((c) => c.op === 'void_authorization' && c.target === r.purchase!.paypal_authorization_id));
  const ev = b.s.evidence.forPurchase(r.purchase!.id).find((e) => e.decision === 'voided')!;
  assert.equal(ev.data.reason, 'rejected');
  assert.equal(b.s.store.spentMoney(b.mandate.id), '0.00');
});

test('if the mandate no longer allows it at approval time, the hold is released and nothing is captured', async () => {
  const b = boot();
  const r = await heldPurchase(b);
  b.s.mandates.revoke(b.mandate.id);
  const out = await b.s.gate.approve(r.approval!.id, 'qa', null);
  assert.equal(out.purchase.status, 'failed');
  assert.ok(b.paypal.calls.some((c) => c.op === 'void_authorization'));
  assert.equal(b.paypal.calls.filter((c) => c.op === 'capture_authorization').length, 0);
  assert.equal(b.s.evidence.forPurchase(r.purchase!.id).find((e) => e.decision === 'voided')!.data.reason, 'mandate_recheck_failed');
});

test('if PayPal will not place the hold, the approval still works the old way and the failure is recorded', async () => {
  const b = boot();
  const r = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'buy sku GRO-BIG-FAIL' });
  assert.equal(r.outcome, 'needs_approval');
  assert.equal(r.purchase!.paypal_authorization_id, null);
  assert.match(r.reply, /Nothing was charged/);
  assert.ok(b.s.evidence.forPurchase(r.purchase!.id).some((e) => e.decision === 'order_failed' && e.data.stage === 'hold'));
});

test('holds are off by default, and need card checkout even when switched on', async () => {
  for (const env of [{ APPROVAL_HOLD: 'off' }, { CHECKOUT_MODE: 'payer_approval' }]) {
    const b = boot(env);
    const r = await heldPurchase(b);
    assert.equal(r.purchase!.paypal_authorization_id, null, JSON.stringify(env));
    assert.equal(r.purchase!.paypal_order_id, null, 'no order until a human approves, as before');
    assert.equal(b.paypal.calls.length, 0);
  }
});

test('a purchase under the approval line is not held: it checks out at once', async () => {
  const b = boot();
  const r = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'buy sku GRO-OAT-01' });
  assert.equal(r.outcome, 'purchased');
  assert.equal(r.purchase!.paypal_authorization_id, null);
});
