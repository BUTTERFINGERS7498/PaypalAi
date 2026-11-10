// PayPal SANDBOX REST client: Orders v2, Disputes v1, webhook verification. The base URL is fixed to
// sandbox; there is no way to point this at live PayPal.
// NOTE: the Disputes calls follow PayPal's documented shapes but are UNVERIFIED against our sandbox app
// (plan risk #1: the Disputes API may be limited-release). Verify on Day 1 before relying on them.
import { PAYPAL_SANDBOX_BASE } from '../config.ts';
import type { Purchase } from '../types.ts';
import { assertTicket, type ApprovalTicket } from './ticket.ts';
import {
  PaypalError, type CapturedOrder, type CreatedOrder, type PaypalClient, type PaypalDispute, type RefundResult, type WebhookHeaders,
} from './types.ts';

/**
 * CHECKOUT_MODE=card pays with PayPal's PUBLISHED sandbox test Visa, so a purchase completes without a buyer login
 * (useful for a hosted demo that judges can try end to end). It only works against the sandbox, which is the only
 * base URL this client can use. Checked 2026-11-11: create returns COMPLETED with the capture included.
 */
const SANDBOX_TEST_CARD = {
  number: '4111111111111111', expiry: '2030-12', security_code: '123', name: 'Sentry Sandbox Tester',
  billing_address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
};

interface Opts {
  clientId: string;
  clientSecret: string;
  checkoutMode: 'payer_approval' | 'card';
  returnBaseUrl: string;
  webhookId: string;
  fetchImpl?: typeof fetch;
}

