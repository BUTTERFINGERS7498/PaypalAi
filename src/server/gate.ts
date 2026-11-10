// The checkout gate. The ONLY module that mints approval tickets, so every PayPal mutation passes here:
//   * a within-mandate selection at/under the approval threshold   -> auto-authorised ('mandate')
//   * a selection above the threshold                                -> only after a human approves
//   * capture after the payer approved at PayPal                     -> 'payer'
//   * a dispute response                                             -> only when a human submits it
import { checkSelection } from './checker.ts';
import type { Config } from './config.ts';
import type { EvidenceLog } from './evidence.ts';
import type { MandateService } from './mandates.ts';
import type { PaypalClient } from './paypal/types.ts';
import { PaypalError } from './paypal/types.ts';
import { mintTicket } from './paypal/ticket.ts';
import type { Store } from './store.ts';
import type { Approval, CatalogItem, Dispute, DisputePacket, EvidenceOption, EvidenceRecord, Mandate, Purchase } from './types.ts';
import { centsToMoney, formatMoney, invalidState, mandateInactive, notFound, nowIso, toCents } from './util.ts';

export interface SelectionRequest {
  request_id: string;
  mandate: Mandate;
  instruction: string;
  options_seen: CatalogItem[];
  item: CatalogItem;
  rationale: string;
  demo_rogue: boolean;
  /** How the agent reached its choice (scores, query expansion, substitution...). Stored in the evidence record. */
  trace?: Record<string, unknown>;
  /** The agent was not sure this is what the user meant (see the mandate's optional ask_when_unsure clause). */
  low_confidence?: boolean;
}

export interface SelectionOutcome {
  outcome: 'purchased' | 'awaiting_payer' | 'needs_approval' | 'blocked' | 'failed';
  reply: string;
  purchase: Purchase | null;
  approval: Approval | null;
  evidence: EvidenceRecord;
}

const toOption = (i: CatalogItem): EvidenceOption => ({ sku: i.sku, name: i.name, category: i.category, price: i.price.value });
const errInfo = (err: unknown) => ({
  message: err instanceof Error ? err.message : String(err),
  ...(err instanceof PaypalError && err.debug_id ? { paypal_debug_id: err.debug_id } : {}),
});

export class Gate {
  private store: Store;
  private paypal: PaypalClient;
  private mandates: MandateService;
  private evidence: EvidenceLog;
  private cfg: Config;
  /** Purchase ids with a capture call in flight (see capture()). */
  private capturing = new Set<string>();

  constructor(store: Store, paypal: PaypalClient, mandates: MandateService, evidence: EvidenceLog, cfg: Config) {
    this.store = store;
    this.paypal = paypal;
    this.mandates = mandates;
    this.evidence = evidence;
    this.cfg = cfg;
  }

  /** The mandate version that governed this purchase, for evidence snapshots. */
  private snapshotFor(p: Purchase) {
    const m = this.mandates.get(p.mandate_id, p.mandate_version) ?? this.mandates.require(p.mandate_id);
    return this.mandates.snapshot({ ...m, status: this.mandates.require(p.mandate_id).status });
  }

