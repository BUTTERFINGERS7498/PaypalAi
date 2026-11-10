// Types mirror docs/api-contract.md section 3/4. Keep in sync with the contract, not the server.

export interface Money {
  currency_code: string;
  value: string;
}

export interface Limits {
  currency_code?: string;
  monthly_cap: string;
  categories: string[];
  approval_above: string;
  /** Optional clause: when the agent is unsure what you meant, ask a human first. */
  ask_when_unsure?: boolean;
}

export interface Mandate {
  id: string;
  version: number;
  status: "active" | "revoked";
  owner: string;
  label: string;
  limits: Limits;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  signature: { alg: string; key_id: string; note: string; payload_hash: string; sig: string };
  budget: { spent: string; remaining: string; period: string };
}

export type PurchaseStatus =
  | "pending_approval"
  | "awaiting_payer"
  | "completed"
  | "rejected"
  | "failed"
  | "disputed"
  | "dispute_resolved"
  | "refunded";

export interface Purchase {
  id: string;
  mandate_id: string;
  mandate_version: number;
  sku: string;
  item_name: string;
  category: string;
  amount: Money;
  status: PurchaseStatus;
  within_mandate: boolean;
  breaches: string[];
  demo_rogue: boolean;
  request_id: string | null;
  paypal_order_id: string | null;
  approve_url: string | null;
  paypal_capture_id: string | null;
  approval_id: string | null;
  dispute_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Approval {
  id: string;
  purchase_id: string;
  status: "pending" | "approved" | "rejected";
  summary: string;
  reasons: string[];
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export type Decision =
  | "selected"
  | "needs_approval"
  | "blocked"
  | "no_match"
  | "approved"
  | "rejected"
  | "order_created"
  | "captured"
  | "mandate_revoked"
  | "clarify"
  | "refunded"
  | "refund_failed";

export interface EvidenceRecord {
  record_id: string;
  seq: number;
  prev_hash: string;
  hash: string;
  timestamp: string;
  decision: Decision;
  mandate: { id: string; version: number; status: string; signature: string; limits: Limits };
  user_instruction: string;
  options_seen: { sku: string; name: string; category: string; price: string }[];
  choice: { sku: string; price: string } | null;
  rationale: string;
  budget_before: string;
  budget_after: string;
  within_mandate: boolean;
  breaches: string[];
  demo_rogue: boolean;
  purchase_id: string | null;
  paypal_order_id: string | null;
  data: Record<string, unknown>;
}

export interface DisputePacket {
  verdict: "DEFENSIBLE" | "MANDATE_BREACH";
  action: "provide_evidence" | "accept_claim";
  summary: string;
  narrative: string;
  evidence_record_ids: string[];
  chain_valid: boolean;
  assembled_at: string;
  submitted_at: string | null;
  paypal_response: unknown;
  /** Set when accepting the claim refunded the buyer at PayPal. */
  refund?: { paypal_refund_id: string; status: string; amount: Money; source: "refund_api" | "accept_claim"; refunded_at: string } | null;
}

export interface Dispute {
  id: string;
  paypal_dispute_id: string | null;
  simulated: boolean;
  purchase_id: string | null;
  paypal_order_id: string | null;
  status: "open" | "evidence_assembled" | "submitted" | "resolved";
  reason: string;
  amount: Money;
  created_at: string;
  updated_at: string;
  packet: DisputePacket | null;
}

export type AgentOutcome =
  | "purchased"
  | "awaiting_payer"
  | "needs_approval"
  | "blocked"
  | "no_match"
  | "needs_info";

export interface AgentResult {
  request_id: string;
  outcome: AgentOutcome;
  reply: string;
  purchase: Purchase | null;
  approval: Approval | null;
  evidence_record_id: string | null;
  /** Only when the agent asked a clarifying question: the items it could not decide between. */
  choices?: { sku: string; name: string; category: string; price: string }[];
}

/** How the on-server engine reached a choice (stored in evidence.data.agent). Every field is optional. */
export interface AgentTrace {
  mode?: string;
  backend?: "embeddings" | "keyword" | "rule";
  model?: string;
  query?: string;
  expansions?: string[];
  scores?: { sku: string; score: number }[];
  confidence?: number | null;
  low_confidence?: boolean;
  substitution?: { wanted_sku: string; wanted_name: string; reason: "category_not_allowed" | "over_remaining_budget" };
  preference?: { sku: string; times: number; last: string };
  injection?: string[];
}

export interface MandateDraft {
  label: string;
  limits: { monthly_cap: string | null; categories: string[]; approval_above: string | null; ask_when_unsure: boolean };
  notes: string[];
  missing: ("monthly_cap" | "categories" | "approval_above")[];
  excluded: string[];
}

export interface VerifyResult {
  valid: boolean;
  alg: string;
  key_id: string;
  version: number;
  reason: string | null;
}

export interface ChainVerify {
  valid: boolean;
  checked: number;
  head_hash: string;
  broken_at_seq: number | null;
}

export interface Health {
  ok: boolean;
  paypal_env: string;
  paypal_mode: string;
  agent_mode: string;
  checkout_mode: string;
  webhook_verify: string;
  version: string;
  /** Present only when the server runs AGENT_MODE=engine: 'embeddings' once the model is loaded, else the keyword fallback. */
  engine?: { state: string; backend: "embeddings" | "keyword"; model: string; load_ms: number | null; error: string | null };
}

/** A plain-language name for the server's agent, so nobody mistakes the on-server engine for Claude. */
export function agentLabel(h: Pick<Health, "agent_mode" | "engine">): string {
  if (h.agent_mode === "live") return "Claude agent";
  if (h.agent_mode === "engine") return h.engine?.backend === "keyword" ? "on-server engine (keyword fallback, model loading)" : "on-server semantic engine (not an LLM)";
  if (h.agent_mode === "mock") return "mock agent (deterministic)";
  return `${h.agent_mode} agent`;
}

export type StreamEvent =
  | { type: "purchase.updated"; data: Purchase }
  | { type: "approval.updated"; data: Approval }
  | { type: "evidence.appended"; data: EvidenceRecord }
  | { type: "dispute.updated"; data: Dispute }
  | { type: "mandate.updated"; data: Mandate }
  | { type: "reconnected"; data: null };

export interface Api {
  readonly kind: "mock" | "api";
  health(): Promise<Health>;
  listMandates(): Promise<Mandate[]>;
  mandateVersions(id: string): Promise<Mandate[]>;
  createMandate(b: { label: string; limits: Limits }): Promise<Mandate>;
  draftMandate(text: string): Promise<MandateDraft>;
  updateLimits(id: string, b: Partial<Limits>): Promise<Mandate>;
  revokeMandate(id: string): Promise<Mandate>;
  verifyMandate(id: string, version?: number): Promise<VerifyResult>;
  instruct(b: { mandate_id: string; text: string; demo_rogue: boolean }): Promise<AgentResult>;
  listPurchases(): Promise<Purchase[]>;
  purchaseEvidence(id: string): Promise<{ records: EvidenceRecord[]; chain_valid: boolean }>;
  verifyChain(): Promise<ChainVerify>;
  listApprovals(): Promise<Approval[]>;
  decideApproval(
    id: string,
    verdict: "approve" | "reject",
    b: { decided_by: string; note?: string },
  ): Promise<{ approval: Approval; purchase: Purchase }>;
  listDisputes(): Promise<Dispute[]>;
  syncDisputes(): Promise<Dispute[]>;
  simulateDispute(b: { purchase_id: string; reason?: string }): Promise<Dispute>;
  assembleDispute(id: string): Promise<Dispute>;
  submitDispute(id: string, b: { decided_by: string }): Promise<Dispute>;
  subscribe(handler: (e: StreamEvent) => void): () => void;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
