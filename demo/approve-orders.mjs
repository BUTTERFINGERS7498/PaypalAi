// Stands in for "the buyer approved at PayPal" when recording the demo against MOCK PayPal.
// It posts a CHECKOUT.ORDER.APPROVED webhook for every purchase that is still awaiting the buyer,
// exactly as PayPal would. The server (WEBHOOK_VERIFY=off) then captures the order.
// Usage: node demo/approve-orders.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:8099';
const list = await (await fetch(`${base}/api/purchases`)).json();
const purchases = Array.isArray(list) ? list : list.purchases;
let n = 0;
for (const p of purchases.filter((x) => x.status === 'awaiting_payer' && x.paypal_order_id)) {
  const event = {
    id: `WH-DEMO-${p.id}`,
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource_type: 'checkout-order',
    resource: { id: p.paypal_order_id, status: 'APPROVED' },
  };
  const res = await fetch(`${base}/webhooks/paypal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  console.log(`${p.item_name} (${p.paypal_order_id}): webhook ${res.status}`);
  n += 1;
}
console.log(`${n} order(s) approved`);
