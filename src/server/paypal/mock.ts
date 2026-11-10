// In-process fake PayPal for tests and no-credential demos (PAYPAL_MODE=mock).
// Enforces the same approval-ticket rule as the sandbox client and records every mutating call.
import type { Purchase } from '../types.ts';
import { assertTicket, type ApprovalTicket } from './ticket.ts';
import {
  PaypalError, type CapturedOrder, type CreatedOrder, type PaypalClient, type PaypalDispute, type RefundResult, type WebhookHeaders,
} from './types.ts';

export class MockPaypalClient implements PaypalClient {
  readonly mode = 'mock' as const;
  /** Every mutating call, for tests to assert on. */
  readonly calls: { op: 'create_order' | 'capture' | 'provide_evidence' | 'accept_claim' | 'refund' | 'capture_authorization' | 'void_authorization'; subject_id: string; target: string; detail?: unknown }[] = [];
  /** authorization id -> state, for holds (intent AUTHORIZE). */
  private auths = new Map<string, { status: 'CREATED' | 'CAPTURED' | 'VOIDED' | 'EXPIRED'; captureId: string | null; failNextCapture?: boolean }>();
  /** capture id -> refund, so a repeated request id returns the same refund and a second refund is refused. */
  private refunds = new Map<string, { requestId: string; result: RefundResult }>();
  private orders = new Map<string, { status: 'CREATED' | 'COMPLETED'; purchaseId: string }>();
  private disputes: PaypalDispute[] = [];
  private approved = new Set<string>();
  private counter = 0;

  async createOrder(ticket: ApprovalTicket, p: Purchase, opts: { intent?: 'CAPTURE' | 'AUTHORIZE' } = {}): Promise<CreatedOrder> {
    assertTicket(ticket);
    if (p.sku.endsWith('-FAIL')) throw new PaypalError('Mock PayPal rejected the order', 422, 'mock-debug-1');
    this.counter += 1;
    const id = `ORD-MOCK-${String(this.counter).padStart(4, '0')}-${p.id.slice(-6)}`;
    this.orders.set(id, { status: 'CREATED', purchaseId: p.id });
    this.calls.push({ op: 'create_order', subject_id: ticket.subject_id, target: id, detail: { intent: opts.intent ?? 'CAPTURE' } });
    if (opts.intent === 'AUTHORIZE') {
      // Like a card checkout at PayPal: the hold is placed while the order is created.
      const authId = `AUTH-MOCK-${String(this.counter).padStart(4, '0')}`;
      this.auths.set(authId, { status: 'CREATED', captureId: null });
      return { paypal_order_id: id, approve_url: null, status: 'COMPLETED', authorization_id: authId, authorization_expires: null };
    }
    return { paypal_order_id: id, approve_url: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, status: 'PAYER_ACTION_REQUIRED' };
  }

  async captureOrder(ticket: ApprovalTicket, orderId: string): Promise<CapturedOrder> {
    assertTicket(ticket);
    const o = this.orders.get(orderId);
    // Orders this in-memory fake never saw (e.g. seeded data, restarted server) are accepted.
    if (o?.status === 'COMPLETED') throw new PaypalError(`Mock order ${orderId} already captured`, 422, 'mock-debug-2');
    if (o) o.status = 'COMPLETED';
    this.calls.push({ op: 'capture', subject_id: ticket.subject_id, target: orderId });
    return { paypal_capture_id: `CAP-MOCK-${orderId.slice(-10)}` };
  }

  /** Test hook: pretend the buyer approved this order at PayPal (what getOrder will then report). */
  approveOrder(orderId: string): void { this.approved.add(orderId); }

  async getOrder(orderId: string): Promise<{ status: string; capture_id: string | null }> {
    const o = this.orders.get(orderId);
    if (!o) return { status: 'CREATED', capture_id: null }; // unknown to this in-memory fake (seeded data, restart)
    if (o.status === 'COMPLETED') return { status: 'COMPLETED', capture_id: `CAP-MOCK-${orderId.slice(-10)}` };
    return { status: this.approved.has(orderId) ? 'APPROVED' : 'PAYER_ACTION_REQUIRED', capture_id: null };
  }

  /** Test hook: pretend PayPal has this dispute. */
  addDispute(d: PaypalDispute): void { this.disputes.push(d); }

  async listDisputes(): Promise<PaypalDispute[]> { return [...this.disputes]; }

  async provideEvidence(ticket: ApprovalTicket, disputeId: string, evidence: { notes: string }): Promise<Record<string, unknown>> {
    assertTicket(ticket);
    this.calls.push({ op: 'provide_evidence', subject_id: ticket.subject_id, target: disputeId, detail: evidence });
    return { mock: true, action: 'provide_evidence', dispute_id: disputeId };
  }

