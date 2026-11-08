# CONTEXT.md — Mandate Ledger (PayPal AI Hackathon)

Last updated: 2026-11-08, after the backend landed. Deadline: **Thu Nov 12, 2026, 12:00 pm PT**.
Plan of record: `implementation-plan.pdf`. API of record: `docs/api-contract.md` (owner: backend).

## What it is
A consumer gives an AI shopping agent a signed, scoped **mandate** (monthly cap, allowed categories,
approval threshold). The agent shops through the PayPal **sandbox**. Every decision writes a
hash-chained **evidence record**. On a dispute, evidence is assembled into a PayPal dispute response;
if the agent overstepped, the system says so (`MANDATE_BREACH` -> accept_claim) instead of defending.
PayPal SANDBOX only. We do NOT claim AP2/FIDO conformance, real liability shift or production readiness.

## Team and territories (no agent runs git; the human reviews and commits)
| Who | Writes only | Status |
|---|---|---|
| Orchestrator + backend (Claude, this session) | `src/server/**`, `docs/api-contract.md`, `handoffs/**` | WP-2..6, WP-8 built, mock-verified |
| ui (Claude, herdr terminal `ui`) | `src/ui/**` | Reported DONE (Next.js export, 4 views); not reopened by orchestrator |
| platform (Codex, terminal `platform`) | `infra/**`, `scripts/**`, `db/**`, root configs, README | Schema, package.json, LICENSE, render.yaml, seed skeleton done; finishing README / seed check |
| qa (Codex, terminal `qa`) | `tests/**`, `e2e/**` | 22 unit tests written; e2e in progress |
Agents live under herdr (`hc ls`, `hc read <name>`, `hc send <name> "..."` then `hc keys <name> enter`
for Codex). Panes were placed with `herdr-app do terminal.keep --terminal <tNN> --place right|down`.
Terminals die when finished or killed; restart with `hc run --bg --name <n> --cwd <repo> claude|codex`.

## Done (verified by running it)
- `docs/api-contract.md` v0.1 (+ additive `order_failed` decision, `failed` agent outcome).
- Backend, mock mode: signed mandates + versions + revoke + verify; evidence chain + `/api/evidence/verify`
  (tamper detected at the right seq, also when a record is re-hashed); checker; shopping agent (mock);
  approvals (nothing charged before approve; double approve = 409; reject); rogue demo; disputes
  (simulate -> assemble -> submit; DEFENSIBLE vs MANDATE_BREACH); webhooks (idempotent); SSE; seed adapter.
- `npm test`: 22 pass, 0 fail. `npm run test:e2e`: 4 pass, 1 skipped (opt-in sandbox), qa still adding cases.
- Seed: `npm run seed` x2 idempotent (1 mandate `m_seed_groceries`, 3 synthetic purchases, 9 evidence records).

- **Live loop proven (2026-11-08):** live Claude via 9router (`cc/claude-sonnet-5-5`) chose GRO-PANTRY-42 under
  the signed mandate -> real PayPal sandbox order -> buyer approved on sandbox.paypal.com -> capture
  COMPLETED at PayPal (USD 42.00) -> ledger `completed`, evidence `selected -> order_created -> captured`,
  chain valid. The capture trigger was a SIMULATED `CHECKOUT.ORDER.APPROVED` webhook posted locally
  (PayPal cannot reach localhost); the capture call itself was real. Needed US sandbox business + personal
  accounts (earlier India accounts gave "seller doesn't accept payments in your currency").
- **Deployed + real signed webhooks proven (2026-11-08):** https://mandate-ledger.onrender.com (Render free, GitHub
  repo BUTTERFINGERS7498/PaypalAi, auto-deploy from main). Live agent on Render (via Cloudflare tunnel to 9router,
  model `cc/claude-sonnet-5-5`) created sandbox order 5ET23085VF241733U; buyer approved at PayPal; PayPal delivered
  `CHECKOUT.ORDER.APPROVED` (verified=true) -> server captured (authorised_by=payer) -> `PAYMENT.CAPTURE.COMPLETED`
  (verified=true) -> purchase `completed`; PayPal shows capture COMPLETED USD 42.00; evidence chain valid. Delivery lagged
  ~40s+ after PayPal created the event. An unsigned fake webhook is rejected with 400.
- Render env gotchas hit: WEBHOOK_VERIFY typed "Off" (fixed + config now case-insensitive); ANTHROPIC_MODEL needed the
  `cc/` prefix for 9router. The Cloudflare tunnel to the laptop is fragile for judging (Dec 1-15): prefer a real
  Anthropic key (ANTHROPIC_BASE_URL empty, model claude-sonnet-5-5) before submitting.