export class SandboxPaypalClient implements PaypalClient {
  readonly mode = 'sandbox' as const;
  private opts: Opts;
  private fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: Opts) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body.access_token) {
      throw new PaypalError(`PayPal auth failed (${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`, res.status, res.headers.get('paypal-debug-id'));
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}, form?: FormData): Promise<any> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...extraHeaders };
    if (!form) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
    if (!res.ok) {
      const detail = Array.isArray(data.details) && data.details[0]
        ? ` — ${data.details[0].field ?? ''} ${data.details[0].description ?? data.details[0].issue ?? ''}`.trimEnd()
        : '';
      throw new PaypalError(`PayPal ${method} ${path} failed (${res.status}): ${data.message ?? data.name ?? 'error'}${detail}`,
        res.status, res.headers.get('paypal-debug-id') ?? data.debug_id ?? null);
    }
    return data;
  }

  async createOrder(ticket: ApprovalTicket, p: Purchase, opts: { intent?: 'CAPTURE' | 'AUTHORIZE' } = {}): Promise<CreatedOrder> {
    assertTicket(ticket);
    const intent = opts.intent ?? 'CAPTURE';
    const body: Record<string, unknown> = {
      intent,
      purchase_units: [{
        reference_id: p.id,
        custom_id: p.id,
        description: p.item_name.slice(0, 127),
        amount: { currency_code: p.amount.currency_code, value: p.amount.value },
      }],
    };
    if (this.opts.checkoutMode === 'card') {
      body.payment_source = { card: SANDBOX_TEST_CARD };
    } else if (this.opts.checkoutMode === 'payer_approval') {
      body.payment_source = {
        paypal: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            user_action: 'PAY_NOW',
            return_url: `${this.opts.returnBaseUrl}/?order=return`,
            cancel_url: `${this.opts.returnBaseUrl}/?order=cancel`,
          },
        },
      };
    }
    // PayPal-Request-Id makes the create idempotent per purchase.
    const res = await this.call('POST', '/v2/checkout/orders', body, { 'paypal-request-id': `mandate-order-${p.id}${intent === 'AUTHORIZE' ? '-hold' : ''}`, prefer: 'return=representation' });
    if (!res.id) throw new PaypalError('PayPal create order returned no id', 502, null);
    const link = Array.isArray(res.links) ? res.links.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve') : null;
    const capture = res.purchase_units?.[0]?.payments?.captures?.[0];
    const auth = res.purchase_units?.[0]?.payments?.authorizations?.[0];
    return {
      paypal_order_id: res.id, approve_url: link?.href ?? null, status: res.status ?? 'CREATED',
      capture_id: capture?.status === 'COMPLETED' ? String(capture.id) : null,
      authorization_id: auth && (auth.status === 'CREATED' || auth.status === 'PENDING') ? String(auth.id) : null,
      authorization_expires: auth?.expiration_time ?? null,
    };
  }

  async captureAuthorization(ticket: ApprovalTicket, authorizationId: string, requestId: string): Promise<CapturedOrder> {
    assertTicket(ticket);
    const res = await this.call('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { final_capture: true },
      { 'paypal-request-id': `mandate-auth-capture-${requestId}`, prefer: 'return=representation' });
    if (!res.id) throw new PaypalError('PayPal authorization capture returned no id', 502, null);
    return { paypal_capture_id: String(res.id) };
  }

  async getAuthorization(authorizationId: string): Promise<{ status: string; expiration_time: string | null }> {
    const res = await this.call('GET', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
    return { status: String(res.status ?? 'UNKNOWN'), expiration_time: res.expiration_time ?? null };
  }

  async voidAuthorization(ticket: ApprovalTicket, authorizationId: string): Promise<{ status: string }> {
    assertTicket(ticket);
    // Checked 2026-11-11: returns 200 VOIDED with Prefer: return=representation (204 without it).
    const res = await this.call('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, { prefer: 'return=representation' });
    return { status: String(res.status ?? 'VOIDED') };
  }

  async captureOrder(ticket: ApprovalTicket, orderId: string): Promise<CapturedOrder> {
    assertTicket(ticket);
    const res = await this.call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { 'paypal-request-id': `mandate-capture-${orderId}` });
    const capture = res.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture?.id) throw new PaypalError(`PayPal capture returned no capture id (status ${res.status ?? 'unknown'})`, 502, null);
    return { paypal_capture_id: capture.id };
  }

  async getOrder(paypalOrderId: string): Promise<{ status: string; capture_id: string | null }> {
    const res = await this.call('GET', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
    return { status: String(res.status ?? 'UNKNOWN'), capture_id: res.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null };
  }

  async listDisputes(): Promise<PaypalDispute[]> {
    const res = await this.call('GET', '/v1/customer/disputes?page_size=50');
    const items: any[] = res.items ?? [];
    return items.map((d) => ({
      dispute_id: d.dispute_id,
      status: d.status ?? 'OPEN',
      reason: d.reason ?? '',
      order_id: d.disputed_transactions?.[0]?.seller_transaction_id ?? null,
      capture_id: d.disputed_transactions?.[0]?.seller_transaction_id ?? null,
      amount: { currency_code: d.dispute_amount?.currency_code ?? 'USD', value: d.dispute_amount?.value ?? '0.00' },
    }));
  }

  async provideEvidence(ticket: ApprovalTicket, disputeId: string, evidence: { notes: string; pdf?: Buffer; filename?: string }): Promise<Record<string, unknown>> {
    assertTicket(ticket);
    // NOTE (feature B3): the attachment follows PayPal's documented multipart shape (input JSON + evidence-file parts,
    // referenced by name), but no real sandbox dispute could be opened, so this call is NOT verified against PayPal.
    const form = new FormData();
    const name = evidence.filename ?? 'sentry-evidence.pdf';
    const item: Record<string, unknown> = { evidence_type: 'OTHER', notes: evidence.notes.slice(0, 2000) };
    if (evidence.pdf) item.documents = [{ name }];
    form.append('input', new Blob([JSON.stringify({ evidences: [item] })], { type: 'application/json' }), 'input.json');
    if (evidence.pdf) form.append('evidence-file', new Blob([new Uint8Array(evidence.pdf)], { type: 'application/pdf' }), name);
    return this.call('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, undefined, {}, form);
  }

  async refundCapture(ticket: ApprovalTicket, captureId: string, r: { amount: { currency_code: string; value: string }; note: string; requestId: string }): Promise<RefundResult> {
    assertTicket(ticket);
    // Checked against the sandbox on 2026-11-11: full and partial refunds return 201 COMPLETED, a repeated
    // PayPal-Request-Id returns the same refund, and an over-refund is rejected with CAPTURE_FULLY_REFUNDED.
    const res = await this.call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: r.amount, note_to_payer: r.note.slice(0, 255) },
      { 'paypal-request-id': `mandate-refund-${r.requestId}`, prefer: 'return=representation' });
    if (!res.id) throw new PaypalError('PayPal refund returned no id', 502, null);
    return { paypal_refund_id: String(res.id), status: String(res.status ?? 'UNKNOWN') };
  }

  async createPayout(ticket: ApprovalTicket, p: { amount: { currency_code: string; value: string }; receiverEmail: string; note: string; senderBatchId: string; senderItemId: string }): Promise<{ payout_batch_id: string; batch_status: string }> {
    assertTicket(ticket);
    // Checked 2026-11-11: the app has the payouts scope; a payout to the sandbox account that also sends it is
    // DENIED with SELF_PAY_NOT_ALLOWED, so the receiver must be a different sandbox account.
    const res = await this.call('POST', '/v1/payments/payouts', {
      sender_batch_header: { sender_batch_id: p.senderBatchId, email_subject: 'Your refund (PayPal sandbox)' },
      items: [{ recipient_type: 'EMAIL', amount: { value: p.amount.value, currency: p.amount.currency_code }, receiver: p.receiverEmail, note: p.note.slice(0, 4000), sender_item_id: p.senderItemId }],
    });
    const id = res.batch_header?.payout_batch_id;
    if (!id) throw new PaypalError('PayPal payout returned no batch id', 502, null);
    return { payout_batch_id: String(id), batch_status: String(res.batch_header?.batch_status ?? 'PENDING') };
  }

  async getPayout(batchId: string): Promise<{ batch_status: string; item_status: string | null; error: string | null }> {
    const res = await this.call('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
    const item = res.items?.[0];
    return { batch_status: String(res.batch_header?.batch_status ?? 'UNKNOWN'), item_status: item?.transaction_status ?? null, error: item?.errors?.name ?? null };
  }

  async acceptClaim(ticket: ApprovalTicket, disputeId: string, accept: { note: string }): Promise<Record<string, unknown>> {
    assertTicket(ticket);
    return this.call('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`,
      { note: accept.note.slice(0, 2000), accept_claim_reason: 'REASON_NOT_SET' });
  }

  async verifyWebhook(h: WebhookHeaders, event: unknown): Promise<boolean> {
    if (!h.transmission_id || !h.transmission_sig || !h.cert_url || !h.auth_algo || !h.transmission_time) return false;
    const res = await this.call('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: h.auth_algo, cert_url: h.cert_url, transmission_id: h.transmission_id,
      transmission_sig: h.transmission_sig, transmission_time: h.transmission_time,
      webhook_id: this.opts.webhookId, webhook_event: event,
    });
    return res.verification_status === 'SUCCESS';
  }
}
