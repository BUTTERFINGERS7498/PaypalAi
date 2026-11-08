// The mandate checker: plain deterministic code, never the LLM. Contract section 8.
import type { Limits } from './types.ts';
import { toCents } from './util.ts';

export type Breach = 'inactive_mandate' | 'category_not_allowed' | 'exceeds_monthly_cap';
export type ApprovalReason = 'above_approval_threshold';

export interface CheckInput {
  status: 'active' | 'revoked';
  limits: Limits;
  category: string;
  priceCents: number;
  spentCents: number;
}

export interface CheckResult {
  within_mandate: boolean;
  breaches: Breach[];
  reasons: ApprovalReason[];
}

export function checkSelection(i: CheckInput): CheckResult {
  const breaches: Breach[] = [];
  if (i.status !== 'active') breaches.push('inactive_mandate');
  if (!i.limits.categories.map((c) => c.toLowerCase()).includes(i.category.toLowerCase())) breaches.push('category_not_allowed');
  if (i.spentCents + i.priceCents > toCents(i.limits.monthly_cap)) breaches.push('exceeds_monthly_cap');
  const reasons: ApprovalReason[] = [];
  if (breaches.length === 0 && i.priceCents > toCents(i.limits.approval_above)) reasons.push('above_approval_threshold');
  return { within_mandate: breaches.length === 0, breaches, reasons };
}
