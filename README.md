# Mandate Ledger

A receipt layer for agentic payments: scoped, signed spending mandates, decision-time evidence,
and honest dispute responses. Built for the PayPal AI Hackathon, November 2026.

An agent proposes a purchase. A separate deterministic checker evaluates category, monthly spend
and approval threshold. The gate controls PayPal mutations; append-only, hash-chained evidence
records what the agent saw and chose against the signed mandate version. A dispute packet uses
that trail to report `DEFENSIBLE` or `MANDATE_BREACH`; the model writes the narrative, while code
computes the verdict.

**PayPal SANDBOX only.** No real money. The server requires `PAYPAL_ENV=sandbox` and uses
`https://api-m.sandbox.paypal.com` for PayPal requests.

## Run from a clean machine

Install **Node.js 24.x** (includes npm 11). SQLite is built into Node; no database service,
Python, Docker or paid API account is needed for the mock path. Download/unpack the repository,
open a terminal in its root, then run:

```sh
npm ci
```

Copy the example environment file:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

The example selects the no-credentials path:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_MODE=mock
AGENT_MODE=mock
WEBHOOK_VERIFY=off
CHECKOUT_MODE=payer_approval
```

Then:

```sh
npm run seed
npm run build:ui
npm start
```

Open **http://localhost:8787**. Health: **http://localhost:8787/api/health**. Run the seed before
starting the server; rerunning it preserves existing rows, keys and evidence. The seed uses the
backend's signing and evidence modules to create the demo mandate and historical purchases.
The database defaults to `data/mandate.db`; stop the server before changing the database path.

The initial catalog contains 14 fictional items (10 groceries, 3 electronics, 1 household),
including pantry bundles at $42/$51, an espresso machine at $129 and a games console at $299.
The demo mandate is `Groceries, $200/month`, groceries only, approval above $75.
Seeded historical purchases are **synthetic completed examples**, never real PayPal transactions,
including when the app is later run with sandbox API credentials.

### Try the demo

1. Open the mandate editor and verify the seeded mandate's demo-key signature.
2. Ask the agent `buy sku GRO-PANTRY-42`. Inspect its selected item, checker result and evidence.
3. In mock payer-approval mode the purchase waits at `awaiting_payer`. Complete it by posting
   `CHECKOUT.ORDER.APPROVED` with the returned order ID (example below). A mock approval URL
   is a simulation; it does not establish a PayPal payment.
4. Open its evidence trail; verify the chain and inspect prices, mandate version and rationale.
5. Simulate a dispute, assemble the packet and submit it. Simulated disputes are local records;
   their submission never calls PayPal.
6. Enable the clearly labelled rogue demo and ask `buy sku ELE-GAME-01`. This deliberately
   bypasses the blocking outcome; the checker still records breaches. Its dispute must yield
   `MANDATE_BREACH` / `accept_claim`.

To show human approval, create a separate electronics mandate with a $500 monthly cap and a
$75 approval threshold, then request `buy sku ELE-ESP-01`. Electronics under the groceries
mandate is a category breach and is blocked; it does not enter the approval queue.

Mock webhook example (PowerShell, replace the placeholder with the purchase's returned order ID):

```powershell
$body = @{
  id = 'WH-LOCAL-DEMO-1'
  event_type = 'CHECKOUT.ORDER.APPROVED'
  resource_type = 'checkout-order'
  resource = @{ id = '<returned-paypal-order-id>' }
} | ConvertTo-Json
Invoke-RestMethod http://localhost:8787/webhooks/paypal -Method Post -ContentType application/json -Body $body
```

Use a new webhook ID for each new event. Replaying an ID is idempotent. `WEBHOOK_VERIFY=off`
accepts unverified payloads and records `verified:false`; it demonstrates processing, not
PayPal authenticity. For immediate no-network mock capture, set `CHECKOUT_MODE=card` in `.env`
before starting the server. This mock setting does not establish real sandbox card eligibility.

### Development and verification

```sh
npm run dev:server
# In a second terminal:
npm run dev:ui
```

The API runs on 8787, UI on 3000. Commands load the root `.env` when present. The UI dev
command defaults to API `http://localhost:8787`; a nonempty `NEXT_PUBLIC_API_URL` overrides it.
Use `NEXT_PUBLIC_DATA_SOURCE=api` for the integrated product. `mock` selects the frontend's
fixture preview, which does not demonstrate backend or PayPal behavior. Public UI env vars
are baked in at build time. Production `npm run build:ui` uses `src/ui`'s Next.js static export
and copies it to `dist/ui/`, served by the backend at `/`.

```sh
npm test
npm run test:e2e
```

The normal suites use isolated temporary databases and mock providers. Optional real sandbox
tests are opt-in using `PAYFLOW_E2E_SANDBOX=1` plus sandbox credentials. See
[API contract](docs/api-contract.md) for endpoint shapes and the canonical evidence format.

## Real PayPal sandbox path

