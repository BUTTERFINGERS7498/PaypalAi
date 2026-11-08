// Runs the documented seed command twice and verifies persisted state via backend modules.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createServices } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'infra', '.verification');
mkdirSync(work, { recursive: true });
const temp = mkdtempSync(join(work, 'seed-'));
assert.ok(resolve(temp).startsWith(resolve(work) + sep));
const location = join(temp, 'demo.db');
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const env = { ...process.env, PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off', MANDATE_SIGNING_KEY: '', DATABASE_PATH: location };

const snapshot = () => {
  const db = new DatabaseSync(location);
  try {
    const s = createServices(loadConfig(env), db);
    const mandate = s.mandates.require('m_seed_groceries');
    assert.equal(mandate.status, 'active');
    assert.equal(mandate.limits.monthly_cap, '200.00');
    assert.equal(mandate.limits.approval_above, '75.00');
    assert.deepEqual(mandate.limits.categories, ['groceries']);
    assert.equal(s.mandates.verify(mandate.id).valid, true);
    assert.equal(s.evidence.verify().valid, true);
    const purchases = s.store.listPurchases({ mandate_id: mandate.id });
    assert.equal(purchases.length, 3);
    for (const purchase of purchases) {
      assert.equal(purchase.status, 'completed');
      assert.match(purchase.paypal_order_id ?? '', /^ORD-SEED-/);
      assert.match(purchase.paypal_capture_id ?? '', /^CAP-SEED-/);
      const records = s.evidence.forPurchase(purchase.id);
      assert.deepEqual(records.map((record) => record.decision), ['selected', 'order_created', 'captured']);
      assert.ok(records.every((record) => record.data.synthetic === true));
    }
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const counts = { catalog: count('catalog_items'), mandates: count('mandates'), versions: count('mandate_versions'), purchases: count('purchases'), evidence: count('evidence_records'), keys: count('signing_keys') };
    assert.deepEqual(counts, { catalog: 14, mandates: 1, versions: 1, purchases: 3, evidence: 9, keys: 1 });
    // Compare a digest only in memory. No key, signature, or raw DB row is printed.
    const keyDigest = createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM signing_keys').all())).digest('hex');
    return { counts, keyDigest, chain: s.evidence.verify().head_hash, signature: mandate.signature.sig };
  } finally {
    db.close();
  }
};

try {
  let first: ReturnType<typeof snapshot> | undefined;
  for (let run = 1; run <= 2; run++) {
    const child = spawnSync(process.execPath, [npmCli, 'run', 'seed'], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, `npm run seed run ${run} must succeed (output suppressed to avoid exposing credentials).`);
    const state = snapshot();
    if (first) assert.deepEqual(state, first, 'Second seed must preserve keys, signatures, chain and row counts.');
    else first = state;
  }
  console.log(JSON.stringify({ seed_runs: 2, idempotent: true, signed_mandate_verified: true, evidence_chain_valid: true, ...first!.counts }));
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