  // ---------------------------------------------------------------------------------------------
  // The agent's selection: checker verdict -> evidence -> (maybe) purchase / approval / checkout
  // ---------------------------------------------------------------------------------------------
  async proposeSelection(r: SelectionRequest): Promise<SelectionOutcome> {
    const m = this.mandates.require(r.mandate.id);
    if (m.status !== 'active') throw mandateInactive(`Mandate ${m.id} is revoked`);

    const price = toCents(r.item.price.value);
    const spent = this.store.spentCents(m.id);
    const check = checkSelection({ status: m.status, limits: m.limits, category: r.item.category, priceCents: price, spentCents: spent, lowConfidence: r.low_confidence === true });
    const snapshot = this.mandates.snapshot(m);
    const base = {
      mandate: snapshot,
      user_instruction: r.instruction,
      options_seen: r.options_seen.map(toOption),
      choice: { sku: r.item.sku, price: r.item.price.value },
      rationale: r.rationale,
      budget_before: centsToMoney(spent),
      within_mandate: check.within_mandate,
      breaches: check.breaches as string[],
      demo_rogue: r.demo_rogue,
      data: r.trace ? { agent: r.trace } : {},
    };
    const itemLabel = `${r.item.name} (${formatMoney(r.item.price.currency_code, r.item.price.value)})`;

    // 1. Out of mandate and not the rogue demo: refuse. No purchase, no PayPal.
    if (!check.within_mandate && !r.demo_rogue) {
      // budget_after is what the budget WOULD have been had the choice executed: it makes an overshoot visible.
      const ev = this.evidence.append({ ...base, decision: 'blocked', budget_after: centsToMoney(spent + price) });
      return { outcome: 'blocked', purchase: null, approval: null, evidence: ev,
        reply: `Blocked: ${itemLabel} is outside your mandate (${check.breaches.join(', ').replace(/_/g, ' ')}). Nothing was bought.` };
    }

    const newPurchase = (status: 'pending_approval' | 'awaiting_payer') => this.store.insertPurchase({
      mandate_id: m.id, mandate_version: m.version, sku: r.item.sku, item_name: r.item.name, category: r.item.category,
      amount: { currency_code: r.item.price.currency_code, value: r.item.price.value }, status,
      within_mandate: check.within_mandate, breaches: check.breaches, demo_rogue: r.demo_rogue, request_id: r.request_id,
    });

    // 2. Within mandate but above the approval threshold: queue for a human. Nothing is charged.
    if (check.within_mandate && check.reasons.length) {
      const purchase = newPurchase('pending_approval');
      const why = check.reasons.map((x) => x === 'above_approval_threshold'
        ? `above your ${formatMoney('USD', m.limits.approval_above)} approval threshold`
        : 'the agent was not sure this is what you meant').join('; ');
      const approval = this.store.insertApproval({
        purchase_id: purchase.id,
        summary: `Buy ${r.item.name} (${formatMoney(r.item.price.currency_code, r.item.price.value)}): ${why}`,
        reasons: check.reasons,
      });
      const withApproval = this.store.updatePurchase(purchase.id, { approval_id: approval.id });
      const ev = this.evidence.append({ ...base, decision: 'needs_approval', budget_after: centsToMoney(spent + price), purchase_id: purchase.id });
      return { outcome: 'needs_approval', purchase: withApproval, approval, evidence: ev,
        reply: check.reasons.includes('above_approval_threshold')
          ? `${itemLabel} is above your ${formatMoney('USD', m.limits.approval_above)} threshold, so it is waiting for your approval. Nothing was charged.`
          : `I'm not sure ${itemLabel} is what you meant, and your mandate says to ask when unsure, so it is waiting for your approval. Nothing was charged.` };
    }

    // 3. Within mandate, under the threshold (or the labelled rogue demo): check out.
    const purchase = newPurchase('awaiting_payer');
    const ev = this.evidence.append({ ...base, decision: 'selected', budget_after: centsToMoney(spent + price), purchase_id: purchase.id });
    const done = await this.checkout(purchase, r.demo_rogue ? 'mandate (demo rogue override)' : 'mandate');
    const reply = done.status === 'completed'
      ? `Bought ${itemLabel}. Budget left: ${formatMoney('USD', centsToMoney(Math.max(0, toCents(m.limits.monthly_cap) - spent - price)))}.`
      : done.status === 'awaiting_payer'
        ? `Order created for ${itemLabel}. The buyer must approve it at PayPal to complete the payment.`
        : `The order for ${itemLabel} could not be created (see the evidence trail).`;
    return { outcome: done.status === 'completed' ? 'purchased' : done.status === 'awaiting_payer' ? 'awaiting_payer' : 'failed',
      purchase: done, approval: null, evidence: ev, reply };
  }

