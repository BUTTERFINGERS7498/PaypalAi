# CONTEXT.md — Sentry (PayPal AI Hackathon)

Last updated: 2026-11-11 (IST). Deadline: **Thu Nov 12, 2026, 12:00 pm PT**.
Plan of record: `implementation-plan.pdf` (a private planning file, git-ignored). API of record: `docs/api-contract.md`.
Repo: https://github.com/BUTTERFINGERS7498/PaypalAi (currently **private**; must be public to submit), 21 commits on `main`,
sole author BUTTERFINGERS7498. Hosted demo: https://mandate-ledger.onrender.com (Render free, auto-deploys from `main`).

## What it is
A consumer gives an AI shopping agent a signed, scoped **mandate** (monthly cap, allowed categories, approval
threshold). The agent shops through the PayPal **sandbox**; every decision writes a hash-chained **evidence record**;
on a dispute the evidence is assembled into a response whose verdict is computed by code (`DEFENSIBLE` /
`MANDATE_BREACH` -> accept_claim). PayPal SANDBOX only. We do NOT claim AP2/FIDO conformance, real liability shift,
card-network integration or production readiness. The README states exactly what is real vs simulated.

## Who is working
Only the orchestrator/backend session (Claude) is active. The ui/qa/platform helper terminals (herdr) have finished
and were killed; nothing is running. Their briefs are in `handoffs/`. Follow-ups never done: `handoffs/backend-reconcile.md`
(qa tests for `POST /api/purchases/:id/reconcile`; platform: add `RECONCILE_INTERVAL_SECONDS` to `.env.example`).
To restart an agent: `hc run --bg --name <n> --cwd <repo> claude|codex`, then `hc send`/`hc keys <n> enter`.

## Done (verified by running it)
- **Group C engine upgrades (2026-11-11, uncommitted):** `src/server/engine.ts` decide() now has: concept map
  (`EXPANSIONS`, concept words also scored alone at 0.9), trace in evidence `data.agent` (scores, confidence,
  expansions, substitution, preference, injection), clarify question (`CONFIDENT 0.50`, `CLARIFY_GAP 0.05`,
  `WIDE_TIE_MAX 0.60`; evidence decision `clarify`, `AgentResult.choices`), substitution (`SUB_GAP 0.15`, over budget or
  wrong category), "the usual" + prefer-bought-before (history = completed in-mandate purchases), injection flag
  (`detectInjection`, all modes). Mandate clause `limits.ask_when_unsure` (stored only when true) -> checker reason
  `low_match_confidence`. New `src/server/mandate-draft.ts` + `POST /api/mandates/draft` (rules + engine for
  categories; lists missing values). UI: draft box + checkbox + §4 clause (MandateView), answer buttons
  (LedgerView), score bars + "How it decided" chips (EvidenceView). Bench: `npm run bench:engine -- <model>`
  (`scripts/engine-bench.ts`, sets in `tests/helpers/engine-cases.ts`). MiniLM: tuning 18/18, held-out 14/15,
  negatives refused 6/6; bge-small and gte-small refuse 0/6, so MiniLM stays. `npm test` 47 pass, e2e 4 pass 1 skipped.
  README + `docs/api-contract.md` updated. Sandbox checked 2026-11-11: refunds work (partial + full, idempotent, over-refund 422) and authorize/void works; probe scripts were in the scratchpad, results in the plan. Group B plan: `hackathon-notes/group-b-plan.md` (B7, B1, B2 first).
- **Console UI rebuilt (2026-11-11, uncommitted):** direction "The Leash + Notary". New `src/ui/app/console.css` (scoped under `.sx`, landing untouched),
  left-rail `Shell.tsx`, new `FenceView.tsx` (SVG map: cap ring, approval ring, hatched outside band, one dot per purchase), mandates as signed documents,
  ledger as receipts with a Table (AG Grid, themed) toggle, evidence as a chain that turns green on verify, disputes as case list + dossier with verdict stamp.
  `TabId` gained `"fence"` (default tab). The landing page (`Landing.tsx`, `landing.css`) was rebuilt in the same style: hero is a live fence with cap/threshold/price sliders and a verdict stamp; story as stamped paper cards; walkthrough, product cards and honesty section restyled. No data logic changed. Checked by screenshots at 1440 px and 390 px; `npm test` 36 pass, `npm run test:e2e` 4 pass, 1 skipped.
