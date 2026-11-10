// Mandate service (WP-2): create / version / revoke / verify signed mandates.
// Signing payload (canonical JSON): {"id","version","owner","limits","created_at"} where created_at is the VERSION's.
import type { Db } from './db.ts';
import { tx } from './db.ts';
import type { EventBus } from './events.ts';
import type { EvidenceLog } from './evidence.ts';
import type { Signer } from './signing.ts';
import { DEMO_KEY_NOTE } from './signing.ts';
import type { Store } from './store.ts';
import type { Limits, Mandate } from './types.ts';
import { badRequest, canonicalJson, centsToMoney, monthKey, newId, nowIso, notFound, sha256Hex, toCents } from './util.ts';

type Row = Record<string, any>;

export interface LimitsInput {
  monthly_cap?: string | number;
  categories?: string[];
  approval_above?: string | number;
  ask_when_unsure?: boolean;
}

export interface VerifyResult {
  valid: boolean;
  alg: 'ed25519';
  key_id: string;
  version: number;
  reason: string | null;
}

/** Validates and normalises limits. Throws 400 on anything invalid. */
export function normaliseLimits(input: LimitsInput, base?: Limits): Limits {
  const cap = input.monthly_cap ?? base?.monthly_cap;
  const above = input.approval_above ?? base?.approval_above;
  const cats = input.categories ?? base?.categories;
  if (cap === undefined || above === undefined || cats === undefined) throw badRequest('limits need monthly_cap, categories and approval_above');
  let capC: number, aboveC: number;
  try { capC = toCents(cap); aboveC = toCents(above); } catch { throw badRequest('monthly_cap and approval_above must be positive amounts'); }
  if (capC <= 0 || aboveC <= 0) throw badRequest('monthly_cap and approval_above must be greater than zero');
  if (aboveC > capC) throw badRequest('approval_above cannot exceed monthly_cap');
  const categories = [...new Set((Array.isArray(cats) ? cats : []).map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
  if (!categories.length) throw badRequest('categories must be a non-empty list');
  const unsure = input.ask_when_unsure ?? base?.ask_when_unsure;
  if (unsure !== undefined && typeof unsure !== 'boolean') throw badRequest('ask_when_unsure must be true or false');
  const limits: Limits = { currency_code: 'USD', monthly_cap: centsToMoney(capC), categories, approval_above: centsToMoney(aboveC) };
  // Stored only when on, so older signed payloads are byte-for-byte unchanged.
  if (unsure === true) limits.ask_when_unsure = true;
  return limits;
}

export class MandateService {
  private db: Db;
  private bus: EventBus;
  private signer: Signer;
  private evidence: EvidenceLog;
  private store: Store;

  constructor(db: Db, bus: EventBus, signer: Signer, evidence: EvidenceLog, store: Store) {
    this.db = db;
    this.bus = bus;
    this.signer = signer;
    this.evidence = evidence;
    this.store = store;
  }

  private payload(id: string, version: number, owner: string, limits: Limits, createdAt: string): string {
    return canonicalJson({ id, version, owner, limits, created_at: createdAt });
  }

  private build(m: Row, v: Row): Mandate {
    const limits = JSON.parse(v.limits) as Limits;
    const period = monthKey();
    const spent = this.store.spentCents(m.id, period);
    const cap = toCents(limits.monthly_cap);
    return {
      id: m.id, version: Number(v.version), status: m.status, owner: m.owner, label: m.label, limits,
      created_at: m.created_at, updated_at: m.updated_at, revoked_at: m.revoked_at ?? null,
      signature: { alg: 'ed25519', key_id: v.key_id, note: DEMO_KEY_NOTE, payload_hash: v.payload_hash, sig: v.signature },
      budget: { spent: centsToMoney(spent), remaining: centsToMoney(Math.max(0, cap - spent)), period },
    };
  }

  /** `id` is for the seed adapter only (stable identities); the HTTP route never passes it. */
  create(input: { label?: string; owner?: string; limits: LimitsInput; id?: string }): Mandate {
    const limits = normaliseLimits(input.limits ?? {});
    const id = input.id ?? newId('m');
    const now = nowIso();
    const owner = (input.owner ?? 'demo-user').toString().slice(0, 64) || 'demo-user';
    const label = (input.label ?? '').toString().trim().slice(0, 120) || `Mandate ${limits.categories.join(', ')}`;
    const payload = this.payload(id, 1, owner, limits, now);
    tx(this.db, () => {
      this.db.prepare('INSERT INTO mandates (id, owner, label, status, current_version, created_at, updated_at) VALUES (?, ?, ?, \'active\', 1, ?, ?)')
        .run(id, owner, label, now, now);
      this.db.prepare('INSERT INTO mandate_versions (mandate_id, version, limits, created_at, payload_hash, signature, key_id) VALUES (?, 1, ?, ?, ?, ?, ?)')
        .run(id, JSON.stringify(limits), now, sha256Hex(payload), this.signer.sign(payload), this.signer.keyId);
    });
    const m = this.get(id)!;
    this.bus.publish('mandate.updated', m);
    return m;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM mandates WHERE id = ?').get(id) as Row | undefined;
  }

  get(id: string, version?: number): Mandate | null {
    const m = this.row(id);
    if (!m) return null;
    const v = this.db.prepare('SELECT * FROM mandate_versions WHERE mandate_id = ? AND version = ?').get(id, version ?? Number(m.current_version)) as Row | undefined;
    return v ? this.build(m, v) : null;
  }

  require(id: string): Mandate {
    const m = this.get(id);
    if (!m) throw notFound(`Mandate ${id} not found`);
    return m;
  }

  list(): Mandate[] {
    const rows = this.db.prepare('SELECT id FROM mandates ORDER BY created_at DESC, id DESC').all() as Row[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  versions(id: string): Mandate[] {
    const m = this.row(id);
    if (!m) throw notFound(`Mandate ${id} not found`);
    const vs = this.db.prepare('SELECT version FROM mandate_versions WHERE mandate_id = ? ORDER BY version DESC').all(id) as Row[];
    return vs.map((v) => this.get(id, Number(v.version))!);
  }

  /** Changing limits never edits history: it appends a new signed version. */
  updateLimits(id: string, input: LimitsInput): Mandate {
    const cur = this.require(id);
    if (cur.status !== 'active') throw badRequest('A revoked mandate cannot be changed');
    const limits = normaliseLimits(input, cur.limits);
    const version = cur.version + 1;
    const now = nowIso();
    const payload = this.payload(id, version, cur.owner, limits, now);
    tx(this.db, () => {
      this.db.prepare('INSERT INTO mandate_versions (mandate_id, version, limits, created_at, payload_hash, signature, key_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, version, JSON.stringify(limits), now, sha256Hex(payload), this.signer.sign(payload), this.signer.keyId);
      this.db.prepare('UPDATE mandates SET current_version = ?, updated_at = ? WHERE id = ?').run(version, now, id);
    });
    const m = this.get(id)!;
    this.bus.publish('mandate.updated', m);
    return m;
  }

  revoke(id: string): Mandate {
    const cur = this.require(id);
    if (cur.status === 'revoked') return cur;
    const now = nowIso();
    this.db.prepare('UPDATE mandates SET status = \'revoked\', revoked_at = ?, updated_at = ? WHERE id = ? AND status = \'active\'').run(now, now, id);
    const m = this.get(id)!;
    this.evidence.append({
      decision: 'mandate_revoked',
      mandate: this.snapshot(m),
      budget_before: m.budget.spent,
      budget_after: m.budget.spent,
      data: { revoked_at: now },
    });
    this.bus.publish('mandate.updated', m);
    return m;
  }

  /** Recomputes the payload from stored columns and verifies the signature in a separate step. */
  verify(id: string, version?: number): VerifyResult {
    const m = this.row(id);
    if (!m) throw notFound(`Mandate ${id} not found`);
    const ver = version ?? Number(m.current_version);
    const v = this.db.prepare('SELECT * FROM mandate_versions WHERE mandate_id = ? AND version = ?').get(id, ver) as Row | undefined;
    if (!v) throw notFound(`Mandate ${id} has no version ${ver}`);
    const base = { valid: false, alg: 'ed25519' as const, key_id: v.key_id as string, version: ver };
    let limits: Limits;
    try { limits = JSON.parse(v.limits) as Limits; } catch { return { ...base, reason: 'limits_unreadable' }; }
    const payload = this.payload(id, ver, m.owner, limits, v.created_at);
    if (sha256Hex(payload) !== v.payload_hash) return { ...base, reason: 'payload_hash_mismatch' };
    if (!this.signer.verify(payload, v.signature, v.key_id)) return { ...base, reason: 'signature_invalid' };
    return { ...base, valid: true, reason: null };
  }

  snapshot(m: Mandate) {
    return { id: m.id, version: m.version, status: m.status, signature: m.signature.sig, limits: m.limits };
  }
}