  // ---------------------------------------------------------------------------------------------
  // Human decisions on queued purchases
  // ---------------------------------------------------------------------------------------------
  async approve(approvalId: string, by: string, note: string | null): Promise<{ approval: Approval; purchase: Purchase }> {
    const ap = this.store.getApproval(approvalId);
    if (!ap) throw notFound(`Approval ${approvalId} not found`);
    if (ap.status !== 'pending') throw invalidState(`Approval ${approvalId} is ${ap.status}, not pending`, { status: ap.status });
    const decided = this.store.decideApproval(approvalId, 'approved', by, note);
    if (!decided) throw invalidState(`Approval ${approvalId} was decided concurrently`);

    const purchase = this.store.getPurchase(ap.purchase_id)!;
    // Re-check against the CURRENT mandate: it may have been revoked or the budget used up since.
    const m = this.mandates.require(purchase.mandate_id);
    const check = checkSelection({
      status: m.status, limits: m.limits, category: purchase.category,
      priceCents: toCents(purchase.amount.value), spentCents: this.store.spentCents(m.id),
    });
    const spent = this.store.spentCents(m.id);
    this.evidence.append({
      decision: 'approved', mandate: this.mandates.snapshot(m), purchase_id: purchase.id,
      choice: { sku: purchase.sku, price: purchase.amount.value },
      budget_before: centsToMoney(spent), budget_after: centsToMoney(check.within_mandate ? spent + toCents(purchase.amount.value) : spent),
      within_mandate: check.within_mandate, breaches: check.breaches,
      data: { approval_id: approvalId, decided_by: by, note, rechecked_against_version: m.version },
    });

    if (!check.within_mandate) {
      const failed = this.store.transitionPurchase(purchase.id, 'pending_approval', { status: 'failed', within_mandate: false, breaches: check.breaches });
      return { approval: decided, purchase: failed ?? this.store.getPurchase(purchase.id)! };
    }
    const moved = this.store.transitionPurchase(purchase.id, 'pending_approval', { status: 'awaiting_payer' });
    if (!moved) throw invalidState(`Purchase ${purchase.id} is no longer pending approval`);
    const done = await this.checkout(moved, `human:${by}`);
    return { approval: decided, purchase: done };
  }

  reject(approvalId: string, by: string, note: string | null): { approval: Approval; purchase: Purchase } {
    const ap = this.store.getApproval(approvalId);
    if (!ap) throw notFound(`Approval ${approvalId} not found`);
    if (ap.status !== 'pending') throw invalidState(`Approval ${approvalId} is ${ap.status}, not pending`, { status: ap.status });
    const decided = this.store.decideApproval(approvalId, 'rejected', by, note);
    if (!decided) throw invalidState(`Approval ${approvalId} was decided concurrently`);
    const purchase = this.store.getPurchase(ap.purchase_id)!;
    const rejected = this.store.transitionPurchase(purchase.id, 'pending_approval', { status: 'rejected' }) ?? this.store.getPurchase(purchase.id)!;
    const m = this.mandates.require(purchase.mandate_id);
    const spent = this.store.spentMoney(m.id);
    this.evidence.append({
      decision: 'rejected', mandate: this.mandates.snapshot(m), purchase_id: purchase.id,
      choice: { sku: purchase.sku, price: purchase.amount.value }, budget_before: spent, budget_after: spent,
      data: { approval_id: approvalId, decided_by: by, note },
    });
    return { approval: decided, purchase: rejected };
  }

  // ---------------------------------------------------------------------------------------------
  // PayPal order lifecycle (every mutation below mints a ticket)
  // ---------------------------------------------------------------------------------------------
  /** Creates the PayPal order for a purchase that has been authorised. Leaves it awaiting_payer, or captures in card mode. */
  private async checkout(p: Purchase, authorisedBy: string): Promise<Purchase> {
    const ticket = mintTicket(p.id, authorisedBy);
    try {
      const o = await this.paypal.createOrder(ticket, p);
      const updated = this.store.updatePurchase(p.id, { paypal_order_id: o.paypal_order_id, ...(o.approve_url ? { approve_url: o.approve_url } : {}), status: 'awaiting_payer' });
      this.evidence.append({
        decision: 'order_created', mandate: this.snapshotFor(updated), purchase_id: updated.id, paypal_order_id: o.paypal_order_id,
        choice: { sku: updated.sku, price: updated.amount.value },
        budget_before: this.store.spentMoney(updated.mandate_id), budget_after: this.store.spentMoney(updated.mandate_id),
        within_mandate: updated.within_mandate, breaches: updated.breaches, demo_rogue: updated.demo_rogue,
        data: { approve_url: o.approve_url, order_status: o.status, authorised_by: authorisedBy, paypal_mode: this.paypal.mode },
      });
      return this.cfg.checkoutMode === 'card' ? await this.capture(updated, authorisedBy, 'card_checkout') : updated;
    } catch (err) {
      const failed = this.store.transitionPurchase(p.id, 'awaiting_payer', { status: 'failed' }) ?? this.store.getPurchase(p.id)!;
      this.evidence.append({
        decision: 'order_failed', mandate: this.snapshotFor(failed), purchase_id: failed.id,
        choice: { sku: failed.sku, price: failed.amount.value },
        budget_before: this.store.spentMoney(failed.mandate_id), budget_after: this.store.spentMoney(failed.mandate_id),
        within_mandate: failed.within_mandate, breaches: failed.breaches, demo_rogue: failed.demo_rogue,
        data: { authorised_by: authorisedBy, error: errInfo(err) },
      });
      return failed;
    }
  }

