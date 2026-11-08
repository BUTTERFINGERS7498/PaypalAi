import { withDb } from './server.ts';

// Corruption simulation only: bypass and restore immutability triggers in this test's disposable DB.
export function tamper(database: string, table: 'mandate_versions' | 'evidence_records', mutate: (db: any) => void) {
  withDb(database, db => {
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const trigger of triggers) db.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
      mutate(db);
      for (const trigger of triggers) db.exec(String(trigger.sql));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
}
