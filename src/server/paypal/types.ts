import type { Purchase } from '../types.ts';
import type { ApprovalTicket } from './ticket.ts';

export interface CreatedOrder {
  paypal_order_id: string;
  approve_url: string | null;
  status: string;
  /** Card checkout only: PayPal captured the payment as part of creating the order. */
  capture_id?: string | null;
  /** intent AUTHORIZE with card checkout: the hold PayPal placed while creating the order. */
  authorization_id?: string | null;
  authorization_expires?: string | null;
}

export interface CapturedOrder {
  paypal_capture_id: string;
}

export interface RefundResult {
  paypal_refund_id: string;
  /** PayPal refund status: COMPLETED, PENDING, ... */
  status: string;
}

/** The slice of a PayPal dispute the app needs. */
export interface PaypalDispute {
  dispute_id: string;
  status: string;
  reason: string;
  order_id: string | null;
  capture_id: string | null;
  amount: { currency_code: string; value: string };
}

export interface WebhookHeaders {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
}

export class PaypalError extends Error {
  status: number;
  debug_id: string | null;
  constructor(message: string, status: number, debug_id: string | null) {
    super(message);
    this.status = status;
    this.debug_id = debug_id;
  }
}

/** Everything that mutates PayPal requires an ApprovalTicket. Reads and verification do not. */
export interface PaypalClient {
  readonly mode: 'sandbox' | 'mock';
  /** intent AUTHORIZE places a hold (money reserved, not taken); the default CAPTURE takes it. */
  createOrder(ticket: ApprovalTicket, purchase: Purchase, opts?: { intent?: 'CAPTURE' | 'AUTHORIZE' }): Promise<CreatedOrder>;
  /** Take the money held by an authorization. `requestId` makes it idempotent. */
  captureAuthorization(ticket: ApprovalTicket, authorizationId: string, requestId: string): Promise<CapturedOrder>;
  /** Release the money held by an authorization. */
  voidAuthorization(ticket: ApprovalTicket, authorizationId: string): Promise<{ status: string }>;
  captureOrder(ticket: ApprovalTicket, paypalOrderId: string): Promise<CapturedOrder>;
  /** Read-only: the order's current state at PayPal (no ticket needed). */
  getOrder(paypalOrderId: string): Promise<{ status: string; capture_id: string | null }>;
  listDisputes(): Promise<PaypalDispute[]>;
  provideEvidence(ticket: ApprovalTicket, disputeId: string, evidence: { notes: string }): Promise<Record<string, unknown>>;
  acceptClaim(ticket: ApprovalTicket, disputeId: string, accept: { note: string }): Promise<Record<string, unknown>>;
  /** Refund a capture (full amount). `requestId` makes it idempotent: a retry returns the same refund. */
  refundCapture(ticket: ApprovalTicket, captureId: string, r: { amount: { currency_code: string; value: string }; note: string; requestId: string }): Promise<RefundResult>;
  verifyWebhook(headers: WebhookHeaders, event: unknown): Promise<boolean>;
}
