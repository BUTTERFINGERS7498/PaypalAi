import assert from 'node:assert/strict';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import test from 'node:test';
import { startServer, withDb } from './helpers/server.ts';
import { canonicalJson, sha256 } from './helpers/evidence.ts';
import { tamper } from './helpers/tamper.ts';

test('mandate signature independently verifies and edited limits retain verifiable immutable versions', async t => {
  const s = await startServer(t);
  const first = await s.mandate();
  assert.match(first.id, /^m_/);
  assert.equal(first.version, 1);
  assert.equal(first.status, 'active');
  assert.equal(first.signature.alg, 'ed25519');
  assert.equal(first.signature.note, 'Mandate Ledger demo key');
  const payload = canonicalJson({ id: first.id, version: first.version, owner: first.owner, limits: first.limits, created_at: first.created_at });
  assert.equal(first.signature.payload_hash, sha256(payload));
  const stored = withDb(s.database, db => db.prepare('SELECT public_key FROM signing_keys WHERE key_id=?').get(first.signature.key_id));
  assert(stored, 'Signing public key must exist');
  const publicText = String(stored.public_key);
  const key = createPublicKey(publicText.includes('BEGIN PUBLIC KEY') ? publicText : { key: Buffer.from(publicText, 'base64'), format: 'der', type: 'spki' });
  assert(verify(null, Buffer.from(payload), key, Buffer.from(first.signature.sig, 'base64')));
  const second = await s.post(`/api/mandates/${first.id}/limits`, { monthly_cap: '900.00', approval_above: '400.00' });
  assert.equal(second.version, 2);
  assert.notEqual(second.signature.sig, first.signature.sig);
  assert.equal((await s.get(`/api/mandates/${first.id}`)).version, 2);
  const versions = (await s.get(`/api/mandates/${first.id}/versions`)).versions;
  assert.equal(versions.length, 2);
  const retained = versions.find((v: any) => v.version === 1);
  assert.deepEqual(retained.limits, first.limits);
  assert.deepEqual(retained.signature, first.signature);
  for (const version of [1, 2]) {
    const result = await s.post(`/api/mandates/${first.id}/verify`, { version });
    assert.equal(result.valid, true);
    assert.equal(result.version, version);
    assert.equal(result.alg, 'ed25519');
    assert.equal(result.reason, null);
  }
  withDb(s.database, db => {
    assert.throws(() => db.prepare('UPDATE mandate_versions SET payload_hash=? WHERE mandate_id=? AND version=1').run('tampered', first.id));
    assert.throws(() => db.prepare('DELETE FROM mandate_versions WHERE mandate_id=? AND version=1').run(first.id));
  });
});

test('verify detects a directly corrupted signed mandate payload', async t => {
  const s = await startServer(t);
  const mandate = await s.mandate();
  tamper(s.database, 'mandate_versions', db => {
    db.prepare('UPDATE mandate_versions SET limits=? WHERE mandate_id=? AND version=1')
      .run(JSON.stringify({ ...mandate.limits, monthly_cap: '9999.00' }), mandate.id);
  });
  const result = await s.post(`/api/mandates/${mandate.id}/verify`);
  assert.equal(result.valid, false);
  assert.equal(typeof result.reason, 'string');
});

test('revocation appends one record and rejects later agent instructions', async t => {
  const s = await startServer(t);
  const mandate = await s.mandate();
  const before = (await s.get('/api/evidence?limit=500')).records;
  const revoked = await s.post(`/api/mandates/${mandate.id}/revoke`);
  assert.equal(revoked.status, 'revoked');
  assert(revoked.revoked_at);
  const after = (await s.get('/api/evidence?limit=500')).records;
  assert.equal(after.length, before.length + 1);
  assert.equal(after.at(-1).decision, 'mandate_revoked');
  assert.equal(after.at(-1).mandate.id, mandate.id);
  const error = await s.post('/api/agent/instructions', { mandate_id: mandate.id, text: 'buy sku GRO-OAT-01' }, 409);
  assert.equal(error.error.code, 'mandate_inactive');
  assert.equal((await s.get(`/api/purchases?mandate_id=${mandate.id}`)).purchases.length, 0);
});

test('protected mandate writes reject absent credentials and accept a generated test token', async t => {
  const s = await startServer(t, { approvalToken: randomBytes(32).toString('hex') });
  const denied = await s.request('POST', '/api/mandates', { label: 'QA', limits: { monthly_cap: '10.00', categories: ['groceries'], approval_above: '5.00' } }, 401, false);
  assert.equal(denied.error.code, 'unauthorized');
  assert.equal(typeof denied.error.message, 'string');
  assert.equal(typeof denied.error.details, 'object');
  assert.equal((await s.mandate()).status, 'active');
});
