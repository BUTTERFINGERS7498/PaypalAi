// Inbound PayPal webhooks: verify, store idempotently, apply to purchases and disputes (contract section 5).
import type { Config } from './config.ts';
import type { DisputeService } from './disputes.ts';
import type { Gate } from './gate.ts';
import type { PaypalClient, WebhookHeaders } from './paypal/types.ts';
import type { Store } from './store.ts';
import { badRequest, HttpError } from './util.ts';

export interface WebhookResult {
  received: true;
  duplicate: boolean;
}

function header(h: Record<string, string | string[] | undefined>, name: string): string {
  const v = h[name];
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export class WebhookHandler {
  private store: Store;
  private paypal: PaypalClient;
  private gate: Gate;
  private disputes: DisputeService;
  private cfg: Config;

  constructor(store: Store, paypal: PaypalClient, gate: Gate, disputes: DisputeService, cfg: Config) {
    this.store = store;
    this.paypal = paypal;
    this.gate = gate;
    this.disputes = disputes;
    this.cfg = cfg;
  }

  async handle(headers: Record<string, string | string[] | undefined>, event: any): Promise<WebhookResult> {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.event_type !== 'string') {
      throw badRequest('Webhook body must be a PayPal event with id and event_type');
    }

    let verified = false;
    if (this.cfg.webhookVerify === 'paypal') {
      const h: WebhookHeaders = {
        auth_algo: header(headers, 'paypal-auth-algo'), cert_url: header(headers, 'paypal-cert-url'),
        transmission_id: header(headers, 'paypal-transmission-id'), transmission_sig: header(headers, 'paypal-transmission-sig'),
        transmission_time: header(headers, 'paypal-transmission-time'),
      };
      try {
        verified = await this.paypal.verifyWebhook(h, event);
      } catch (err) {
        verified = false;
        console.warn('[webhook] verification call failed:', err instanceof Error ? err.message : err);
      }
      if (!verified) throw new HttpError(400, 'bad_request', 'Webhook signature verification failed');
    } else {
      console.warn(`[webhook] WEBHOOK_VERIFY=off: accepting unverified ${event.event_type} ${event.id}`);
    }

    const fresh = this.store.insertWebhook({ id: event.id, event_type: event.event_type, resource_type: event.resource_type ?? null, verified, raw: event });
    if (!fresh) return { received: true, duplicate: true };

    try {
      await this.apply(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.markWebhook(event.id, { processed: false, error: msg });
      console.error('[webhook] processing failed:', msg);
    }
    // Sanitised receipt log (Render day-1 done-test): ids and status only, never the body or headers.
    const rec = this.store.listWebhooks(1)[0];
    console.log(`[webhook] received type=${String(event.event_type).slice(0, 64)} id=${String(event.id).slice(0, 64)} verified=${verified} processed=${rec?.id === event.id ? rec.processed : 'unknown'}`);
    return { received: true, duplicate: false };
  }

  private async apply(event: any): Promise<void> {
    const type: string = event.event_type;
    const res = event.resource ?? {};

    if (type === 'CHECKOUT.ORDER.APPROVED') {
      const p = res.id ? await this.gate.onOrderApproved(String(res.id)) : null;
      return this.done(event.id, p?.id ?? null, p ? null : 'unknown_purchase');
    }
    if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'PAYMENT.CAPTURE.DENIED') {
      const orderId: string | undefined = res.supplementary_data?.related_ids?.order_id ?? res.order_id;
      const p = orderId
        ? (type === 'PAYMENT.CAPTURE.COMPLETED' ? this.gate.onCaptureCompleted(orderId, res.id ?? null) : this.gate.onCaptureDenied(orderId))
        : null;
      return this.done(event.id, p?.id ?? null, p ? null : 'unknown_purchase');
    }
    if (type === 'PAYMENT.AUTHORIZATION.VOIDED') {
      // A hold was voided at PayPal (dashboard, or after it expired). Our own voids find the purchase already closed.
      const p = res.id ? this.gate.onAuthorizationVoided(String(res.id)) : null;
      return this.done(event.id, p?.id ?? null, p ? null : 'unknown_purchase');
    }
    if (type === 'PAYMENT.CAPTURE.REFUNDED') {
      // The resource is the refund; its "up" link points at the capture it refunds.
      const up = Array.isArray(res.links) ? res.links.find((l: any) => l?.rel === 'up' && typeof l.href === 'string') : null;
      const captureId: string | undefined = up?.href?.match(/\/captures\/([^/?#]+)/)?.[1];
      const p = captureId ? this.gate.onCaptureRefunded(captureId, {
        id: res.id ?? null, status: res.status ?? null, amount: res.amount?.value ?? null,
        totalRefunded: res.seller_payable_breakdown?.total_refunded_amount?.value ?? null,
      }) : null;
      return this.done(event.id, p?.id ?? null, p ? null : 'unknown_purchase');
    }
    if (type.startsWith('CUSTOMER.DISPUTE.')) {
      const ppId: string | undefined = res.dispute_id;
      if (!ppId) return this.done(event.id, null, 'missing_dispute_id');
      let dsp = this.store.getDisputeByPaypalId(ppId);
      if (!dsp && type === 'CUSTOMER.DISPUTE.CREATED') {
        const tx = res.disputed_transactions?.[0];
        const purchase = this.disputes.matchPurchase(tx?.seller_transaction_id ?? res.order_id ?? null, tx?.seller_transaction_id ?? null);
        if (!purchase) return this.done(event.id, null, 'unknown_purchase');
        dsp = this.disputes.open({
          paypal_dispute_id: ppId, simulated: false, purchase, reason: res.reason ?? '',
          amount: { currency_code: res.dispute_amount?.currency_code ?? purchase.amount.currency_code, value: res.dispute_amount?.value ?? purchase.amount.value },
        });
      } else if (dsp && type === 'CUSTOMER.DISPUTE.RESOLVED') {
        this.store.updateDispute(dsp.id, { status: 'resolved' });
        if (dsp.purchase_id) this.store.updatePurchase(dsp.purchase_id, { status: 'dispute_resolved' });
      } else if (dsp && type === 'CUSTOMER.DISPUTE.UPDATED') {
        if (res.reason) this.store.updateDispute(dsp.id, { reason: String(res.reason) });
      }
      return this.done(event.id, dsp?.purchase_id ?? null, dsp ? null : 'unknown_purchase');
    }
    this.store.markWebhook(event.id, { processed: true });
  }

  private done(id: string, purchaseId: string | null, error: string | null): void {
    this.store.markWebhook(id, { processed: !error, purchase_id: purchaseId, error });
  }
}