1. Sign in to [PayPal Developer](https://developer.paypal.com/). Under Testing Tools / Sandbox
   Accounts, create a **Business** account (seller) and a **Personal** account (buyer).
   Use their sandbox account details only on the PayPal sandbox site.
2. Under Apps & Credentials select **Sandbox**, create a REST app attached to the business
   account, and copy its client ID and client secret into the private `.env` file or Render
   environment settings. Never place credentials in this README, source, screenshots or logs.
3. Configure:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=<sandbox-business-app-client-id>
PAYPAL_CLIENT_SECRET=<sandbox-business-app-client-secret>
PAYPAL_BUYER_EMAIL=<sandbox-personal-account-email>
CHECKOUT_MODE=payer_approval
WEBHOOK_VERIFY=paypal
PAYPAL_WEBHOOK_ID=<registered-sandbox-webhook-id>
PUBLIC_BASE_URL=https://<your-service>.onrender.com
```

4. Deploy the public receiver first (instructions below). Register
   `https://<your-service>.onrender.com/webhooks/paypal` in the sandbox app. Subscribe to
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, and
   `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`.
   Save its webhook ID privately. A localhost URL cannot receive PayPal webhooks directly.
5. Start/redeploy, ask for an allowed purchase, follow its PayPal approval link and sign in
   as the **sandbox personal buyer**. Check the order in the sandbox seller dashboard,
   `/api/webhooks` and Render logs. Verified order approval drives capture through the gate.

`payer_approval` is the default: the agent creates an order but the buyer approves it at PayPal.
`CHECKOUT_MODE=card` is conditional on sandbox account card-payment support and requires a
separate account-side spike; do not assume headless capture works.

Disputes API access is account-dependent. Test list/show/provide-evidence/accept-claim before
claiming a real sandbox dispute response. If unavailable, use the visibly labelled simulated
dispute path. A simulation is never presented as a case received from PayPal. Real sandbox
checkout, dispute API access and verified public webhook delivery require separate verification;
passing mock tests alone does not establish any of them.

## Claude or 9router

For live shopping tool calls and dispute narrative drafting, set these only in private `.env`
or Render environment settings:

```dotenv
AGENT_MODE=live
ANTHROPIC_API_KEY=<your-private-anthropic-or-gateway-key>
ANTHROPIC_MODEL=claude-sonnet-5-5
ANTHROPIC_BASE_URL=
```

For a 9router gateway, use its key as `ANTHROPIC_API_KEY`,
`ANTHROPIC_BASE_URL=http://localhost:20128` and the gateway's model ID, for example
`ANTHROPIC_MODEL=cc/claude-sonnet-5-5`. A trailing `/v1` is stripped by the backend.
On Render, leave `ANTHROPIC_BASE_URL` empty: the local 9router gateway is not reachable there.
Live agent mode on Render needs a real Anthropic API key and a model available to that account.
`AGENT_MODE=mock` uses deterministic catalog matching and templated narratives, with no LLM calls.
PayPal and agent modes are independent: sandbox payments can be exercised with the mock agent.

## Deploying to Render

1. Publish the project to a GitHub repository, then in Render choose **New > Blueprint**,
   connect that repo and use [render.yaml](render.yaml). It selects Node 24, build
   `npm install && npm run build:ui`, start `npm run seed && npm start`, and health `/api/health`.
2. Enter prompted secrets in Render's private dashboard: the sandbox business app's
   `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` and, for `AGENT_MODE=live`, a real
   `ANTHROPIC_API_KEY`. Leave **`ANTHROPIC_BASE_URL` empty**: 9router runs on your local machine.
   Set `AGENT_MODE` and `ANTHROPIC_MODEL` in the dashboard. Initially set `WEBHOOK_VERIFY=off`
   only to bring up the receiver before registration; those receipts are unverified.
   These three dashboard-managed settings use `sync: false` so Blueprint syncs do not reset them.
   `PAYPAL_ENV` and `PAYPAL_MODE` stay `sandbox`; `CHECKOUT_MODE` stays `payer_approval`.
3. Set `PUBLIC_BASE_URL` to the assigned `https://<service>.onrender.com` URL.
4. In the PayPal **sandbox** app, register
   `https://<service>.onrender.com/webhooks/paypal` for `CHECKOUT.ORDER.APPROVED`,
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `CUSTOMER.DISPUTE.CREATED`,
   `CUSTOMER.DISPUTE.UPDATED`, and `CUSTOMER.DISPUTE.RESOLVED`.
5. Save `PAYPAL_WEBHOOK_ID` privately in Render, set `WEBHOOK_VERIFY=paypal`, and redeploy.
   Confirm a real sandbox webhook POST in Render logs and `verified:true` in `/api/webhooks`.

The blueprint generates `APPROVAL_TOKEN`; keep it private and enter it in the console's
in-memory approval password field. Never place it or API keys in `NEXT_PUBLIC_*`. Local
`.env.example` leaves the token unset, so local protected actions are open until you set one.

The free plan sleeps after idle; expect the ephemeral database to reset on each fresh boot.
Startup seeding restores the synthetic catalog, mandate and history, but cannot recover lost
sandbox transactions or evidence. Use persistent storage to retain the ledger and signing key.
An optional private `MANDATE_SIGNING_KEY` keeps a stable key but does not preserve the database.
Account-side acceptance steps are tracked in [platform handoff](handoffs/platform.md).

## What is demonstrated and simulated

- Mandates use our own ed25519 keypair, labelled **"Mandate Ledger demo key"**. We do not claim
  AP2/FIDO conformance or certification, real liability shifting, card-network integration,
  regulatory approval or production readiness.
- The catalog and seeded history are fictional. Mock PayPal has no network payments; mock
  agent output has no model inference. Simulated disputes have no PayPal case or submission.
- The rogue flag intentionally allows a demo breach while preserving the checker's honest
  verdict and evidence. It is not a production authorization mechanism.
- SQLite triggers reject UPDATE/DELETE on mandate versions and evidence. Hash chains detect
  changes relative to retained records; an operator with full database/host access can remove
  triggers or rewrite storage. This is a demo evidence trail, not externally anchored proof.
- Claude powers live shopping and narrative generation. Claude Code and Codex are build-time
  development tools, disclosed separately from product AI.

Licensed under [MIT](LICENSE).
