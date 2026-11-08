# Mandate Ledger — API Contract

Owner: backend (`src/server/**`). Other agents request changes in `handoffs/ui-requests.md` or
`handoffs/qa-findings.md`; nobody else edits this file. Derived from `implementation-plan.pdf`.

## Breaking changes
_Newest first. Every breaking change gets a dated line here._

- 2026-11-08 — v0.1 initial contract. Nothing to migrate.
- 2026-11-08 (additive, not breaking) — evidence `decision` gains `order_failed`.

---

## 0. Ground rules

1. **PayPal SANDBOX only.** The server refuses to start unless `PAYPAL_ENV=sandbox`; the PayPal base
   URL is hard-coded to `https://api-m.sandbox.paypal.com`.
2. **The agent decides; a separate checker judges.** The shopping agent proposes a choice. The
   *mandate checker* (plain code, not the LLM) computes `within_mandate` and `breaches` for every
   decision. The LLM never gets to declare itself compliant.
3. **Every PayPal mutation needs an approved ticket.** Creating/capturing an order and every
   dispute action happen only inside the gate after a decision (auto-within-mandate, or a human
   approval above the threshold). Clients refuse to call PayPal without a ticket minted by the gate.
4. **Evidence is append-only and hash-chained.** One record per decision. No update/delete endpoint,
   no UPDATE/DELETE in SQL (triggers abort). Tampering is detectable via `GET /api/evidence/verify`.
5. **Honesty over defence.** A dispute verdict is computed from the evidence by code. The LLM only
   writes the narrative; it cannot flip `MANDATE_BREACH` to `DEFENSIBLE`.
6. **Claims boundary (README/video must match):** we sign mandates with our own ed25519 keypair. We
   do NOT claim AP2/FIDO conformance, real liability shifting, card-network integration, or
   production readiness. Signatures are labelled `"Mandate Ledger demo key"`.
7. Secrets come from env only; the server never logs or returns them.

## 1. Runtime & conventions

| Item | Value |
|---|---|
| Runtime | Node 24, TypeScript run directly (type-stripping; erasable syntax only: no `enum`, no parameter properties, no namespaces) |
| DB | SQLite via built-in `node:sqlite` at `DATABASE_PATH`. Schema is owned by platform in `db/schema.sql`; the server applies it on boot (idempotent). Render's free disk is ephemeral: `scripts/seed` must restore the demo state. |
| Port | `PORT` (default `8787`) |
| API | `/api/*` JSON. Webhooks at `/webhooks/paypal`. Static UI served at `/` from `dist/ui/` if it exists (the Next.js app uses `output: 'export'` and platform copies the export to `dist/ui/`). |
| IDs | Prefixed: `m_`, `pur_`, `apr_`, `evd_`, `dsp_`, `req_`. Catalog items use a stable `sku`. |
| Money | `{ "currency_code": "USD", "value": "42.00" }`, value is a 2-dp decimal **string**. |
| Time | ISO-8601 UTC with ms. "Month" = calendar month in UTC. |
| Hashes | lowercase hex sha-256. Signatures base64 (standard). |

### Error shape (all non-2xx)
```json
{ "error": { "code": "not_found", "message": "Mandate m_… not found", "details": {} } }
```
Codes: `bad_request` 400, `unauthorized` 401, `not_found` 404, `invalid_state` 409,
`mandate_inactive` 409 (revoked mandate), `upstream_error` 502 (PayPal/Anthropic), `internal` 500.

### Auth
If `APPROVAL_TOKEN` is set, these require `Authorization: Bearer <APPROVAL_TOKEN>`:
`POST /api/mandates*`, `POST /api/approvals/:id/approve|reject`, `POST /api/disputes/:id/submit`,
`POST /api/disputes/simulate`. Everything else is open. Unset = open (local dev).

## 2. Environment variables (platform writes `.env.example`)