- **Demo video re-filmed (2026-11-11, uncommitted):** `demo/sentry-demo-3min.mp4` is 170.6 s = animated intro (`demo/cut/intro.html` + `intro.json`, 24 s: agent shops, charge disputed, Sentry fix) + part A (66.8 s, `part-a.json`) + part B (79.4 s, `part-b.json`), joined with ffmpeg. New UI, Edge neural voice "Andrew", captions off. Recorded on mock PayPal + engine; `demo/approve-orders.mjs` runs between A and B; reset the seeded DB before each record. Narration in playback order: `demo/cut/narration.txt`. Subtitles are ON (burned in; `captions: true` in the three scenarios, re-rendered with `agent-screenplay render`, no re-filming). README now has a "problem and the fix" section and seven new-UI GIFs in `docs/media/` (`story-problem`, `story-solution`, `ui-*.gif`, cut from the caption-free recordings, 0.2 to 1.1 MB each); old `action-*.gif` deleted. Not yet listened to by a human. The five `docs/media/console-*.jpg` screenshots (fence, mandates, ask-agent, evidence, disputes) were retaken on the new UI (2026-11-11).
- **Earlier demo voice change:** `demo/sentry-demo-3min.mp4` now has an Edge neural voice ("Andrew") mixed over the old picture (commit 8b2351f, pushed). Captions are still burned into that picture.
- **Backend** (`src/server`): signed + versioned mandates (ed25519), deterministic checker, gate (only place that mints PayPal
  tickets), hash-chained evidence (tamper detected), approvals, rogue demo, disputes (verdict by code), webhooks (signature
  verified, idempotent), SSE, seed adapter, PayPal sandbox + mock clients.
- **Live loop on the real PayPal sandbox:** agent -> order -> buyer approves on sandbox.paypal.com -> capture COMPLETED at PayPal
  -> ledger `completed` -> evidence chain valid. Needed **US** sandbox business + personal accounts (India accounts gave
  "seller doesn't accept payments in your currency").
- **Real signed webhooks on Render:** `CHECKOUT.ORDER.APPROVED` + `PAYMENT.CAPTURE.COMPLETED` verified + processed; unsigned
  fake event rejected with 400. PayPal delivery can lag ~40 s.
- **Webhook safety net** (`gate.ts` reconcile + `POST /api/purchases/:id/reconcile` + poller every 15 s): captured a
  buyer-approved order before the webhook; the late webhook was harmless (one capture, no false `order_failed`).
- **Rogue purchase live:** out-of-category item captured at PayPal with `within_mandate:false`, `demo_rogue:true`; without the
  flag live Claude refused. Simulated disputes: in-mandate -> DEFENSIBLE/provide_evidence, rogue -> MANDATE_BREACH/accept_claim.
  Fixed: dispute narratives were truncated (max_tokens 700); now 3000 + guards.
- **Agent endpoint protection:** when `APPROVAL_TOKEN` is set, `POST /api/agent/instructions` and `.../reconcile` need the bearer
  token (401 first, before any limit); rate limits 30 requests/hour per client and 300/day overall against real sandbox
  (`AGENT_RATE_LIMIT_PER_HOUR`, `AGENT_DAILY_LIMIT`; off in mock mode). In-memory, per process. Verified live: 401 without a token.