- Disputes API: read/list works with the US app (0 disputes); write calls (provide-evidence, accept-claim)
  untested. Creating a dispute via `POST /v1/customer/disputes` got through schema validation (body needs
  `disputed_transactions[].buyer_transaction_id`, `reason`, `dispute_amount`, and
  `extensions.merchandize_dispute_properties.{issue_type,product_details.{description,product_received}}`;
  `sub_reasons` as objects was malformed) but PayPal answers `TRANSACTION_NOT_ELIGIBLE` for our fresh
  captures, and the buyer could not open one in the sandbox UI either. Retry later (eligibility may be
  time-based); otherwise ship with `simulated` disputes, clearly labelled.
- Rogue purchase proven live: `pur_..DMFR` Wireless headphones $39 captured at PayPal with
  `within_mandate:false`, `breaches:[category_not_allowed]`, `demo_rogue:true`; without the flag live Claude
  refused. Simulated disputes assembled live: in-mandate -> DEFENSIBLE/provide_evidence, rogue ->
  MANDATE_BREACH/accept_claim. Fixed a real bug: narratives were truncated (max_tokens 700 vs hidden
  reasoning); now 3000 plus guards (cut-off / missing-verdict replies fall back to the template).

## Half-finished / unverified
- PayPal Disputes write calls (`provideEvidence`, `acceptClaim`), real dispute events, live dispute narrative
  (`disputes.ts` `narrative`), live rogue run: not yet run against the sandbox.
- `.env` still has PAYPAL_MODE=mock, AGENT_MODE=mock and ANTHROPIC_MODEL without the `cc/` prefix: live runs
  override these via process env (`$env:PAYPAL_MODE='sandbox'` etc.); the human should fix the file.
- Webhooks from real PayPal; Render deployment; `ui` console not reopened/verified in a browser by orchestrator.
- qa e2e coverage for disputes, rogue path, approvals still being written (`e2e/`, `handoffs/qa-findings.md`).
- platform: README judge-path, `render.yaml` start command `npm run seed && npm start` (seed adapter now exists).

## Next step (in order)
1. Human: create a new `.env` (old one was deleted with the old project): PayPal sandbox business app
   `PAYPAL_CLIENT_ID/SECRET`, buyer email, and the 9router `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
   (use model id `cc/claude-sonnet-5-5`). Never paste secrets into chat or notes.
2. Run the **Day-1 spikes** (contract section 12): (a) does the sandbox app allow the Disputes API?
   (b) can an order be captured without the buyer approving in a browser (`CHECKOUT_MODE=card`) or must we
   use `payer_approval`? Then run one real sandbox order end to end and record what happened.
3. Render: create the account + Blueprint from `render.yaml`; register `/webhooks/paypal`; set
   `PAYPAL_WEBHOOK_ID`; done-test = a webhook POST visible in Render logs and `GET /api/webhooks` verified.
4. Review qa/ui/platform DONE reports by running things, not trusting summaries.
5. Feature freeze Tue Nov 11 midday; demo video < 3 min (script in plan section 8.1); Devpost text, AI-tools disclosure.

## Decisions (do not re-litigate)
- Stack: Next.js (static export served from `dist/ui`), Node 24 TypeScript (type-stripping, `node:http`,
  `node:sqlite`, no framework), SQLite (Render disk is ephemeral: seed restores demo state), Claude via the
  Anthropic SDK (through 9router when `ANTHROPIC_BASE_URL` is set).
- The **checker is code, not the LLM**; the **dispute verdict is computed from evidence by code**; the LLM
  only writes narrative. PayPal mutations need a ticket minted only by `src/server/gate.ts`.
- Evidence `budget_after = budget_before + price` whenever the agent made a choice, including `blocked`.
- Unknown order OR dispute id in a webhook -> stored `processed:false, error:"unknown_purchase"`.
- `demo_rogue` bypasses only the guard's `blocked` outcome; the checker still records `within_mandate:false`.
- Pivot rule (plan): if a real sandbox order from an agent decision is not working by Sun night, cut
  disputes/rogue and ship mandate + evidence only.

## Blockers
- Needs the human: credentials, Render account, any PayPal sandbox account work, git/publishing.
- Possible: Disputes API may be limited-release; headless capture may be unavailable (fallbacks above).

## Notes
- The seeded grocery catalog tops out at $60, so the over-$75 approval demo needs a lower threshold
  (edit the mandate limits) or a pricier in-category item; undecided.
- Another session created `implementation-plan.pdf` and `make_impl_plan_pdf.py`; `hackathon-notes/`
  (rules + strategy PDF) sits in this folder.
- Old invoicing-clerk project was deleted on purpose; nothing from it is reusable except as ideas.