| Name | Required | Default | Meaning |
|---|---|---|---|
| `PAYPAL_ENV` | yes | — | must be `sandbox` |
| `PAYPAL_MODE` | no | `sandbox` | `sandbox` real API; `mock` in-process fake (tests, no-credential demo) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | if `PAYPAL_MODE=sandbox` | — | sandbox **business** app credentials |
| `PAYPAL_BUYER_EMAIL` | no | — | sandbox **personal** (buyer) account email, shown in the console |
| `PAYPAL_WEBHOOK_ID` | if `WEBHOOK_VERIFY=paypal` | — | |
| `WEBHOOK_VERIFY` | no | `paypal` | `paypal` verify signature; `off` accept unverified (stored `verified:false`) |
| `CHECKOUT_MODE` | no | `payer_approval` | `payer_approval` order waits for the buyer to approve at PayPal (`awaiting_payer`); `card` headless capture with a sandbox test card if the account supports it (see §12) |
| `ANTHROPIC_API_KEY` | if `AGENT_MODE=live` | — | |
| `ANTHROPIC_BASE_URL` | no | — | gateway such as 9router `http://localhost:20128` (a trailing `/v1` is stripped); then the key is the gateway's |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5-5` | behind a gateway use its id (9router: `cc/claude-sonnet-5-5`) |
| `AGENT_MODE` | no | `live` | `live` Claude tool-calling; `mock` deterministic parser (tests) |
| `APPROVAL_TOKEN` | no | — | see Auth |
| `MANDATE_SIGNING_KEY` | no | generated | base64 ed25519 private key (PKCS8 DER). If unset, generated on first boot and persisted in the DB table `signing_keys` |
| `DATABASE_PATH` | no | `./data/mandate.db` | |
| `PORT`, `PUBLIC_BASE_URL` | no | `8787`, `http://localhost:8787` | |

## 3. Resources

### Mandate
```json
{
  "id": "m_01J…",
  "version": 3,
  "status": "active",
  "owner": "demo-user",
  "label": "Groceries, $200/month",
  "limits": {
    "currency_code": "USD",
    "monthly_cap": "200.00",
    "categories": ["groceries"],
    "approval_above": "75.00"
  },
  "created_at": "…", "updated_at": "…", "revoked_at": null,
  "signature": {
    "alg": "ed25519", "key_id": "key_demo_1", "note": "Mandate Ledger demo key",
    "payload_hash": "ab12…", "sig": "base64…"
  },
  "budget": { "spent": "180.00", "remaining": "20.00", "period": "2026-11" }
}
```
- Limits are optional only where noted: `monthly_cap`, `categories` (non-empty) and `approval_above`
  are required. `approval_above` ≤ `monthly_cap`.
- **Versioning:** any change to `limits` creates a new `version` (old versions are retained
  immutably). Evidence always cites `id` + `version` + that version's `signature`.
- **Signing payload (canonical JSON, keys sorted, no whitespace):**
  `{"id","version","owner","limits","created_at"}` where `created_at` is the *version's* creation time.
  `payload_hash` = sha-256 of that string; `sig` = ed25519 over the same bytes.
- `status`: `active` | `revoked`. A revoked mandate cannot be used by the agent (`mandate_inactive`).
- `budget` is derived (never stored): `spent` = sum of purchases for this mandate in the current
  month with status `awaiting_payer`, `completed`, `disputed`, `dispute_resolved`.

### CatalogItem (seeded, read-only)
```json
{ "sku": "GRO-OAT-01", "name": "Rolled oats 1kg", "category": "groceries",
  "price": { "currency_code": "USD", "value": "4.50" }, "merchant": "Demo Pantry" }
```

### Purchase (ledger row)
```json
{
  "id": "pur_01J…",
  "mandate_id": "m_01J…", "mandate_version": 3,
  "sku": "GRO-OAT-01", "item_name": "Rolled oats 1kg", "category": "groceries",
  "amount": { "currency_code": "USD", "value": "42.00" },
  "status": "completed",
  "within_mandate": true,
  "breaches": [],
  "demo_rogue": false,
  "request_id": "req_01J…",
  "paypal_order_id": "5O190127TN364715T",
  "approve_url": null,
  "paypal_capture_id": "3C679366HH908993F",
  "approval_id": null,
  "dispute_id": null,
  "created_at": "…", "updated_at": "…", "completed_at": "…"
}
```
`status` lifecycle:
```
pending_approval ──approve──▶ (order created) ──▶ awaiting_payer ──capture──▶ completed
        │                          │ (CHECKOUT_MODE=card skips awaiting_payer)
        └──reject──▶ rejected      └──PayPal error──▶ failed
completed ──dispute opened──▶ disputed ──dispute closed──▶ dispute_resolved
```
Within-mandate purchases at or under `approval_above` skip `pending_approval`.

