import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from './catalog.ts';

export function seedCatalog(db: DatabaseSync): void {
  const insert = db.prepare(`INSERT INTO catalog_items
    (sku, name, category, price_value, currency_code, merchant)
    VALUES (?, ?, ?, ?, 'USD', ?) ON CONFLICT(sku) DO NOTHING`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of catalog) insert.run(item.sku, item.name, item.category, item.value, item.merchant);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function seed(): Promise<void> {
  if (process.env.PAYPAL_ENV !== 'sandbox') throw new Error('Seed requires PAYPAL_ENV=sandbox.');
  const configuredPath = process.env.DATABASE_PATH?.trim() || './data/mandate.db';
  const location = configuredPath === ':memory:' ? configuredPath : resolve(fileURLToPath(new URL('../', import.meta.url)), configuredPath);
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    seedCatalog(db);
    const adapter = new URL('../src/server/seed.ts', import.meta.url);
    if (!existsSync(adapter)) {
      throw new Error('Catalog seeded; backend seed adapter src/server/seed.ts is pending. See handoffs/platform.md.');
    }
    // The backend owns signing and evidence. This adapter must do no network I/O.
    const backend = await import(adapter.href);
    if (typeof backend.seedDemo !== 'function') throw new Error('Backend seed adapter must export seedDemo(db).');
    await backend.seedDemo(db);
    // Print counts only, never rows containing signing keys or environment values.
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    console.log(JSON.stringify({ seeded: true, catalog_items: count('catalog_items'), mandates: count('mandates'), purchases: count('purchases'), evidence_records: count('evidence_records') }));
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().catch(() => {
    console.error('Seed did not finish. Ensure PAYPAL_ENV=sandbox and the backend seedDemo(db) adapter is available; see handoffs/platform.md.');
    process.exitCode = 1;
  });
}
