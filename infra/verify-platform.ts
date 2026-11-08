// Platform-only smoke checks. QA owns tests/** and e2e/**.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { seedCatalog } from '../scripts/seed.ts';

const work = fileURLToPath(new URL('./.verification/', import.meta.url));
mkdirSync(work, { recursive: true });
const temp = mkdtempSync(join(work, 'schema-'));
assert.ok(resolve(temp).startsWith(resolve(work) + sep));
const db = new DatabaseSync(join(temp, 'fresh.db'));
try {
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  db.exec(schema);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).sort();
  assert.deepEqual(tables, ['agent_requests', 'approvals', 'catalog_items', 'disputes', 'evidence_records', 'mandate_versions', 'mandates', 'purchases', 'signing_keys', 'webhook_events']);
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'evidence_records_%_idx'").all() as { name: string }[]).map((r) => r.name).sort();
  assert.deepEqual(indexes, ['evidence_records_mandate_id_idx', 'evidence_records_paypal_order_id_idx', 'evidence_records_purchase_id_idx']);
  db.exec("INSERT INTO evidence_records (record_id, body) VALUES ('evd_schema_smoke', '{}')");
  db.exec("INSERT INTO mandate_versions (mandate_id, version) VALUES ('m_schema_smoke', 1)");
  for (const table of ['evidence_records', 'mandate_versions']) {
    assert.throws(() => db.exec(`UPDATE ${table} SET ${table === 'evidence_records' ? 'body' : 'limits'} = '{}'`), /append-only/);
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /append-only/);
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 1);
  }
  seedCatalog(db);
  seedCatalog(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM catalog_items').get() as { n: number }).n, 14);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE category='groceries'").get() as { n: number }).n, 10);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE price_value IN ('42.00','51.00')").get() as { n: number }).n, 2);
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const name of ['PAYPAL_ENV', 'PAYPAL_MODE', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BUYER_EMAIL', 'PAYPAL_WEBHOOK_ID', 'WEBHOOK_VERIFY', 'CHECKOUT_MODE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'AGENT_MODE', 'APPROVAL_TOKEN', 'MANDATE_SIGNING_KEY', 'DATABASE_PATH', 'PORT', 'PUBLIC_BASE_URL']) {
    assert.ok(new RegExp(`^${name}=`, 'm').test(env), `Missing env name: ${name}`);
  }
  console.log(JSON.stringify({ schema_applications: 2, tables: tables.length, evidence_indexes: indexes.length, append_only_operations_rejected: 4, catalog_seed_runs: 2, catalog_items: 14, environment_names_present: 17 }));
} finally {
  db.close();
  rmSync(temp, { recursive: true, force: true });
}
