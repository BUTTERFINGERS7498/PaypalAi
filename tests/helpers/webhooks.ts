import { randomUUID } from 'node:crypto';

export function envelope(event_type: string, resource_type: string, resource: object, id = `WH-QA-${randomUUID()}`) {
  return { id, event_type, resource_type, create_time: new Date().toISOString(), resource };
}

export function orderApproved(orderId: string, id?: string) {
  return envelope('CHECKOUT.ORDER.APPROVED', 'checkout-order', { id: orderId }, id);
}

export function captureEvent(orderId: string, captureId: string, status: 'COMPLETED' | 'DENIED', id?: string) {
  return envelope(`PAYMENT.CAPTURE.${status}`, 'capture', {
    id: captureId, supplementary_data: { related_ids: { order_id: orderId } },
  }, id);
}

export function disputeCreated(orderId: string, disputeId: string, value = '4.50', id?: string) {
  return envelope('CUSTOMER.DISPUTE.CREATED', 'dispute', {
    dispute_id: disputeId, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    dispute_amount: { currency_code: 'USD', value },
    disputed_transactions: [{ seller_transaction_id: orderId }],
  }, id);
}

export function disputeUpdated(disputeId: string, status = 'WAITING_FOR_SELLER_RESPONSE', id?: string) {
  return envelope('CUSTOMER.DISPUTE.UPDATED', 'dispute', { dispute_id: disputeId, status }, id);
}

export function disputeResolved(disputeId: string, id?: string) {
  return envelope('CUSTOMER.DISPUTE.RESOLVED', 'dispute', { dispute_id: disputeId }, id);
}