  /** Captures an order the payer has approved. Idempotent: a purchase leaves awaiting_payer at most once. */
  private async capture(p: Purchase, authorisedBy: string, source: string = 'direct'): Promise<Purchase> {
    if (p.status !== 'awaiting_payer' || !p.paypal_order_id) return p;
    // The webhook, the reconciler and a manual reconcile can race for the same order: only one capture call at a time.
    if (this.capturing.has(p.id)) return this.store.getPurchase(p.id) ?? p;
    this.capturing.add(p.id);
    const ticket = mintTicket(p.id, authorisedBy);
    try {
      const cap = await this.paypal.captureOrder(ticket, p.paypal_order_id);
      const done = this.store.transitionPurchase(p.id, 'awaiting_payer', { status: 'completed', paypal_capture_id: cap.paypal_capture_id, completed_at: nowIso() });
      if (!done) return this.store.getPurchase(p.id)!;
      this.evidence.append({
        decision: 'captured', mandate: this.snapshotFor(done), purchase_id: done.id, paypal_order_id: done.paypal_order_id,
        choice: { sku: done.sku, price: done.amount.value },
        budget_before: this.store.spentMoney(done.mandate_id), budget_after: this.store.spentMoney(done.mandate_id),
        within_mandate: done.within_mandate, breaches: done.breaches, demo_rogue: done.demo_rogue,
        data: { paypal_capture_id: cap.paypal_capture_id, authorised_by: authorisedBy, source },
      });
      return done;
    } catch (err) {
      // Only record a failure if THIS call is the one that moved the purchase out of awaiting_payer.
      const moved = this.store.transitionPurchase(p.id, 'awaiting_payer', { status: 'failed' });
      if (!moved) return this.store.getPurchase(p.id)!;
      const failed = moved;
      this.evidence.append({
        decision: 'order_failed', mandate: this.snapshotFor(failed), purchase_id: failed.id, paypal_order_id: failed.paypal_order_id,
        choice: { sku: failed.sku, price: failed.amount.value },
        budget_before: this.store.spentMoney(failed.mandate_id), budget_after: this.store.spentMoney(failed.mandate_id),
        within_mandate: failed.within_mandate, breaches: failed.breaches, demo_rogue: failed.demo_rogue,
        data: { stage: 'capture', authorised_by: authorisedBy, source, error: errInfo(err) },
      });
      return failed;
    } finally {
      this.capturing.delete(p.id);
    }
  }

  /** Webhook CHECKOUT.ORDER.APPROVED: the buyer approved at PayPal, so capture. */
  async onOrderApproved(orderId: string): Promise<Purchase | null> {
    const p = this.store.getPurchaseByOrderId(orderId);
    if (!p) return null;
    return this.capture(p, 'payer', 'webhook');
  }

  /**
   * Safety net for slow or lost webhooks. For one awaiting_payer purchase, ask PayPal what the order's state is:
   *   APPROVED  -> the buyer approved it at PayPal, so capture (authorised_by 'payer', source 'reconcile')
   *   COMPLETED -> already captured elsewhere, so just record it
   *   anything else (CREATED, PAYER_ACTION_REQUIRED, VOIDED...) -> leave it alone
   * The buyer's approval AT PAYPAL stays the only authorisation; this never captures an order PayPal has not approved.
   */
  async reconcilePurchase(p: Purchase): Promise<{ purchase: Purchase; action: 'captured' | 'completed' | 'waiting' | 'skipped' | 'error'; paypal_status?: string }> {
    if (p.status !== 'awaiting_payer' || !p.paypal_order_id) return { purchase: p, action: 'skipped' };
    let order;
    try {
      order = await this.paypal.getOrder(p.paypal_order_id);
    } catch {
      return { purchase: p, action: 'error' };
    }
    if (order.status === 'APPROVED') {
      const done = await this.capture(p, 'payer', 'reconcile');
      return { purchase: done, action: done.status === 'completed' ? 'captured' : 'error', paypal_status: order.status };
    }
    if (order.status === 'COMPLETED') {
      const done = this.onCaptureCompleted(p.paypal_order_id, order.capture_id) ?? p;
      return { purchase: done, action: 'completed', paypal_status: order.status };
    }
    return { purchase: p, action: 'waiting', paypal_status: order.status };
  }

