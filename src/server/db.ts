import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const SCHEMA_PATH = join(REPO_ROOT, 'db', 'schema.sql');

export type Db = DatabaseSync;

/** Open the SQLite file and apply db/schema.sql (owned by platform; must be idempotent). */
export function openDb(databasePath: string): Db {
  const file = databasePath === ':memory:' ? databasePath : resolve(REPO_ROOT, databasePath);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (!existsSync(SCHEMA_PATH)) throw new Error(`Schema not found at ${SCHEMA_PATH} (owned by platform, db/schema.sql).`);
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  migrate(db);
  return db;
}

/** Additive column migrations for databases created before a column existed (CREATE TABLE IF NOT EXISTS skips them). */
function migrate(db: Db): void {
  const has = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has('purchases', 'paypal_authorization_id')) db.exec('ALTER TABLE purchases ADD COLUMN paypal_authorization_id TEXT');
}

/** Run fn inside an immediate transaction (node:sqlite has no helper). Not re-entrant. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
