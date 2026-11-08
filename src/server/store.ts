// Data access for everything except mandates (mandates.ts) and evidence (evidence.ts).
import type { Db } from './db.ts';
import type { EventBus } from './events.ts';
import type {
  AgentResult, Approval, CatalogItem, Dispute, DisputePacket, Purchase, PurchaseStatus, WebhookEventRecord,
} from './types.ts';
import { centsToMoney, monthKey, newId, nowIso, toCents } from './util.ts';

type Row = Record<string, any>;
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || v === '') return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

const SPENDING: PurchaseStatus[] = ['awaiting_payer', 'completed', 'disputed', 'dispute_resolved'];

function rowToItem(r: Row): CatalogItem {
  return { sku: r.sku, name: r.name, category: r.category, price: { currency_code: r.currency_code, value: r.price_value }, merchant: r.merchant };
}

function rowToPurchase(r: Row): Purchase {
  return {
    id: r.id, mandate_id: r.mandate_id, mandate_version: Number(r.mandate_version), sku: r.sku, item_name: r.item_name,
    category: r.category, amount: { currency_code: r.currency_code, value: r.amount_value }, status: r.status,
    within_mandate: !!r.within_mandate, breaches: parse<string[]>(r.breaches, []), demo_rogue: !!r.demo_rogue,
    request_id: r.request_id ?? null, paypal_order_id: r.paypal_order_id ?? null, approve_url: r.approve_url ?? null,
    paypal_capture_id: r.paypal_capture_id ?? null, approval_id: r.approval_id ?? null, dispute_id: r.dispute_id ?? null,
    created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at ?? null,
  };
}

function rowToApproval(r: Row): Approval {
  return {
    id: r.id, purchase_id: r.purchase_id, status: r.status, summary: r.summary, reasons: parse<string[]>(r.reasons, []),
    created_at: r.created_at, decided_by: r.decided_by ?? null, decided_at: r.decided_at ?? null, decision_note: r.decision_note ?? null,
  };
}

function rowToDispute(r: Row): Dispute {
  return {
    id: r.id, paypal_dispute_id: r.paypal_dispute_id ?? null, simulated: !!r.simulated, purchase_id: r.purchase_id ?? null,
    paypal_order_id: r.paypal_order_id ?? null, status: r.status, reason: r.reason ?? '',
    amount: { currency_code: r.currency_code, value: r.amount_value }, created_at: r.created_at, updated_at: r.updated_at,
    packet: parse<DisputePacket | null>(r.packet, null),
  };
}

function rowToWebhook(r: Row): WebhookEventRecord {
  return {
    id: r.id, event_type: r.event_type, resource_type: r.resource_type ?? null, received_at: r.received_at,
    verified: !!r.verified, processed: !!r.processed, purchase_id: r.purchase_id ?? null, error: r.error ?? null,
  };
}

export interface NewPurchase {
  /** Seed adapter only: a stable id. */
  id?: string;
  mandate_id: string;
  mandate_version: number;
  sku: string;
  item_name: string;
  category: string;
  amount: { currency_code: string; value: string };
  status: PurchaseStatus;
  within_mandate: boolean;
  breaches: string[];
  demo_rogue: boolean;
  request_id: string | null;
}

export type PurchasePatch = Partial<{
  status: PurchaseStatus; paypal_order_id: string; approve_url: string; paypal_capture_id: string;
  approval_id: string; dispute_id: string; completed_at: string; within_mandate: boolean; breaches: string[];
}>;

export class Store {
  private db: Db;
  private bus: EventBus;

  constructor(db: Db, bus: EventBus) {
    this.db = db;
    this.bus = bus;
  }

  // ---------- catalog ----------
  listCatalog(category?: string): CatalogItem[] {
    const rows = category
      ? (this.db.prepare('SELECT * FROM catalog_items WHERE lower(category) = lower(?) ORDER BY name').all(category) as Row[])
      : (this.db.prepare('SELECT * FROM catalog_items ORDER BY category, name').all() as Row[]);
    return rows.map(rowToItem);
  }

  getItem(sku: string): CatalogItem | null {
    const r = this.db.prepare('SELECT * FROM catalog_items WHERE sku = ?').get(sku) as Row | undefined;
    return r ? rowToItem(r) : null;
  }

