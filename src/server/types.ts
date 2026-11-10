// Shapes from docs/api-contract.md section 3. Keep in sync with the contract.

export interface Money {
  currency_code: string;
  value: string;
}

export interface Limits {
  currency_code: string;
  monthly_cap: string;
  categories: string[];
  approval_above: string;
  /** Optional clause: when the agent is unsure what you meant, ask a human first. Only stored when true, so mandates
   *  signed before this clause existed keep exactly the same signed payload. */
  ask_when_unsure?: boolean;
}

export interface MandateSignature {
  alg: 'ed25519';
  key_id: string;
  note: string;
  payload_hash: string;
  sig: string;
}

export interface Mandate {
  id: string;
  version: number;
  status: 'active' | 'revoked';
  owner: string;
  label: string;
  limits: Limits;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  signature: MandateSignature;
  budget: { spent: string; remaining: string; period: string };
}

export interface CatalogItem {
  sku: string;
  name: string;
  category: string;
  price: Money;
  merchant: string;
}

export type PurchaseStatus =
  | 'pending_approval' | 'rejected' | 'awaiting_payer' | 'completed' | 'failed' | 'disputed' | 'dispute_resolved' | 'refunded';

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
  /** Set while the money is held at PayPal for a human decision (APPROVAL_HOLD=authorize). */
  paypal_authorization_id: string | null;
  /** When PayPal will drop the hold (authorizations last 29 days; the first 3 are the honor period). */
  hold_expires_at: string | null;
  approval_id: string | null;
  dispute_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Approval {
  id: string;
  purchase_id: string;
  status: 'pending' | 'approved' | 'rejected';
  summary: string;
  reasons: string[];
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export type EvidenceDecision =
  | 'selected' | 'needs_approval' | 'blocked' | 'no_match' | 'approved' | 'rejected'
  | 'order_created' | 'order_failed' | 'captured' | 'mandate_revoked' | 'clarify' | 'refunded' | 'refund_failed'
  | 'authorized' | 'voided';

export interface EvidenceOption {
  sku: string;
  name: string;
  category: string;
  price: string;
}

export interface EvidenceRecord {
  record_id: string;
  seq: number;
  prev_hash: string;
  hash: string;
  timestamp: string;
  decision: EvidenceDecision;
  mandate: { id: string; version: number; status: string; signature: string; limits: Limits } | null;
  user_instruction: string;
  options_seen: EvidenceOption[];
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

export type DisputeStatus = 'open' | 'evidence_assembled' | 'submitted' | 'resolved';

export interface DisputePacket {
  verdict: 'DEFENSIBLE' | 'MANDATE_BREACH';
  action: 'provide_evidence' | 'accept_claim';
  summary: string;
  narrative: string;
  evidence_record_ids: string[];
  chain_valid: boolean;
  assembled_at: string;
  submitted_at: string | null;
  paypal_response: Record<string, unknown> | null;
  /** Set when accepting the claim refunded the buyer at PayPal (feature B1). */
  refund?: DisputeRefund | null;
}

export interface DisputeRefund {
  paypal_refund_id: string;
  status: string;
  amount: Money;
  /** 'refund_api' = Sentry refunded the capture; 'accept_claim' = PayPal refunded as part of accepting a real dispute */
  source: 'refund_api' | 'accept_claim';
  refunded_at: string;
}

export interface Dispute {
  id: string;
  paypal_dispute_id: string | null;
  simulated: boolean;
  purchase_id: string | null;
  paypal_order_id: string | null;
  status: DisputeStatus;
  reason: string;
  amount: Money;
  created_at: string;
  updated_at: string;
  packet: DisputePacket | null;
}

export interface WebhookEventRecord {
  id: string;
  event_type: string;
  resource_type: string | null;
  received_at: string;
  verified: boolean;
  processed: boolean;
  purchase_id: string | null;
  error: string | null;
}

export type AgentOutcome = 'purchased' | 'awaiting_payer' | 'needs_approval' | 'blocked' | 'no_match' | 'needs_info' | 'failed';

export interface AgentChoice {
  sku: string;
  name: string;
  category: string;
  price: string;
}

export interface AgentResult {
  request_id: string;
  outcome: AgentOutcome;
  reply: string;
  purchase: Purchase | null;
  approval: Approval | null;
  evidence_record_id: string | null;
  /** Only when the agent asked a clarifying question: the items it could not decide between. */
  choices?: AgentChoice[];
}
