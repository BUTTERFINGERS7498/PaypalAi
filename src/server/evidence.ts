// Append-only, hash-chained evidence log. The only module that writes evidence_records, and only INSERT.
//   hash = sha256(prev_hash + "\n" + canonicalJson(record without "hash"))
import type { Db } from './db.ts';
import { tx } from './db.ts';
import type { EventBus } from './events.ts';
import type { EvidenceDecision, EvidenceOption, EvidenceRecord, Limits } from './types.ts';
import { canonicalJson, GENESIS_HASH, newId, nowIso, sha256Hex } from './util.ts';

type Row = Record<string, any>;

export interface EvidenceInput {
  decision: EvidenceDecision;
  mandate: { id: string; version: number; status: string; signature: string; limits: Limits } | null;
  user_instruction?: string;
  options_seen?: EvidenceOption[];
  choice?: { sku: string; price: string } | null;
  rationale?: string;
  budget_before?: string;
  budget_after?: string;
  within_mandate?: boolean;
  breaches?: string[];
  demo_rogue?: boolean;
  purchase_id?: string | null;
  paypal_order_id?: string | null;
  data?: Record<string, unknown>;
}

export interface ChainVerdict {
  valid: boolean;
  checked: number;
  head_hash: string;
  broken_at_seq: number | null;
}

export function hashRecord(prevHash: string, record: Omit<EvidenceRecord, 'hash'>): string {
  return sha256Hex(`${prevHash}\n${canonicalJson(record)}`);
}

export class EvidenceLog {
  private db: Db;
  private bus: EventBus;

  constructor(db: Db, bus: EventBus) {
    this.db = db;
    this.bus = bus;
  }

  append(i: EvidenceInput): EvidenceRecord {
    const rec = tx(this.db, () => {
      const last = this.db.prepare('SELECT seq, hash FROM evidence_records ORDER BY seq DESC LIMIT 1').get() as Row | undefined;
      const seq = last ? Number(last.seq) + 1 : 1;
      const prev = last ? String(last.hash) : GENESIS_HASH;
      const base: Omit<EvidenceRecord, 'hash'> = {
        record_id: newId('evd'),
        seq,
        prev_hash: prev,
        timestamp: nowIso(),
        decision: i.decision,
        mandate: i.mandate,
        user_instruction: i.user_instruction ?? '',
        options_seen: i.options_seen ?? [],
        choice: i.choice ?? null,
        rationale: i.rationale ?? '',
        budget_before: i.budget_before ?? '0.00',
        budget_after: i.budget_after ?? i.budget_before ?? '0.00',
        within_mandate: i.within_mandate ?? true,
        breaches: i.breaches ?? [],
        demo_rogue: i.demo_rogue ?? false,
        purchase_id: i.purchase_id ?? null,
        paypal_order_id: i.paypal_order_id ?? null,
        data: i.data ?? {},
      };
      const full: EvidenceRecord = { ...base, hash: hashRecord(prev, base) };
      this.db.prepare(`INSERT INTO evidence_records (seq, record_id, prev_hash, hash, timestamp, purchase_id, paypal_order_id, mandate_id, body)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(seq, full.record_id, prev, full.hash, full.timestamp, full.purchase_id, full.paypal_order_id, full.mandate?.id ?? null, JSON.stringify(full));
      return full;
    });
    this.bus.publish('evidence.appended', rec);
    return rec;
  }

  get(recordId: string): EvidenceRecord | null {
    const r = this.db.prepare('SELECT body FROM evidence_records WHERE record_id = ?').get(recordId) as Row | undefined;
    return r ? (JSON.parse(r.body) as EvidenceRecord) : null;
  }

  list(f: { after_seq?: number; limit?: number; purchase_id?: string; order_id?: string; mandate_id?: string }): { records: EvidenceRecord[]; next_seq: number } {
    const after = f.after_seq ?? 0;
    const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
    const where = ['seq > ?'];
    const args: (string | number)[] = [after];
    if (f.purchase_id) { where.push('purchase_id = ?'); args.push(f.purchase_id); }
    if (f.order_id) { where.push('paypal_order_id = ?'); args.push(f.order_id); }
    if (f.mandate_id) { where.push('mandate_id = ?'); args.push(f.mandate_id); }
    const rows = this.db.prepare(`SELECT body FROM evidence_records WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`).all(...args, limit) as Row[];
    const records = rows.map((r) => JSON.parse(r.body) as EvidenceRecord);
    return { records, next_seq: records.length ? records[records.length - 1].seq : after };
  }

  /** All records for one purchase, oldest first (the decision trail). */
  forPurchase(purchaseId: string): EvidenceRecord[] {
    const rows = this.db.prepare('SELECT body FROM evidence_records WHERE purchase_id = ? ORDER BY seq ASC').all(purchaseId) as Row[];
    return rows.map((r) => JSON.parse(r.body) as EvidenceRecord);
  }

  /**
   * Walks the whole chain, recomputing every hash from the stored record body (not the stored hash column),
   * and checking links, seq continuity and that the indexed columns agree with the body.
   */
  verify(): ChainVerdict {
    const rows = this.db.prepare('SELECT seq, prev_hash, hash, body FROM evidence_records ORDER BY seq ASC').all() as Row[];
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    for (const r of rows) {
      const seq = Number(r.seq);
      const broken = (): ChainVerdict => ({ valid: false, checked: seq - 1, head_hash: prev, broken_at_seq: seq });
      let rec: EvidenceRecord;
      try { rec = JSON.parse(r.body) as EvidenceRecord; } catch { return broken(); }
      if (seq !== expectedSeq || rec.seq !== seq) return broken();
      if (rec.prev_hash !== prev || String(r.prev_hash) !== prev) return broken();
      const { hash: _h, ...rest } = rec;
      const recomputed = hashRecord(prev, rest);
      if (recomputed !== rec.hash || recomputed !== String(r.hash)) return broken();
      prev = rec.hash;
      expectedSeq += 1;
    }
    return { valid: true, checked: rows.length, head_hash: prev, broken_at_seq: null };
  }
}
