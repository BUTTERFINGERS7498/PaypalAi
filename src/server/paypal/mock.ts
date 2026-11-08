// In-process fake PayPal for tests and no-credential demos (PAYPAL_MODE=mock).
// Enforces the same approval-ticket rule as the sandbox client and records every mutating call.
import type { Purchase } from '../types.ts';
import { assertTicket, type ApprovalTicket } from './ticket.ts';
import {
  PaypalError, type CapturedOrder, type CreatedOrder, type PaypalClient, type PaypalDispute, type WebhookHeaders,
} from './types.ts';

export class MockPaypalClient implements PaypalClient {
  readonly mode = 'mock' as const;
  /** Every mutating call, for tests to assert on. */
  readonly calls: { op: 'create_order' | 'capture' | 'provide_evidence' | 'accept_claim'; subject_id: string; target: string; detail?: unknown }[] = [];
  private orders = new Map<string, { status: 'CREATED' | 'COMPLETED'; purchaseId: string }>();
  private disputes: PaypalDispute[] = [];
  private approved = new Set<string>();
  private counter = 0;

  async createOrder(ticket: ApprovalTicket, p: Purchase): Promise<CreatedOrder> {
    assertTicket(ticket);
    if (p.sku.endsWith('-FAIL')) throw new PaypalError('Mock PayPal rejected the order', 422, 'mock-debug-1');
    this.counter += 1;
    const id = `ORD-MOCK-${String(this.counter).padStart(4, '0')}-${p.id.slice(-6)}`;
    this.orders.set(id, { status: 'CREATED', purchaseId: p.id });
    this.calls.push({ op: 'create_order', subject_id: ticket.subject_id, target: id });
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

  async verifyWebhook(h: WebhookHeaders, _event: unknown): Promise<boolean> {
    return h.transmission_sig === 'mock-valid';
  }
}
