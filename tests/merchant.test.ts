// Feature B8: the proof a merchant checks before shipping an agent's order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from './helpers/server.ts';
import { tamper } from './helpers/tamper.ts';
import { orderApproved } from './helpers/webhooks.ts';

test('proof: ship when paid and in mandate, wait when not captured, do not ship when outside the mandate', async (t) => {
  const s = await startServer(t);
  const m = await s.mandate();
  const ok = await s.instruct(m.id);
  const waiting = await s.get(`/api/purchases/${ok.purchase.id}/proof`);
  assert.equal(waiting.recommendation, 'wait');
  assert.match(waiting.reasons[0], /not captured yet/);

  await s.post('/webhooks/paypal', orderApproved(ok.purchase.paypal_order_id));
  const ship = await s.get(`/api/purchases/${ok.purchase.id}/proof`);
  assert.equal(ship.recommendation, 'ship');
  assert.equal(ship.mandate.signature.valid, true);
  assert.equal(ship.mandate.version, ok.purchase.mandate_version);
  assert.equal(ship.chain.valid, true);
  assert.ok(ship.evidence.count >= 3);

  const rogue = await s.instruct(m.id, 'QA-ELE-129', true);
  await s.post('/webhooks/paypal', orderApproved(rogue.purchase.paypal_order_id));
  const no = await s.get(`/api/purchases/${rogue.purchase.id}/proof`);
  assert.equal(no.recommendation, 'do_not_ship');
  assert.ok(no.reasons.some((r: string) => /outside the mandate/.test(r)));
});

test('proof: a broken evidence chain means do not ship, even for an in-mandate paid order', async (t) => {
  const s = await startServer(t);
  const m = await s.mandate();
  const r = await s.instruct(m.id);
  await s.post('/webhooks/paypal', orderApproved(r.purchase.paypal_order_id));
  const all = (await s.get('/api/evidence?limit=500')).records;
  tamper(s.database, 'evidence_records', (db) => {
    db.prepare('UPDATE evidence_records SET body=? WHERE seq=?').run(JSON.stringify({ ...all[0], rationale: 'edited later' }), all[0].seq);
  });
  const proof = await s.get(`/api/purchases/${r.purchase.id}/proof`);
  assert.equal(proof.recommendation, 'do_not_ship');
  assert.ok(proof.reasons.some((x: string) => /chain is broken/.test(x)));
});