  /** One pass over recent awaiting_payer purchases (bounded: newest 10 from the last 24 hours). */
  async reconcileAll(): Promise<{ checked: number; captured: number; completed: number }> {
    const cutoff = Date.now() - 24 * 3600_000;
    const pending = this.store.listPurchases({ status: 'awaiting_payer' })
      .filter((p) => p.paypal_order_id && Date.parse(p.created_at) > cutoff)
      .slice(0, 10);
    let captured = 0;
    let completed = 0;
    for (const p of pending) {
      const r = await this.reconcilePurchase(p);
      if (r.action === 'captured') captured += 1;
      if (r.action === 'completed') completed += 1;
    }
    return { checked: pending.length, captured, completed };
  }

  /** Webhook PAYMENT.CAPTURE.COMPLETED. Fills in the capture id; completes the purchase if we have not already. */
  onCaptureCompleted(orderId: string, captureId: string | null): Purchase | null {
    const p = this.store.getPurchaseByOrderId(orderId);
    if (!p) return null;
    if (p.status === 'awaiting_payer') {
      const done = this.store.transitionPurchase(p.id, 'awaiting_payer', { status: 'completed', ...(captureId ? { paypal_capture_id: captureId } : {}), completed_at: nowIso() });
      if (done) {
        this.evidence.append({
          decision: 'captured', mandate: this.snapshotFor(done), purchase_id: done.id, paypal_order_id: done.paypal_order_id,
          choice: { sku: done.sku, price: done.amount.value },
          budget_before: this.store.spentMoney(done.mandate_id), budget_after: this.store.spentMoney(done.mandate_id),
          within_mandate: done.within_mandate, breaches: done.breaches, demo_rogue: done.demo_rogue,
          data: { paypal_capture_id: captureId, source: 'webhook' },
        });
        return done;
      }
    } else if (captureId && !p.paypal_capture_id) {
      return this.store.updatePurchase(p.id, { paypal_capture_id: captureId });
    }
    return this.store.getPurchase(p.id);
  }

  onCaptureDenied(orderId: string): Purchase | null {
    const p = this.store.getPurchaseByOrderId(orderId);
    if (!p) return null;
    if (p.status !== 'awaiting_payer') return p;
    const failed = this.store.transitionPurchase(p.id, 'awaiting_payer', { status: 'failed' }) ?? p;
    this.evidence.append({
      decision: 'order_failed', mandate: this.snapshotFor(failed), purchase_id: failed.id, paypal_order_id: failed.paypal_order_id,
      choice: { sku: failed.sku, price: failed.amount.value },
      budget_before: this.store.spentMoney(failed.mandate_id), budget_after: this.store.spentMoney(failed.mandate_id),
      within_mandate: failed.within_mandate, breaches: failed.breaches, demo_rogue: failed.demo_rogue,
      data: { stage: 'capture', source: 'webhook', event: 'PAYMENT.CAPTURE.DENIED' },
    });
    return failed;
  }

  // ---------------------------------------------------------------------------------------------
  // Dispute response: only a human's explicit submit gets a ticket
  // ---------------------------------------------------------------------------------------------
  async submitDisputeResponse(d: Dispute, packet: DisputePacket, by: string): Promise<Record<string, unknown>> {
    if (d.simulated || !d.paypal_dispute_id) return { simulated: true, action: packet.action, note: 'Simulated dispute: no PayPal call was made.' };
    const ticket = mintTicket(d.id, `human:${by}`);
    return packet.action === 'provide_evidence'
      ? this.paypal.provideEvidence(ticket, d.paypal_dispute_id, { notes: packet.narrative })
      : this.paypal.acceptClaim(ticket, d.paypal_dispute_id, { note: packet.narrative });
  }
}