### Approval
```json
{ "id": "apr_01J…", "purchase_id": "pur_01J…", "status": "pending",
  "summary": "Buy Espresso machine (USD 129.00) — above your USD 75.00 approval threshold",
  "reasons": ["above_approval_threshold"],
  "created_at": "…", "decided_by": null, "decided_at": null, "decision_note": null }
```
`status`: `pending` | `approved` | `rejected`. Approval compare-and-sets: a second decision is `409 invalid_state`.
An approval is only created when the mandate checker says the choice is otherwise allowed
(`reasons` is exactly `["above_approval_threshold"]`). Out-of-mandate choices are **blocked**, not
queued, except in rogue demo mode (§6).

### EvidenceRecord (**the heart of the project; shape is stable**)
```json
{
  "record_id": "evd_01J…",
  "seq": 17,
  "prev_hash": "9f2c…",
  "hash": "c01a…",
  "timestamp": "2026-11-11T14:22:03.120Z",
  "decision": "selected",
  "mandate": {
    "id": "m_01J…", "version": 3, "status": "active",
    "signature": "base64…",
    "limits": { "currency_code": "USD", "monthly_cap": "200.00", "categories": ["groceries"], "approval_above": "75.00" }
  },
  "user_instruction": "restock the pantry basics",
  "options_seen": [
    { "sku": "GRO-OAT-01", "name": "Rolled oats 1kg", "category": "groceries", "price": "4.50" }
  ],
  "choice": { "sku": "GRO-OAT-01", "price": "4.50" },
  "rationale": "cheapest in-category match",
  "budget_before": "180.00",
  "budget_after": "175.50",
  "within_mandate": true,
  "breaches": [],
  "demo_rogue": false,
  "purchase_id": "pur_01J…",
  "paypal_order_id": null,
  "data": {}
}
```
- `decision` ∈ `selected` (agent chose an item) · `needs_approval` · `blocked` · `no_match` ·
  `approved` · `rejected` (human) · `order_created` · `order_failed` (PayPal refused the order or
  capture; `data.error`) · `captured` · `mandate_revoked`.
  The first four are agent decisions and carry the full snapshot above. The later ones carry
  `purchase_id`/`paypal_order_id` and the mandate snapshot but may leave `options_seen: []`,
  `choice: null`, and put specifics in `data` (e.g. `{ "approval_id", "decided_by" }`,
  `{ "paypal_capture_id" }`).
- `breaches`: strings from `inactive_mandate`, `category_not_allowed`, `exceeds_monthly_cap`.
  (`above_approval_threshold` is a *reason for approval*, not a breach.)
- `budget_before`/`budget_after` are decimal strings; `budget_after = budget_before + price` whenever
  the record carries a `choice` made by the agent (`selected`, `needs_approval`, **and `blocked`**: it is
  what the budget would have been had the choice executed, so an overshoot of the cap is visible).
  Otherwise (`no_match`, `rejected`, mandate/order lifecycle records) it equals `budget_before`. The
  `approved` record shows the re-checked outcome: `budget_before + price` if still within mandate.
- **Chain:** `hash = sha256(prev_hash + "\n" + canonicalJson(record without "hash"))`. The first
  record's `prev_hash` is 64 zeros. `seq` is strictly increasing from 1. `canonicalJson` = keys
  sorted recursively, no whitespace.

### Dispute
```json
{
  "id": "dsp_01J…",
  "paypal_dispute_id": "PP-D-27803",
  "simulated": false,
  "purchase_id": "pur_01J…",
  "paypal_order_id": "5O190127TN364715T",
  "status": "open",
  "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "amount": { "currency_code": "USD", "value": "129.00" },
  "created_at": "…", "updated_at": "…",
  "packet": null
}
```
`status`: `open` → `evidence_assembled` → `submitted` → `resolved`. `simulated: true` marks a
locally created dispute (fallback when the Disputes API is unavailable): it is clearly labelled in
the UI and README and is never described as coming from PayPal.