  async acceptClaim(ticket: ApprovalTicket, disputeId: string, accept: { note: string }): Promise<Record<string, unknown>> {
    assertTicket(ticket);
    this.calls.push({ op: 'accept_claim', subject_id: ticket.subject_id, target: disputeId, detail: accept });
    return { mock: true, action: 'accept_claim', dispute_id: disputeId };
  }

  async refundCapture(ticket: ApprovalTicket, captureId: string, r: { amount: { currency_code: string; value: string }; note: string; requestId: string }): Promise<RefundResult> {
    assertTicket(ticket);
    if (captureId.endsWith('-NOREFUND')) throw new PaypalError('Mock PayPal refused the refund', 422, 'mock-debug-3');
    const prior = this.refunds.get(captureId);
    if (prior && prior.requestId === r.requestId) return prior.result; // idempotent, like PayPal-Request-Id
    if (prior) throw new PaypalError(`Mock capture ${captureId} is already fully refunded (CAPTURE_FULLY_REFUNDED)`, 422, 'mock-debug-4');
    this.counter += 1;
    // Test hooks: a capture id ending -PENDING / -REFUNDFAILS gets that refund status back, as PayPal can report.
    const status = captureId.endsWith('-PENDING') ? 'PENDING' : captureId.endsWith('-REFUNDFAILS') ? 'FAILED' : 'COMPLETED';
    const result: RefundResult = { paypal_refund_id: `REFUND-MOCK-${String(this.counter).padStart(4, '0')}`, status };
    this.refunds.set(captureId, { requestId: r.requestId, result });
    this.calls.push({ op: 'refund', subject_id: ticket.subject_id, target: captureId, detail: r });
    return result;
  }

  async captureAuthorization(ticket: ApprovalTicket, authorizationId: string, requestId: string): Promise<CapturedOrder> {
    assertTicket(ticket);
    const a = this.auths.get(authorizationId);
    if (!a) throw new PaypalError(`Mock authorization ${authorizationId} not found`, 404, 'mock-debug-5');
    if (a.status === 'CAPTURED') return { paypal_capture_id: a.captureId! }; // idempotent retry
    if (a.status === 'VOIDED' || a.status === 'EXPIRED') throw new PaypalError(`Mock authorization ${authorizationId} is ${a.status.toLowerCase()} (AUTHORIZATION_${a.status})`, 422, 'mock-debug-6');
    if (a.failNextCapture) { a.failNextCapture = false; a.status = 'EXPIRED'; throw new PaypalError(`Mock capture of ${authorizationId} failed (AUTHORIZATION_EXPIRED)`, 422, 'mock-debug-8'); }
    a.status = 'CAPTURED';
    a.captureId = `CAP-MOCK-${authorizationId.slice(-8)}`;
    this.calls.push({ op: 'capture_authorization', subject_id: ticket.subject_id, target: authorizationId, detail: { requestId } });
    return { paypal_capture_id: a.captureId };
  }

  async getAuthorization(authorizationId: string): Promise<{ status: string; expiration_time: string | null }> {
    const a = this.auths.get(authorizationId);
    if (!a) throw new PaypalError(`Mock authorization ${authorizationId} not found`, 404, 'mock-debug-5');
    return { status: a.status, expiration_time: null };
  }

  /** Test hook: PayPal drops the hold (as it does after 29 days, or from the dashboard). */
  expireAuthorization(authorizationId: string, status: 'EXPIRED' | 'VOIDED' = 'EXPIRED'): void {
    const a = this.auths.get(authorizationId);
    if (a) a.status = status;
  }

  /** Test hook: the next capture of this hold fails, and PayPal then reports it as EXPIRED. */
  failNextCapture(authorizationId: string): void {
    const a = this.auths.get(authorizationId);
    if (a) a.failNextCapture = true;
  }

  async voidAuthorization(ticket: ApprovalTicket, authorizationId: string): Promise<{ status: string }> {
    assertTicket(ticket);
    const a = this.auths.get(authorizationId);
    if (!a) throw new PaypalError(`Mock authorization ${authorizationId} not found`, 404, 'mock-debug-5');
    if (a.status === 'CAPTURED') throw new PaypalError(`Mock authorization ${authorizationId} is already captured`, 422, 'mock-debug-7');
    a.status = 'VOIDED';
    this.calls.push({ op: 'void_authorization', subject_id: ticket.subject_id, target: authorizationId });
    return { status: 'VOIDED' };
  }

  async verifyWebhook(h: WebhookHeaders, _event: unknown): Promise<boolean> {
    return h.transmission_sig === 'mock-valid';
  }
}
