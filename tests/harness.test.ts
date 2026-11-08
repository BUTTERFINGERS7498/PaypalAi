import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers/server.ts';
import { canonicalJson, assertChain, sha256 } from './helpers/evidence.ts';
import { orderApproved, captureEvent, disputeCreated, disputeUpdated, disputeResolved } from './helpers/webhooks.ts';

test('webhook builders supply all contract section 5 fields with unique replayable IDs', () => {
  const approved = orderApproved('QA-ORDER');
  assert.equal(approved.event_type, 'CHECKOUT.ORDER.APPROVED');
  assert.equal(approved.resource_type, 'checkout-order');
  assert.deepEqual(approved.resource, { id: 'QA-ORDER' });
  assert.notEqual(orderApproved('QA-ORDER').id, approved.id);
  assert.equal(orderApproved('QA-ORDER', approved.id).id, approved.id);
  assert.equal(new Date(approved.create_time).toISOString(), approved.create_time);
  for (const status of ['COMPLETED', 'DENIED'] as const) {
    const event = captureEvent('QA-ORDER', 'QA-CAPTURE', status);
    assert.equal(event.event_type, `PAYMENT.CAPTURE.${status}`);
    assert.deepEqual(event.resource, { id: 'QA-CAPTURE', supplementary_data: { related_ids: { order_id: 'QA-ORDER' } } });
  }
  const created = disputeCreated('QA-ORDER', 'QA-DISPUTE');
  assert.equal(created.event_type, 'CUSTOMER.DISPUTE.CREATED');
  assert.deepEqual(created.resource, {
    dispute_id: 'QA-DISPUTE', reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    dispute_amount: { currency_code: 'USD', value: '4.50' },
    disputed_transactions: [{ seller_transaction_id: 'QA-ORDER' }],
  });
  assert.deepEqual(disputeUpdated('QA-DISPUTE').resource, { dispute_id: 'QA-DISPUTE', status: 'WAITING_FOR_SELLER_RESPONSE' });
  assert.equal(disputeUpdated('QA-DISPUTE').event_type, 'CUSTOMER.DISPUTE.UPDATED');
  assert.equal(disputeResolved('QA-DISPUTE').event_type, 'CUSTOMER.DISPUTE.RESOLVED');
  assert.deepEqual(disputeResolved('QA-DISPUTE').resource, { dispute_id: 'QA-DISPUTE' });
});

test('independent evidence oracle sorts recursively and detects hash and link corruption', () => {
  assert.equal(canonicalJson({ z: [{ b: 2, a: 1 }], a: null }), '{"a":null,"z":[{"a":1,"b":2}]}');
  const body = { seq: 1, prev_hash: '0'.repeat(64), data: { b: 2, a: 1 } };
  const first = { ...body, hash: sha256(`${body.prev_hash}\n${canonicalJson(body)}`) };
  assertChain([first]);
  assert.throws(() => assertChain([{ ...first, data: { b: 3, a: 1 } }]));
  assert.throws(() => assertChain([{ ...first, prev_hash: 'f'.repeat(64) }]));
});

test('mock preload blocks and records outbound I/O before application code runs', async t => {
  const scratch = join(root, 'tests', '.tmp');
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'guard-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const audit = join(dir, 'network.log');
  const script = `
    import net from 'node:net'; import tls from 'node:tls'; import { request } from 'node:https';
    import dns from 'node:dns'; import http2 from 'node:http2'; import dgram from 'node:dgram';
    import { spawn } from 'node:child_process';
    const probes = [
      () => fetch('https://example.invalid'), () => net.connect(443, 'example.invalid'),
      () => tls.connect(443, 'example.invalid'), () => request('https://example.invalid'),
      () => dns.lookup('example.invalid', () => {}), () => dns.promises.resolve('example.invalid'),
      () => http2.connect('https://example.invalid'), () => dgram.createSocket('udp4'),
      () => spawn(process.execPath, ['--version']), () => new WebSocket('wss://example.invalid'),
    ];
    for (const probe of probes) {
      let blocked = false;
      try { await probe(); } catch (error) { blocked = error.message.startsWith('QA_OUTBOUND_BLOCKED:'); }
      if (!blocked) process.exit(2);
    }
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => server.close());
  `;
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(root, 'tests/helpers/no-network.mjs')).href, '--input-type=module', '--eval', script], {
    env: { ...Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]])), QA_NETWORK_AUDIT: audit },
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, 'Guard probes must all fail closed and local server listen must work');
  assert.deepEqual((await readFile(audit, 'utf8')).trim().split('\n'), ['fetch', 'net', 'tls', 'http', 'dns', 'dns', 'http2', 'udp', 'subprocess', 'websocket']);
});