  // ---------- purchases ----------
  insertPurchase(p: NewPurchase): Purchase {
    const id = p.id ?? newId('pur');
    const now = nowIso();
    this.db.prepare(`INSERT INTO purchases (id, mandate_id, mandate_version, sku, item_name, category, amount_value, currency_code, status,
      within_mandate, breaches, demo_rogue, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.mandate_id, p.mandate_version, p.sku, p.item_name, p.category, p.amount.value, p.amount.currency_code, p.status,
        p.within_mandate ? 1 : 0, json(p.breaches), p.demo_rogue ? 1 : 0, p.request_id, now, now);
    const pur = this.getPurchase(id)!;
    this.bus.publish('purchase.updated', pur);
    return pur;
  }

  getPurchase(id: string): Purchase | null {
    const r = this.db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToPurchase(r) : null;
  }

  getPurchaseByOrderId(orderId: string): Purchase | null {
    const r = this.db.prepare('SELECT * FROM purchases WHERE paypal_order_id = ?').get(orderId) as Row | undefined;
    return r ? rowToPurchase(r) : null;
  }

  listPurchases(f: { status?: string; mandate_id?: string } = {}): Purchase[] {
    const where: string[] = [];
    const args: string[] = [];
    if (f.status) { where.push('status = ?'); args.push(f.status); }
    if (f.mandate_id) { where.push('mandate_id = ?'); args.push(f.mandate_id); }
    const sql = `SELECT * FROM purchases ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(rowToPurchase);
  }

  updatePurchase(id: string, patch: PurchasePatch): Purchase {
    const keys = Object.keys(patch) as (keyof PurchasePatch)[];
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      const values = keys.map((k) => {
        const v = patch[k];
        if (k === 'breaches') return JSON.stringify(v);
        if (k === 'within_mandate') return v ? 1 : 0;
        return v as string;
      });
      this.db.prepare(`UPDATE purchases SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
    }
    const pur = this.getPurchase(id)!;
    this.bus.publish('purchase.updated', pur);
    return pur;
  }

  /** Compare-and-set on status so a purchase can be moved out of a state at most once. */
  transitionPurchase(id: string, from: PurchaseStatus, patch: PurchasePatch & { status: PurchaseStatus }): Purchase | null {
    const cur = this.getPurchase(id);
    if (!cur || cur.status !== from) return null;
    const keys = Object.keys(patch) as (keyof PurchasePatch)[];
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (k === 'breaches' ? JSON.stringify(patch[k]) : k === 'within_mandate' ? (patch[k] ? 1 : 0) : (patch[k] as string)));
    const res = this.db.prepare(`UPDATE purchases SET ${sets}, updated_at = ? WHERE id = ? AND status = ?`).run(...values, nowIso(), id, from);
    if (Number(res.changes) !== 1) return null;
    const pur = this.getPurchase(id)!;
    this.bus.publish('purchase.updated', pur);
    return pur;
  }

  /** Spend that counts against the monthly cap (contract section 3, Mandate.budget). */
  spentCents(mandateId: string, period: string = monthKey()): number {
    const ph = SPENDING.map(() => '?').join(', ');
    const rows = this.db.prepare(`SELECT amount_value FROM purchases WHERE mandate_id = ? AND substr(created_at, 1, 7) = ? AND status IN (${ph})`)
      .all(mandateId, period, ...SPENDING) as Row[];
    return rows.reduce((sum, r) => sum + toCents(r.amount_value), 0);
  }

  spentMoney(mandateId: string, period?: string): string {
    return centsToMoney(this.spentCents(mandateId, period));
  }

  // ---------- approvals ----------
  insertApproval(a: { purchase_id: string; summary: string; reasons: string[] }): Approval {
    const id = newId('apr');
    this.db.prepare('INSERT INTO approvals (id, purchase_id, status, summary, reasons, created_at) VALUES (?, ?, \'pending\', ?, ?, ?)')
      .run(id, a.purchase_id, a.summary, json(a.reasons), nowIso());
    const ap = this.getApproval(id)!;
    this.bus.publish('approval.updated', ap);
    return ap;
  }

  getApproval(id: string): Approval | null {
    const r = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToApproval(r) : null;
  }

  listApprovals(status?: string): Approval[] {
    const rows = status
      ? (this.db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC, id DESC').all(status) as Row[])
      : (this.db.prepare('SELECT * FROM approvals ORDER BY created_at DESC, id DESC').all() as Row[]);
    return rows.map(rowToApproval);
  }

  /** Compare-and-set pending -> approved|rejected. Null if someone decided first. */
  decideApproval(id: string, to: 'approved' | 'rejected', by: string, note: string | null): Approval | null {
    const res = this.db.prepare('UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = \'pending\'')
      .run(to, by, nowIso(), note, id);
    if (Number(res.changes) !== 1) return null;
    const ap = this.getApproval(id)!;
    this.bus.publish('approval.updated', ap);
    return ap;
  }

  // ---------- disputes ----------
  insertDispute(d: { paypal_dispute_id: string | null; simulated: boolean; purchase_id: string | null; paypal_order_id: string | null; reason: string; amount: { currency_code: string; value: string } }): Dispute {
    const id = newId('dsp');
    const now = nowIso();
    this.db.prepare(`INSERT INTO disputes (id, paypal_dispute_id, simulated, purchase_id, paypal_order_id, status, reason, amount_value, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`)
      .run(id, d.paypal_dispute_id, d.simulated ? 1 : 0, d.purchase_id, d.paypal_order_id, d.reason, d.amount.value, d.amount.currency_code, now, now);
    const dsp = this.getDispute(id)!;
    this.bus.publish('dispute.updated', dsp);
    return dsp;
  }

  getDispute(id: string): Dispute | null {
    const r = this.db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToDispute(r) : null;
  }

  getDisputeByPaypalId(ppId: string): Dispute | null {
    const r = this.db.prepare('SELECT * FROM disputes WHERE paypal_dispute_id = ?').get(ppId) as Row | undefined;
    return r ? rowToDispute(r) : null;
  }

  listDisputes(): Dispute[] {
    return (this.db.prepare('SELECT * FROM disputes ORDER BY created_at DESC, id DESC').all() as Row[]).map(rowToDispute);
  }

  updateDispute(id: string, patch: Partial<{ status: string; packet: DisputePacket | null; reason: string }>): Dispute {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      this.db.prepare(`UPDATE disputes SET ${sets}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => (k === 'packet' ? json(patch.packet) : (patch[k] as string))), nowIso(), id);
    }
    const dsp = this.getDispute(id)!;
    this.bus.publish('dispute.updated', dsp);
    return dsp;
  }