### DisputePacket (`dispute.packet`, set by assemble)
```json
{
  "verdict": "DEFENSIBLE",
  "action": "provide_evidence",
  "summary": "Purchase was within the signed mandate (v3); price and budget verified.",
  "narrative": "LLM-written, human readable…",
  "evidence_record_ids": ["evd_…", "evd_…"],
  "chain_valid": true,
  "assembled_at": "…",
  "submitted_at": null,
  "paypal_response": null
}
```
- `verdict` is computed by code: `MANDATE_BREACH` if any record for the purchase has
  `within_mandate: false` **or** the evidence chain is invalid; otherwise `DEFENSIBLE`.
- `action`: `provide_evidence` (DEFENSIBLE) or `accept_claim` (MANDATE_BREACH, the honest
  response: the system reports that the agent overstepped and does not contest).

## 4. Endpoints

### Health
`GET /api/health` → `{ "ok": true, "paypal_env": "sandbox", "paypal_mode": "sandbox", "agent_mode": "live", "checkout_mode": "payer_approval", "webhook_verify": "paypal", "version": "0.1.0" }`

### Mandates
- `GET /api/mandates` → `{ "mandates": [Mandate] }` (current version of each; newest first)
- `POST /api/mandates` body `{ "label", "owner"?, "limits": { "monthly_cap", "categories", "approval_above" } }` → `201 Mandate` (signed, version 1)
- `GET /api/mandates/:id` → `Mandate`; `GET /api/mandates/:id/versions` → `{ "versions": [Mandate] }`
- `POST /api/mandates/:id/limits` body `{ "monthly_cap"?, "categories"?, "approval_above"? }` → `200 Mandate` (new version)
- `POST /api/mandates/:id/revoke` → `200 Mandate` (`status: revoked`); appends a `mandate_revoked` evidence record.
- `POST /api/mandates/:id/verify` → `200 { "valid": true, "alg": "ed25519", "key_id": "…", "version": 3, "reason": null }`
  Recomputes the payload hash and verifies the signature in a separate step.
  Optional body `{ "version": 2 }`.

### Catalog
`GET /api/catalog?category=groceries` → `{ "items": [CatalogItem] }`

### Agent (plain English → decision)
`POST /api/agent/instructions`
```json
{ "mandate_id": "m_01J…", "text": "restock the pantry basics", "demo_rogue": false }
```
→ `201`
```json
{
  "request_id": "req_01J…",
  "outcome": "purchased",
  "reply": "Bought Rolled oats 1kg for USD 4.50. Budget left: USD 15.50.",
  "purchase": { "…": "Purchase or null" },
  "approval": null,
  "evidence_record_id": "evd_01J…"
}
```
`outcome`: `purchased` (completed) · `awaiting_payer` (order created, buyer must approve at
`purchase.approve_url`) · `needs_approval` (`approval` set, nothing charged) · `blocked` (the checker
refused the choice; `reply` explains; no purchase) · `no_match` (nothing suitable in the catalog) ·
`needs_info` (ambiguous instruction; a question in `reply`) · `failed` (the order could not be
created; `purchase.status: failed`, reason in the evidence `order_failed` record).
- Tools: `search_catalog`, `get_mandate`, `select_item`. **None touches PayPal.** The server runs the
  checker on `select_item`, writes the evidence record, then (outcome-dependent) the gate creates
  the order. Takes 2–15 s in `live` mode; `502 upstream_error` if Anthropic fails.
- `GET /api/agent/instructions/:request_id` → same shape (re-read).

