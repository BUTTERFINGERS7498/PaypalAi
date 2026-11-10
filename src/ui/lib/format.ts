import type { Money } from "./types";

export const fmtMoney = (m: Money | null | undefined) => (m ? `${m.currency_code} ${m.value}` : "—");
export const usd = (v: string) => `USD ${v}`;
export const short = (h: string | null | undefined, n = 10) => (h ? h.slice(0, n) + "…" : "—");

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export const BREACH_LABEL: Record<string, string> = {
  inactive_mandate: "mandate not active",
  category_not_allowed: "category not allowed",
  exceeds_monthly_cap: "exceeds monthly cap",
};
export const breachLabel = (b: string) => BREACH_LABEL[b] ?? b;

export const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  awaiting_payer: "Awaiting payer",
  completed: "Completed",
  rejected: "Rejected",
  failed: "Failed",
  disputed: "Disputed",
  dispute_resolved: "Dispute resolved",
};

export const DECISION_LABEL: Record<string, string> = {
  selected: "Agent selected an item",
  needs_approval: "Needs human approval",
  blocked: "Blocked by mandate checker",
  no_match: "No match in catalog",
  approved: "Human approved",
  rejected: "Human rejected",
  order_created: "PayPal sandbox order created",
  captured: "Payment captured",
  mandate_revoked: "Mandate revoked",
  clarify: "Agent asked a question",
};

export const REASON_LABEL: Record<string, string> = {
  above_approval_threshold: "above the approval line",
  low_match_confidence: "the agent was not sure this is what you meant",
};
export const reasonLabel = (r: string) => REASON_LABEL[r] ?? r.replace(/_/g, " ");