  // ---------- webhooks ----------
  /** Returns false if this event id was already stored (idempotency). */
  insertWebhook(w: { id: string; event_type: string; resource_type: string | null; verified: boolean; raw: unknown }): boolean {
    const res = this.db.prepare(`INSERT OR IGNORE INTO webhook_events (id, event_type, resource_type, received_at, verified, processed, raw)
      VALUES (?, ?, ?, ?, ?, 0, ?)`).run(w.id, w.event_type, w.resource_type, nowIso(), w.verified ? 1 : 0, json(w.raw));
    return Number(res.changes) === 1;
  }

  markWebhook(id: string, patch: { processed: boolean; purchase_id?: string | null; error?: string | null }): void {
    this.db.prepare('UPDATE webhook_events SET processed = ?, purchase_id = ?, error = ? WHERE id = ?')
      .run(patch.processed ? 1 : 0, patch.purchase_id ?? null, patch.error ?? null, id);
  }

  listWebhooks(limit = 50): WebhookEventRecord[] {
    const n = Math.min(Math.max(limit, 1), 500);
    return (this.db.prepare('SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?').all(n) as Row[]).map(rowToWebhook);
  }

  // ---------- agent requests ----------
  insertAgentRequest(r: { id: string; mandate_id: string; text: string; outcome: string; reply: string; purchase_id: string | null; approval_id: string | null; evidence_record_id: string | null }): void {
    this.db.prepare(`INSERT INTO agent_requests (id, mandate_id, text, outcome, reply, purchase_id, approval_id, evidence_record_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, r.mandate_id, r.text, r.outcome, r.reply, r.purchase_id, r.approval_id, r.evidence_record_id, nowIso());
  }

  getAgentRequest(id: string): AgentResult | null {
    const r = this.db.prepare('SELECT * FROM agent_requests WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return {
      request_id: r.id, outcome: r.outcome, reply: r.reply,
      purchase: r.purchase_id ? this.getPurchase(r.purchase_id) : null,
      approval: r.approval_id ? this.getApproval(r.approval_id) : null,
      evidence_record_id: r.evidence_record_id ?? null,
    };
  }
}
