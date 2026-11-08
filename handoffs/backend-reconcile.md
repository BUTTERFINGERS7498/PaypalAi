# Backend -> qa / platform: webhook safety net (2026-11-08)

Contract: docs/api-contract.md (`POST /api/purchases/:id/reconcile`, `RECONCILE_INTERVAL_SECONDS`, `captured` evidence `data.source`).

## qa (tests/**, e2e/**)
Mock mode child server (PAYPAL_MODE=mock AGENT_MODE=mock; the poller is OFF by default in mock so tests stay deterministic):
- The mock PayPal reports an order as `PAYER_ACTION_REQUIRED` until a test approves it. A child server cannot call the in-process mock's `approveOrder` hook, so simulate approval by posting `CHECKOUT.ORDER.APPROVED` to /webhooks/paypal OR cover reconcile via a unit test that builds `createServices` with `DATABASE_PATH=:memory:` (see backend smoke approach: insert catalog rows, `mandates.create`, `agent.handle({text:'buy sku X'})`, `paypal.approveOrder(orderId)`, `gate.reconcileAll()`).
- Cases: unapproved order -> `POST /api/purchases/:id/reconcile` returns `action: waiting`, no capture, purchase stays `awaiting_payer`; approved order -> `action: captured`, purchase `completed`, evidence `captured` has `data.source: "reconcile"` and `authorised_by: "payer"`; second call -> `skipped`; unknown id -> 404; webhook and reconcile racing on the same order -> exactly one capture call and NO `order_failed` record; a webhook arriving after reconcile is harmless.
- Also set `RECONCILE_INTERVAL_SECONDS=1` in one child-server test with `CHECKOUT_MODE=payer_approval` and confirm the automatic pass logs/acts without any request (only if you can approve the order, else skip).

## platform
- Add `RECONCILE_INTERVAL_SECONDS=` (optional; blank = default 15 against sandbox, 0 in mock) to .env.example, and a README line: on Render's free plan the poller only runs while awake, and webhooks remain the primary path.