- **On-server semantic engine** (`AGENT_MODE=engine`, `src/server/engine.ts`): no API key, no outbound AI call. Local
  `Xenova/all-MiniLM-L6-v2` embeddings (~23 MB, ONNX via `@huggingface/transformers`) + rules (sku, price caps) + keyword fallback.
  Spike: 16/18 acceptable top picks vs 12/18 keyword baseline; whole server ~149 MB RSS; fine in a 512 MB / 0.1 CPU container.
  Tuned after smoke test: `NEAR_TIE=0.03`, `MIN_SIMILARITY=0.42`, `CAP_GAP=0.10`. Known weak: abstract asks ("something warm to
  drink in the morning"). **Live on Render:** `/api/health` shows `agent_mode: engine`, `engine.state: ready`,
  `backend: embeddings`, load 3.2 s on the free CPU (limit 0.15 CPU). Build runs `npm run build:engine` (fetches the model into
  git-ignored `./models`); `render.yaml` sets `ONNXRUNTIME_NODE_INSTALL=skip`.
- **Tests:** `npm test` 36 pass (22 + 14 engine); `npm run test:e2e` 4 pass, 1 skipped (opt-in real-sandbox). Model tests skip,
  not fail, when the model is absent.
- **UI:** shows "on-server semantic engine (not an LLM)" and a note on the ask form; demo-mode hint fixed to `ELE-GAME-01`.
- **README** rewritten (hero + screenshots in `docs/media/`, real-vs-simulated table, setup, Render, API, troubleshooting).

## Half-finished / unverified
- **Stale after the UI rebuild:** README screenshots/GIFs in `docs/media/` and all demo videos in `demo/` show the OLD console. Retake them if wanted. The part-A recording take in `demo/cut/.screenplay/takes/part-a` was lost, so the 3-min cut cannot be re-rendered without re-filming.
- **A full agent request on the hosted console is unverified:** the agent needs the approval password (the human has it; the
  assistant does not). Engine + real PayPal sandbox together is untested (engine only ran against mock PayPal).
- **Real PayPal dispute round trip:** `POST /v1/customer/disputes` passes schema validation but PayPal answers
  `TRANSACTION_NOT_ELIGIBLE` for our fresh captures (buyer could not open one in the sandbox UI either). Disputes **list** works.
  provide-evidence / accept-claim untested. Retry later; otherwise ship with labelled `simulated` disputes.
- **Render env needs checking by the human:** `AGENT_MODE=engine` is set; whether `ANTHROPIC_API_KEY/BASE_URL/MODEL` were deleted
  is unknown (health does not show it). Render memory chart is empty on the free plan (no direct reading).
- **Security follow-up:** the 9router dashboard showed "default password" with "Allow dashboard access via tunnel" ON. The human was
  told to change the password and turn tunnel access off; unconfirmed. Engine mode removes any need for the tunnel.
- Not built (designed only): bring-your-own-key / free-provider adapter (Anthropic, Gemini, Groq, OpenRouter via an OpenAI-compatible
  path); the human chose the on-server engine instead for now.

## Next step (in order)
1. Human: in Render, **delete `APPROVAL_TOKEN`** (decision: demo stays open, no password) and redeploy; then try the engine in the
   console (`breakfast stuff`, `coffee beans under $10`) and tell the orchestrator the result. Rate limits still apply.
2. Make the repo **public** (GitHub Settings -> Danger Zone) and confirm MIT shows in the About panel.
3. Demo video: 7 captioned pieces + a full 4m21s cut are in `demo/` (README has a section; recorded on local mock PayPal + engine via `agent-screenplay`, scenarios `demo/0N-*.json`, `demo/approve-orders.mjs` stands in for buyer approval). A 2m39s narrated cut is `demo/sentry-demo-3min.mp4` (scenarios `demo/cut/part-a.json` + `part-b.json`, narration `demo/cut/narration.txt`, voice = local Windows SAPI Zira, recorded in two parts with `approve-orders.mjs` between them, joined with ffmpeg). **Still to do:** upload it to YouTube (public) and replace the TODO link in `README.md`; optionally swap in a nicer voice (Cartesia/ElevenLabs key)
   (an HTML `TODO` comment marks the spot). Write the Devpost text + AI-tools disclosure (README has an "AI tools" section).
4. Optional: retry the real dispute (`POST /v1/customer/disputes`) once more later; run engine + real PayPal sandbox once.
5. Optional: qa follow-ups (`handoffs/backend-reconcile.md`), `.env.example` `RECONCILE_INTERVAL_SECONDS`, BYOK adapter.
6. Feature freeze Tue Nov 11 midday; submit before Wed Nov 12 12:00 pm PT.

## Decisions (do not re-litigate)
- Stack: Next.js static export served from `dist/ui`; Node 24 TypeScript (type-stripping, `node:http`, `node:sqlite`); SQLite
  (Render disk is ephemeral: seed restores the synthetic demo state on each boot).
- The **checker is code, not a model**; the **dispute verdict is computed from evidence by code**; a model may only write narrative.
  PayPal mutations need a ticket minted only by `src/server/gate.ts`. The engine/agent only PROPOSES.
- Hosted demo default agent = the **on-server engine** (free, no key, no owner credentials on Render). Claude (`live`) is for local runs
  and the demo video. Do not put owner API keys on the public instance.
- **Hosted demo stays OPEN (decided 2026-11-08):** no approval password for judges; `APPROVAL_TOKEN` is unset on Render. Safe because the
  engine needs no key and PayPal is sandbox-only. The token feature remains in code for anyone who wants to lock a deployment.
- **Project renamed to "Sentry" (2026-11-09).** Signing note stays "Mandate Ledger demo key" on purpose (it is inside signed payloads and tests). Repo name `PaypalAi` and the Render URL `mandate-ledger.onrender.com` are unchanged. Not checked: trademark/domain clash (Sentry is also an existing error-monitoring company).
- `PAYPAL_ENV` stays strict (`sandbox` only); other enum env values are case-insensitive.
- Evidence `budget_after = budget_before + price` whenever the agent made a choice, including `blocked`.
- Unknown order OR dispute id in a webhook -> stored `processed:false, error:"unknown_purchase"`.
- `demo_rogue` bypasses only the guard's `blocked` outcome; the checker still records `within_mandate:false`.
- Pivot rule from the plan (cut disputes/rogue if the real order path failed) is moot: the real order path works.

## Blockers
- Human-only: Render env/password decisions, making the repo public, the demo video, Devpost submission, any PayPal sandbox account work.
- PayPal real dispute creation (see above); may stay simulated.

## Notes
- Local `.env` (never commit; git-ignored) is set to PAYPAL_MODE=sandbox, AGENT_MODE=live, model `cc/claude-sonnet-5-5` via 9router
  (`http://localhost:20128`). For local engine runs override: `$env:AGENT_MODE='engine'`, run `npm run build:engine` once.
- Seeded grocery catalog tops out at $60, so an over-$75 approval needs a lower threshold or a second electronics mandate (README explains).
- Tooling I used and cleaned up: Docker Desktop (started then stopped), scratch folders in TEMP. `hackathon-notes/` and the plan PDF
  are git-ignored. Commit author identity is set per-repo (BUTTERFINGERS7498 noreply email); never add Co-authored-by trailers; never push
  without being asked.