### Purchases (ledger)
- `GET /api/purchases?status=&mandate_id=` → `{ "purchases": [Purchase] }` (newest first)
- `GET /api/purchases/:id` → `Purchase`
- `GET /api/purchases/:id/evidence` → `{ "records": [EvidenceRecord], "chain_valid": true }` (oldest first; this purchase's decision trail)

### Approvals
- `GET /api/approvals?status=pending` → `{ "approvals": [Approval] }`
- `POST /api/approvals/:id/approve` body `{ "decided_by": "sarvagya", "note"? }` → `200 { "approval": Approval, "purchase": Purchase }`.
  Executes the checkout in the same request. Re-checks the mandate at approval time: if it has been
  revoked, or the cap would now be exceeded, the approval is recorded but the purchase becomes
  `failed` with `breaches` set and no PayPal call is made.
- `POST /api/approvals/:id/reject` body `{ "decided_by", "note"? }` → `200 { "approval", "purchase" }` (`rejected`).
- Both: `409 invalid_state` if not `pending`.

### Evidence
- `GET /api/evidence?after_seq=0&limit=100&purchase_id=&order_id=&mandate_id=` → `{ "records": [EvidenceRecord], "next_seq": 42 }` (oldest first, `limit` max 500)
- `GET /api/evidence/:record_id` → `EvidenceRecord`
- `GET /api/evidence/verify` → `{ "valid": true, "checked": 42, "head_hash": "…", "broken_at_seq": null }`
  Walks the whole chain. `valid:false` returns the first `seq` whose stored hash or link is wrong.

### Disputes
- `GET /api/disputes` → `{ "disputes": [Dispute] }` (newest first); `GET /api/disputes/:id` → `Dispute`
- `POST /api/disputes/sync` → pulls PayPal's disputes (sandbox), links those whose order id matches a
  purchase, → `200 { "synced": 2, "disputes": [Dispute] }`. `502` if the Disputes API is unavailable.
- `POST /api/disputes/simulate` body `{ "purchase_id", "reason"? }` → `201 Dispute` with `simulated: true`
  (fallback only; marks the purchase `disputed`).
- `POST /api/disputes/:id/assemble` → `200 Dispute` with `packet` set and `status: evidence_assembled`.
  Pulls the purchase's evidence chain, verifies it, computes the verdict, has the LLM draft the
  narrative. Idempotent: re-assembling replaces an unsubmitted packet.
- `POST /api/disputes/:id/submit` body `{ "decided_by" }` → `200 Dispute` (`submitted`). `DEFENSIBLE`
  → Disputes API `provide-evidence`; `MANDATE_BREACH` → `accept-claim` with the honest note. For a
  `simulated` dispute no PayPal call is made and `packet.paypal_response` is `{ "simulated": true }`.
  `409` if no packet or already submitted.

### Webhook records
`GET /api/webhooks?limit=50` → `{ "events": [WebhookEvent] }` (newest first)
`WebhookEvent`: `{ "id","event_type","resource_type","received_at","verified","processed","purchase_id","error" }`.

### Live updates (SSE)
`GET /api/stream` — `text/event-stream`. Events: `purchase.updated`, `approval.updated`,
`evidence.appended` (data = EvidenceRecord), `dispute.updated`, `mandate.updated`. Data is the full
resource. `: ping` every 15 s. Clients refetch lists on reconnect.

### PayPal webhook receiver
`POST /webhooks/paypal` — headers `paypal-transmission-id|time|sig`, `paypal-cert-url`,
`paypal-auth-algo`. Verified via PayPal when `WEBHOOK_VERIFY=paypal` (failure → `400`, event not
stored as processed). Idempotent on event `id` (`{ "received": true, "duplicate": true }`).
Success → `200 { "received": true, "duplicate": false }`. Unknown types: stored, `200`, no change.

## 5. Webhook payloads and their effects

Envelope: `{ "id": "WH-…", "event_type": "…", "resource_type": "…", "create_time": "…", "resource": { … } }`

| `event_type` | Resource fields read | Effect |
|---|---|---|
| `CHECKOUT.ORDER.APPROVED` | `resource.id` (order id) | purchase `awaiting_payer` → capture executes through the gate → `completed`; evidence `captured` |
| `PAYMENT.CAPTURE.COMPLETED` | `resource.id` (capture id), `resource.supplementary_data.related_ids.order_id` | purchase → `completed` if not already; `paypal_capture_id` set |
| `PAYMENT.CAPTURE.DENIED` | same | purchase → `failed` |
| `CUSTOMER.DISPUTE.CREATED` | `resource.dispute_id`, `resource.disputed_transactions[0].seller_transaction_id` / order id, `resource.reason`, `resource.dispute_amount` | create/link a Dispute (`open`); purchase → `disputed` |
| `CUSTOMER.DISPUTE.UPDATED` | `resource.dispute_id`, `resource.status` | update the Dispute |
| `CUSTOMER.DISPUTE.RESOLVED` | `resource.dispute_id` | Dispute → `resolved`; purchase → `dispute_resolved` |
| anything else | — | stored only |

Unknown order/dispute ids are stored with `processed:false, error:"unknown_purchase"`, `200`.
Every processed event appends no audit record of its own: the **evidence chain** is the audit log.
(`captured` is the only webhook-driven evidence record.) **Test harness note (qa):** run the server
with `WEBHOOK_VERIFY=off PAYPAL_MODE=mock AGENT_MODE=mock` and POST envelopes with the order id from
`purchase.paypal_order_id`. In `PAYPAL_MODE=mock` a purchase waits in `awaiting_payer` unless
`CHECKOUT_MODE=card`; the mock PayPal accepts `CHECKOUT.ORDER.APPROVED` for any order it created.

## 6. The rogue-agent demo (WP-8)

`demo_rogue: true` on `POST /api/agent/instructions` makes the *guard* skip its `blocked` outcome so a
deliberately out-of-mandate choice proceeds (e.g. "buy a games console" under a groceries mandate).
The checker still evaluates honestly: the evidence records `within_mandate: false`,
`breaches: ["category_not_allowed"]` and `demo_rogue: true`. The purchase proceeds through checkout
with `within_mandate: false`. The UI must label it clearly ("demo: agent overrides its mandate").
The later dispute then yields `MANDATE_BREACH` / `accept_claim`. The flag is only honoured when
`PAYPAL_ENV=sandbox` (always true here) and is recorded in every affected record.

## 7. Agent behaviour (mock mode, for tests)

`AGENT_MODE=mock` parses: `buy <anything|item words> [for $<max>]`, `restock <words>`; it picks the
cheapest catalog match by case-insensitive word overlap with name/category, preferring items in an
allowed category. Selecting by explicit sku: `buy sku GRO-OAT-01`. No match → `no_match`.
Rogue mode in mock: `buy sku <any sku>` with `demo_rogue: true` selects that sku regardless of category.

## 8. Mandate checker (the rules; deterministic)

For a candidate `price` against the **current active version**, with `spent` this UTC month:
1. mandate `revoked` → breach `inactive_mandate` (`409 mandate_inactive` if the *request* itself targets one).
2. `category` ∉ `limits.categories` → breach `category_not_allowed`.
3. `spent + price > monthly_cap` → breach `exceeds_monthly_cap`.
4. `price > approval_above` and no breach → reason `above_approval_threshold` (needs human approval).
`within_mandate = (breaches.length === 0)`.

## 9. Database tables (platform implements in `db/schema.sql`)

| Table | Columns |
|---|---|
| `signing_keys` | `key_id TEXT PK`, `public_key TEXT`, `private_key TEXT`, `created_at TEXT` |
| `mandates` | `id TEXT PK`, `owner TEXT`, `label TEXT`, `status TEXT`, `current_version INTEGER`, `created_at`, `updated_at`, `revoked_at` |
| `mandate_versions` | `mandate_id TEXT`, `version INTEGER`, `limits TEXT` (JSON), `created_at TEXT`, `payload_hash TEXT`, `signature TEXT`, `key_id TEXT`; PRIMARY KEY (`mandate_id`,`version`); triggers abort UPDATE/DELETE |
| `catalog_items` | `sku TEXT PK`, `name`, `category`, `price_value TEXT`, `currency_code TEXT`, `merchant TEXT` |
| `purchases` | `id TEXT PK`, `mandate_id`, `mandate_version INTEGER`, `sku`, `item_name`, `category`, `amount_value TEXT`, `currency_code`, `status`, `within_mandate INTEGER`, `breaches TEXT` (JSON), `demo_rogue INTEGER`, `request_id`, `paypal_order_id TEXT UNIQUE`, `approve_url`, `paypal_capture_id`, `approval_id`, `dispute_id`, `created_at`, `updated_at`, `completed_at` |
| `approvals` | `id TEXT PK`, `purchase_id`, `status`, `summary`, `reasons TEXT` (JSON), `created_at`, `decided_by`, `decided_at`, `decision_note` |
| `evidence_records` | `seq INTEGER PRIMARY KEY AUTOINCREMENT`, `record_id TEXT UNIQUE`, `prev_hash TEXT`, `hash TEXT`, `timestamp TEXT`, `purchase_id TEXT`, `paypal_order_id TEXT`, `mandate_id TEXT`, `body TEXT` (the full record JSON); triggers abort UPDATE/DELETE; indexes on `purchase_id`, `paypal_order_id`, `mandate_id` |
| `disputes` | `id TEXT PK`, `paypal_dispute_id TEXT UNIQUE`, `simulated INTEGER`, `purchase_id`, `paypal_order_id`, `status`, `reason`, `amount_value`, `currency_code`, `packet TEXT` (JSON), `created_at`, `updated_at` |
| `webhook_events` | `id TEXT PK`, `event_type`, `resource_type`, `received_at`, `verified INTEGER`, `processed INTEGER`, `purchase_id`, `error`, `raw TEXT` |
| `agent_requests` | `id TEXT PK`, `mandate_id`, `text`, `outcome`, `reply`, `purchase_id`, `approval_id`, `evidence_record_id`, `created_at` |

**Seed (`scripts/seed`)** — demo state matching the video script: one active mandate
"Groceries, $200/month" (`monthly_cap 200.00`, `categories ["groceries"]`, `approval_above 75.00`),
signed by the app's key via the server's own module (seed must call the server library, not
hand-roll signatures); a catalog of ~14 items: ~9 `groceries` (prices 2–60 incl. a pair at 42.00/51.00),
a few `electronics` (e.g. Espresso machine 129.00, Games console 299.00) and one `household`; plus
2–3 completed historical purchases with valid evidence chains. Seed must be idempotent.

## 10. Core loop (curl)
```sh
# 1. create a mandate (or use the seeded one)
curl -s localhost:8787/api/mandates -H 'content-type: application/json' \
  -d '{"label":"Groceries, $200/month","limits":{"monthly_cap":"200.00","categories":["groceries"],"approval_above":"75.00"}}'
# 2. verify its signature
curl -s -X POST localhost:8787/api/mandates/m_XXX/verify
# 3. instruct the agent
curl -s localhost:8787/api/agent/instructions -H 'content-type: application/json' \
  -d '{"mandate_id":"m_XXX","text":"restock the pantry basics"}'
# 4. read the evidence trail and verify the chain
curl -s localhost:8787/api/purchases/pur_XXX/evidence
curl -s localhost:8787/api/evidence/verify
# 5. (payer_approval mode) buyer approves at purchase.approve_url, PayPal sends CHECKOUT.ORDER.APPROVED
#    -> capture -> status completed. Simulate it:
curl -s localhost:8787/webhooks/paypal -H 'content-type: application/json' \
  -d '{"id":"WH-1","event_type":"CHECKOUT.ORDER.APPROVED","resource_type":"checkout-order","create_time":"2026-11-11T12:00:00Z","resource":{"id":"<paypal_order_id>"}}'
# 6. dispute -> assemble -> submit
curl -s -X POST localhost:8787/api/disputes/simulate -H 'content-type: application/json' -d '{"purchase_id":"pur_XXX"}'
curl -s -X POST localhost:8787/api/disputes/dsp_XXX/assemble
curl -s -X POST localhost:8787/api/disputes/dsp_XXX/submit -H 'content-type: application/json' -d '{"decided_by":"sarvagya"}'
```

## 11. UI notes (for `src/ui`)
Four views from the plan: **Mandate editor** (create/edit limits → new version, revoke, verify
signature), **Purchase ledger** (AG Grid; live via SSE), **Evidence trail viewer** (records for a
purchase, chain-valid badge, hash shown short), **Dispute console** (assemble, show verdict + packet,
submit). A judge must be able to follow one purchase from instruction to evidence. Label simulated
disputes and `demo_rogue` purchases visibly. Next.js with `output: 'export'`; reads
`NEXT_PUBLIC_API_URL` (default `""` = same origin).

## 12. Day-1 spikes (answers change this contract — flag in `handoffs/`)
1. **Disputes API access.** Are list/show/provide-evidence/accept-claim and the sandbox-only
   require-evidence/adjudicate usable with our sandbox app? (Plan risk #1.) If not: `simulated`
   disputes become the demo path.
2. **Headless capture.** Orders v2 normally needs the buyer to approve. Default design is
   `CHECKOUT_MODE=payer_approval` (`awaiting_payer` + `approve_url` + `CHECKOUT.ORDER.APPROVED`
   webhook). `card` mode needs a sandbox business account with card payments enabled. Verify which works.
3. **Webhooks to Render.** Public URL + webhook id before relying on real events; fall back to a
   polling `POST /api/purchases/:id/capture` if delivery is flaky (not yet in the contract).
