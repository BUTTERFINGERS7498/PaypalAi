import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer, withDb } from './helpers/server.ts';
import { assertChain, assertDecision } from './helpers/evidence.ts';
import { tamper } from './helpers/tamper.ts';
import { orderApproved } from './helpers/webhooks.ts';

test('evidence is independently hash chained, immutable, paginated, and filterable', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const result = await s.instruct(m.id);
  await s.post('/webhooks/paypal', orderApproved(result.purchase.paypal_order_id));
  const all = (await s.get('/api/evidence?limit=500')).records;
  assertChain(all);
  const decisions = all.filter((r: any) => r.record_id === result.evidence_record_id);
  assert.equal(decisions.length, 1);
  assertDecision(decisions[0], m, 'selected');
  assert.equal(decisions[0].budget_before, '0.00');
  assert.equal(decisions[0].budget_after, '4.50');
  assert.equal(decisions[0].choice.sku, 'GRO-OAT-01');
  assert.equal(decisions[0].choice.price, '4.50');
  assert(decisions[0].options_seen.some((o: any) => o.sku === 'GRO-OAT-01' && o.price === '4.50'));
  const check = await s.get('/api/evidence/verify');
  assert.equal(check.valid, true);
  assert.equal(check.checked, all.length);
  assert.equal(check.head_hash, all.at(-1).hash);
  assert.equal(check.broken_at_seq, null);
  const page = await s.get('/api/evidence?after_seq=0&limit=1');
  assert.equal(page.records.length, 1);
  assert.equal(page.next_seq, page.records[0].seq);
  const next = await s.get(`/api/evidence?after_seq=${page.next_seq}&limit=500`);
  assert.deepEqual([...page.records, ...next.records], all);
  for (const [filter, value] of [['purchase_id', result.purchase.id], ['mandate_id', m.id], ['order_id', result.purchase.paypal_order_id]]) {
    const records = (await s.get(`/api/evidence?${filter}=${encodeURIComponent(value)}&limit=500`)).records;
    assert(records.length > 0);
    for (const r of records) assert.equal(filter === 'mandate_id' ? r.mandate.id : r[filter === 'order_id' ? 'paypal_order_id' : filter], value);
  }
  withDb(s.database, db => {
    assert.throws(() => db.prepare('UPDATE evidence_records SET body=? WHERE seq=?').run('{}', all[0].seq));
    assert.throws(() => db.prepare('DELETE FROM evidence_records WHERE seq=?').run(all[0].seq));
  });
  assert.equal((await s.get('/api/evidence/verify')).valid, true);
});

test('direct evidence corruption reports the first broken seq and forces an honest dispute verdict', async t => {
  const s = await startServer(t);
  const m = await s.mandate();
  const result = await s.instruct(m.id);
  await s.post('/webhooks/paypal', orderApproved(result.purchase.paypal_order_id));
  const all = (await s.get('/api/evidence?limit=500')).records;
  assert(all.length >= 3);
  const target = all[1];
  tamper(s.database, 'evidence_records', db => {
    db.prepare('UPDATE evidence_records SET body=? WHERE seq=?').run(JSON.stringify({ ...target, rationale: 'QA corruption' }), target.seq);
  });
  const check = await s.get('/api/evidence/verify');
  assert.equal(check.valid, false);
  assert.equal(check.broken_at_seq, target.seq);
  assert.equal((await s.get(`/api/purchases/${result.purchase.id}/evidence`)).chain_valid, false);
  const dispute = await s.post('/api/disputes/simulate', { purchase_id: result.purchase.id }, 201);
  const assembled = await s.post(`/api/disputes/${dispute.id}/assemble`);
  assert.equal(assembled.packet.chain_valid, false);
  assert.equal(assembled.packet.verdict, 'MANDATE_BREACH');
  assert.equal(assembled.packet.action, 'accept_claim');
});
