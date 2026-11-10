// In-memory mock backend matching docs/api-contract.md. Used when NEXT_PUBLIC_DATA_SOURCE=mock.
// Hashes here are NOT sha-256 and signatures are fake: this is for UI development only.
import { ApiError } from "./types";
import type {
  AgentResult,
  Api,
  Approval,
  Decision,
  Dispute,
  EvidenceRecord,
  Limits,
  MandateDraft,
  Mandate,
  Purchase,
  StreamEvent,
} from "./types";

const cents = (v: string) => Math.round(parseFloat(v) * 100);
const money = (c: number) => (c / 100).toFixed(2);
const now = () => new Date().toISOString();
let idc = 100;
const nid = (p: string) => `${p}_MOCK${String(++idc).padStart(4, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeHash(s: string): string {
  let h1 = 0x811c9dc5;
  let out = "";
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < s.length; j++) {
      h1 ^= s.charCodeAt(j) + i;
      h1 = Math.imul(h1, 16777619);
    }
    out += (h1 >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

const CATALOG = [
  { sku: "GRO-OAT-01", name: "Rolled oats 1kg", category: "groceries", price: "4.50" },
  { sku: "GRO-RICE-01", name: "Basmati rice 5kg", category: "groceries", price: "12.00" },
  { sku: "GRO-COFFEE-01", name: "Coffee beans 1kg", category: "groceries", price: "18.00" },
  { sku: "GRO-OIL-01", name: "Olive oil 1L", category: "groceries", price: "9.00" },
  { sku: "GRO-BOX-A", name: "Pantry restock box A", category: "groceries", price: "42.00" },
  { sku: "GRO-BOX-B", name: "Pantry restock box B", category: "groceries", price: "51.00" },
  { sku: "GRO-HAMPER", name: "Gourmet hamper", category: "groceries", price: "60.00" },
  { sku: "ELE-ESP-01", name: "Espresso machine", category: "electronics", price: "129.00" },
  { sku: "ELE-GAME-01", name: "Games console", category: "electronics", price: "299.00" },
];

const MKEY = "Mandate Ledger demo key";

class MockBackend implements Api {
  readonly kind = "mock" as const;
  private handlers = new Set<(e: StreamEvent) => void>();
  private versions = new Map<string, Mandate[]>();
  private purchases: Purchase[] = [];
  private approvals: Approval[] = [];
  private disputes: Dispute[] = [];
  private evidence: EvidenceRecord[] = [];
  private requests = new Map<string, AgentResult>();

  constructor() {
    const m = this.makeMandate("m_MOCK0001", 1, "Groceries, $200/month", {
      monthly_cap: "200.00",
      categories: ["groceries"],
      approval_above: "75.00",
    });
    this.versions.set(m.id, [m]);
    // Historical, completed purchases with a valid chain.
    for (const [sku, mins] of [
      ["GRO-RICE-01", 3000],
      ["GRO-COFFEE-01", 1500],
    ] as const) {
      const item = CATALOG.find((c) => c.sku === sku)!;
      const pur = this.newPurchase(m, item, true, false, "completed");
      const ts = new Date(Date.now() - mins * 60000).toISOString();
      pur.created_at = pur.updated_at = pur.completed_at = ts;
      pur.paypal_order_id = `5O19MOCK${sku.slice(-2)}`;
      pur.paypal_capture_id = `3CMOCK${sku.slice(-2)}`;
      this.purchases.unshift(pur);
      this.addEvidence(m, "selected", pur, "restock the pantry basics", true, [], false, ts);
      this.addEvidence(m, "captured", pur, "", true, [], false, ts);
    }
  }

  // ---- helpers
  private current(id: string): Mandate {
    const v = this.versions.get(id);
    if (!v) throw new ApiError(404, "not_found", `Mandate ${id} not found`);
    return v[v.length - 1];
  }
  private makeMandate(id: string, version: number, label: string, limits: Limits): Mandate {
    const t = now();
    const l: Limits = { currency_code: "USD", ...limits };
    const ph = fakeHash(JSON.stringify({ id, version, l, t }));
    return {
      id,
      version,
      status: "active",
      owner: "demo-user",
      label,
      limits: l,
      created_at: t,
      updated_at: t,
      revoked_at: null,
      signature: {
        alg: "ed25519",
        key_id: "key_demo_1",
        note: MKEY,
        payload_hash: ph,
        sig: btoa(ph).slice(0, 44) + "==",
      },
      budget: { spent: "0.00", remaining: limits.monthly_cap, period: t.slice(0, 7) },
    };
  }
  private spent(mid: string): number {
    return this.purchases
      .filter(
        (p) =>
          p.mandate_id === mid &&
          ["awaiting_payer", "completed", "disputed", "dispute_resolved"].includes(p.status),
      )
      .reduce((s, p) => s + cents(p.amount.value), 0);
  }
  private withBudget(m: Mandate): Mandate {
    const sp = this.spent(m.id);
    return {
      ...m,
      budget: { ...m.budget, spent: money(sp), remaining: money(cents(m.limits.monthly_cap) - sp) },
    };
  }
  private emit(e: StreamEvent) {
    this.handlers.forEach((h) => h(e));
  }
  private emitPurchase(p: Purchase) {
    p.updated_at = now();
    this.emit({ type: "purchase.updated", data: { ...p } });
    const m = this.versions.get(p.mandate_id);
    if (m) this.emit({ type: "mandate.updated", data: this.withBudget(m[m.length - 1]) });
  }
  private newPurchase(
    m: Mandate,
    item: (typeof CATALOG)[number],
    within: boolean,
    rogue: boolean,
    status: Purchase["status"],
    breaches: string[] = [],
  ): Purchase {
    const t = now();
    return {
      id: nid("pur"),
      mandate_id: m.id,
      mandate_version: m.version,
      sku: item.sku,
      item_name: item.name,
      category: item.category,
      amount: { currency_code: "USD", value: item.price },
      status,
      within_mandate: within,
      breaches,
      demo_rogue: rogue,
      request_id: nid("req"),
      paypal_order_id: null,
      approve_url: null,
      paypal_capture_id: null,
      approval_id: null,
      dispute_id: null,
      created_at: t,
      updated_at: t,
      completed_at: null,
    };
  }
  private addEvidence(
    m: Mandate,
    decision: Decision,
    p: Purchase | null,
    instruction: string,
    within: boolean,
    breaches: string[],
    rogue: boolean,
    ts = now(),
    extra: Partial<EvidenceRecord> = {},
  ): EvidenceRecord {
    const prev = this.evidence.length ? this.evidence[this.evidence.length - 1].hash : "0".repeat(64);
    const agentDecision = ["selected", "needs_approval", "blocked", "no_match"].includes(decision);
    const price = p ? cents(p.amount.value) : 0;
    const before = this.spent(m.id) - (p && ["completed", "awaiting_payer"].includes(p.status) && agentDecision ? price : 0);
    const rec: EvidenceRecord = {
      record_id: nid("evd"),
      seq: this.evidence.length + 1,
      prev_hash: prev,
      hash: "",
      timestamp: ts,
      decision,
      mandate: {
        id: m.id,
        version: m.version,
        status: m.status,
        signature: m.signature.sig,
        limits: m.limits,
      },
      user_instruction: agentDecision ? instruction : "",
      options_seen: agentDecision
        ? CATALOG.filter((c) => c.category === (p?.category ?? "groceries")).map((c) => ({ ...c }))
        : [],
      choice: agentDecision && p ? { sku: p.sku, price: p.amount.value } : null,
      rationale: agentDecision ? (rogue ? "demo rogue: agent chose against its mandate" : "cheapest in-category match") : "",
      budget_before: money(Math.max(0, before)),
      budget_after: money(Math.max(0, before) + (agentDecision && p ? price : 0)),
      within_mandate: within,
      breaches,
      demo_rogue: rogue,
      purchase_id: p?.id ?? null,
      paypal_order_id: p?.paypal_order_id ?? null,
      data: {},
      ...extra,
    };
    rec.hash = fakeHash(prev + "\n" + JSON.stringify({ ...rec, hash: undefined }));
    this.evidence.push(rec);
    this.emit({ type: "evidence.appended", data: rec });
    return rec;
  }

  // ---- Api
  async health() {
    return {
      ok: true,
      paypal_env: "sandbox",
      paypal_mode: "mock",
      agent_mode: "mock",
      checkout_mode: "payer_approval",
      webhook_verify: "off",
      version: "ui-mock",
    };
  }
  async listMandates() {
    return [...this.versions.values()].map((v) => this.withBudget(v[v.length - 1])).reverse();
  }
  async mandateVersions(id: string) {
    this.current(id);
    return [...this.versions.get(id)!].reverse().map((m) => this.withBudget(m));
  }
  async createMandate(b: { label: string; limits: Limits }) {
    if (cents(b.limits.approval_above) > cents(b.limits.monthly_cap))
      throw new ApiError(400, "bad_request", "approval_above must be <= monthly_cap");
    const m = this.makeMandate(nid("m"), 1, b.label, b.limits);
    this.versions.set(m.id, [m]);
    this.emit({ type: "mandate.updated", data: m });
    return m;
  }
  /** Mock only: a small rule-based reading. The real server also uses the semantic engine. */
  async draftMandate(text: string): Promise<MandateDraft> {
    await sleep(300);
    const t = text.toLowerCase();
    const cap = t.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars)?\s*(?:a|per|each)\s*month/);
    const appr = t.match(/(?:above|over|more than)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
    const cats = ["groceries", "electronics", "household"].filter((c) => t.includes(c) || (c === "groceries" && /food|pantry|snack/.test(t)));
    const missing: MandateDraft["missing"] = [];
    if (!cap) missing.push("monthly_cap");
    if (!cats.length) missing.push("categories");
    if (!appr) missing.push("approval_above");
    return {
      label: cats.length ? `${cats[0][0].toUpperCase()}${cats[0].slice(1)}${cap ? `, $${cap[1]}/month` : ""}` : "New mandate",
      limits: { monthly_cap: cap ? Number(cap[1]).toFixed(2) : null, categories: cats, approval_above: appr ? Number(appr[1]).toFixed(2) : null, ask_when_unsure: /not sure|unsure/.test(t) },
      notes: ["mock data: a simple rule-based reading"],
      missing,
      excluded: [],
    };
  }
  async updateLimits(id: string, b: Partial<Limits>) {
    const cur = this.current(id);
    if (cur.status === "revoked") throw new ApiError(409, "mandate_inactive", "Mandate is revoked");
    const limits = { ...cur.limits, ...b };
    if (cents(limits.approval_above) > cents(limits.monthly_cap))
      throw new ApiError(400, "bad_request", "approval_above must be <= monthly_cap");
    const next = this.makeMandate(id, cur.version + 1, cur.label, limits);
    this.versions.get(id)!.push(next);
    const out = this.withBudget(next);
    this.emit({ type: "mandate.updated", data: out });
    return out;
  }
  async revokeMandate(id: string) {
    const cur = this.current(id);
    cur.status = "revoked";
    cur.revoked_at = now();
    this.addEvidence(cur, "mandate_revoked", null, "", true, [], false);
    const out = this.withBudget(cur);
    this.emit({ type: "mandate.updated", data: out });
    return out;
  }
  async verifyMandate(id: string, version?: number) {
    const cur = this.current(id);
    await sleep(250);
    return { valid: true, alg: "ed25519", key_id: "key_demo_1", version: version ?? cur.version, reason: null };
  }
  async listPurchases() {
    return this.purchases.map((p) => ({ ...p }));
  }
  async purchaseEvidence(id: string) {
    return { records: this.evidence.filter((r) => r.purchase_id === id), chain_valid: true };
  }
  async verifyChain() {
    await sleep(200);
    const last = this.evidence[this.evidence.length - 1];
    return { valid: true, checked: this.evidence.length, head_hash: last?.hash ?? "0".repeat(64), broken_at_seq: null };
  }
  async listApprovals() {
    return this.approvals.filter((a) => a.status === "pending").map((a) => ({ ...a }));
  }

  async instruct(b: { mandate_id: string; text: string; demo_rogue: boolean }): Promise<AgentResult> {
    await sleep(700);
    const m = this.withBudget(this.current(b.mandate_id));
    if (m.status === "revoked") throw new ApiError(409, "mandate_inactive", "Mandate is revoked");
    const request_id = nid("req");
    const text = b.text.trim().toLowerCase();
    const skuMatch = text.match(/sku\s+([a-z0-9-]+)/i);
    const words = text.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["buy", "restock", "the", "for", "basics"].includes(w));
    let item: (typeof CATALOG)[number] | undefined;
    if (skuMatch) item = CATALOG.find((c) => c.sku.toLowerCase() === skuMatch[1].toLowerCase());
    else if (!text) {
      return this.done({ request_id, outcome: "needs_info", reply: "What would you like me to buy?", purchase: null, approval: null, evidence_record_id: null });
    } else {
      const pool = CATALOG.filter((c) => words.length === 0 || words.some((w) => (c.name + " " + c.category).toLowerCase().includes(w)));
      const inCat = pool.filter((c) => m.limits.categories.includes(c.category));
      item = [...(inCat.length ? inCat : pool)].sort((a, c) => cents(a.price) - cents(c.price))[0];
      if (!item && (words.length === 0 || text.includes("restock")))
        item = [...CATALOG.filter((c) => m.limits.categories.includes(c.category))].sort((a, c) => cents(a.price) - cents(c.price))[0];
    }
    const mk = (decision: Decision, p: Purchase | null, within: boolean, br: string[]) =>
      this.addEvidence(m, decision, p, b.text, within, br, b.demo_rogue);
    if (!item) {
      const e = mk("no_match", null, true, []);
      return this.done({ request_id, outcome: "no_match", reply: "I couldn't find anything suitable in the catalog.", purchase: null, approval: null, evidence_record_id: e.record_id });
    }
    // Mandate checker (contract section 8)
    const price = cents(item.price);
    const breaches: string[] = [];
    if (!m.limits.categories.includes(item.category)) breaches.push("category_not_allowed");
    if (this.spent(m.id) + price > cents(m.limits.monthly_cap)) breaches.push("exceeds_monthly_cap");
    const within = breaches.length === 0;
    if (!within && !b.demo_rogue) {
      const p = this.newPurchase(m, item, false, false, "failed", breaches);
      const e = mk("blocked", p, false, breaches);
      return this.done({ request_id, outcome: "blocked", reply: `Blocked by the mandate checker: ${breaches.join(", ")}. Nothing was bought.`, purchase: null, approval: null, evidence_record_id: e.record_id });
    }
    const needsApproval = within && price > cents(m.limits.approval_above);
    if (needsApproval) {
      const p = this.newPurchase(m, item, true, false, "pending_approval");
      const a: Approval = {
        id: nid("apr"),
        purchase_id: p.id,
        status: "pending",
        summary: `Buy ${item.name} (USD ${item.price}) — above your USD ${m.limits.approval_above} approval threshold`,
        reasons: ["above_approval_threshold"],
        created_at: now(),
        decided_by: null,
        decided_at: null,
        decision_note: null,
      };
      p.approval_id = a.id;
      this.purchases.unshift(p);
      this.approvals.push(a);
      const e = mk("needs_approval", p, true, []);
      this.emit({ type: "approval.updated", data: { ...a } });
      this.emitPurchase(p);
      return this.done({ request_id, outcome: "needs_approval", reply: `${item.name} costs USD ${item.price}, above your approval threshold. Waiting for your approval.`, purchase: { ...p }, approval: { ...a }, evidence_record_id: e.record_id });
    }
    const p = this.newPurchase(m, item, within, b.demo_rogue && !within, "awaiting_payer", breaches);
    p.paypal_order_id = `5O19MOCK${String(idc).padStart(4, "0")}`;
    p.approve_url = "https://www.sandbox.paypal.com/checkoutnow?token=MOCK-NOT-A-REAL-ORDER";
    this.purchases.unshift(p);
    const e = mk("selected", p, within, breaches);
    this.addEvidence(m, "order_created", p, "", within, breaches, b.demo_rogue && !within);
    this.emitPurchase(p);
    // Simulate the buyer approving at PayPal and the webhook arriving.
    setTimeout(() => {
      p.status = "completed";
      p.completed_at = now();
      p.paypal_capture_id = `3CMOCK${String(idc).padStart(4, "0")}`;
      this.addEvidence(m, "captured", p, "", within, breaches, p.demo_rogue);
      this.emitPurchase(p);
    }, 4000);
    return this.done({
      request_id,
      outcome: "awaiting_payer",
      reply: `Created a sandbox order for ${item.name} (USD ${item.price}).${within ? "" : " DEMO: the agent overrode its mandate."}`,
      purchase: { ...p },
      approval: null,
      evidence_record_id: e.record_id,
    });
  }
  private done(r: AgentResult) {
    this.requests.set(r.request_id, r);
    return r;
  }

  async decideApproval(id: string, verdict: "approve" | "reject", b: { decided_by: string; note?: string }) {
    const a = this.approvals.find((x) => x.id === id);
    if (!a) throw new ApiError(404, "not_found", `Approval ${id} not found`);
    if (a.status !== "pending") throw new ApiError(409, "invalid_state", "Approval is not pending");
    const p = this.purchases.find((x) => x.id === a.purchase_id)!;
    const m = this.current(p.mandate_id);
    a.status = verdict === "approve" ? "approved" : "rejected";
    a.decided_by = b.decided_by;
    a.decided_at = now();
    a.decision_note = b.note ?? null;
    if (verdict === "reject") {
      p.status = "rejected";
    } else if (m.status === "revoked") {
      p.status = "failed";
      p.within_mandate = false;
      p.breaches = ["inactive_mandate"];
    } else {
      p.status = "awaiting_payer";
      p.paypal_order_id = `5O19MOCK${String(++idc).padStart(4, "0")}`;
      p.approve_url = "https://www.sandbox.paypal.com/checkoutnow?token=MOCK-NOT-A-REAL-ORDER";
    }
    this.addEvidence(m, verdict === "approve" ? "approved" : "rejected", p, "", p.within_mandate, p.breaches, false, now(), { data: { approval_id: a.id, decided_by: b.decided_by } });
    this.emit({ type: "approval.updated", data: { ...a } });
    this.emitPurchase(p);
    return { approval: { ...a }, purchase: { ...p } };
  }

  async listDisputes() {
    return this.disputes.map((d) => ({ ...d }));
  }
  async syncDisputes(): Promise<Dispute[]> {
    throw new ApiError(502, "upstream_error", "Mock mode: the PayPal Disputes API is not available. Use a simulated dispute.");
  }
  async simulateDispute(b: { purchase_id: string; reason?: string }) {
    const p = this.purchases.find((x) => x.id === b.purchase_id);
    if (!p) throw new ApiError(404, "not_found", "Purchase not found");
    if (p.status !== "completed") throw new ApiError(409, "invalid_state", "Only completed purchases can be disputed");
    const d: Dispute = {
      id: nid("dsp"),
      paypal_dispute_id: null,
      simulated: true,
      purchase_id: p.id,
      paypal_order_id: p.paypal_order_id,
      status: "open",
      reason: b.reason ?? "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      amount: { ...p.amount },
      created_at: now(),
      updated_at: now(),
      packet: null,
    };
    p.status = "disputed";
    p.dispute_id = d.id;
    this.disputes.unshift(d);
    this.emit({ type: "dispute.updated", data: { ...d } });
    this.emitPurchase(p);
    return { ...d };
  }
  async assembleDispute(id: string) {
    const d = this.disputes.find((x) => x.id === id);
    if (!d) throw new ApiError(404, "not_found", "Dispute not found");
    if (d.status === "submitted" || d.status === "resolved") throw new ApiError(409, "invalid_state", "Already submitted");
    await sleep(900);
    const recs = this.evidence.filter((r) => r.purchase_id === d.purchase_id);
    const breach = recs.some((r) => !r.within_mandate);
    d.packet = {
      verdict: breach ? "MANDATE_BREACH" : "DEFENSIBLE",
      action: breach ? "accept_claim" : "provide_evidence",
      summary: breach
        ? "The agent purchased outside its signed mandate; the claim is accepted."
        : "Purchase was within the signed mandate; price and budget verified.",
      narrative: breach
        ? "MOCK NARRATIVE. The decision trail shows the mandate checker recorded within_mandate=false for this purchase (category_not_allowed). The agent overstepped its authority, so the honest response is to accept the buyer's claim rather than contest it."
        : "MOCK NARRATIVE. The decision trail shows the agent saw the listed options, chose the cheapest in-category match, stayed within the monthly cap and acted under an active signed mandate. This evidence is provided for the reviewer.",
      evidence_record_ids: recs.map((r) => r.record_id),
      chain_valid: true,
      assembled_at: now(),
      submitted_at: null,
      paypal_response: null,
    };
    d.status = "evidence_assembled";
    d.updated_at = now();
    this.emit({ type: "dispute.updated", data: { ...d } });
    return { ...d };
  }
  async submitDispute(id: string) {
    const d = this.disputes.find((x) => x.id === id);
    if (!d) throw new ApiError(404, "not_found", "Dispute not found");
    if (!d.packet) throw new ApiError(409, "invalid_state", "Assemble evidence first");
    if (d.status === "submitted") throw new ApiError(409, "invalid_state", "Already submitted");
    await sleep(400);
    d.packet.submitted_at = now();
    d.packet.paypal_response = { simulated: true };
    d.status = "submitted";
    d.updated_at = now();
    this.emit({ type: "dispute.updated", data: { ...d } });
    return { ...d };
  }
  subscribe(handler: (e: StreamEvent) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

export function createMockApi(): Api {
  return new MockBackend();
}
