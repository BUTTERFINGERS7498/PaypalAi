# Platform handoff (2026-11-08)

Territory: infra/**, scripts/**, db/**, package/lockfiles and root configs. No git used.

## Backend seed integration (resolved)

Please expose `src/server/seed.ts` with `export async function seedDemo(db: DatabaseSync)`
(or report your actual module API here so platform can adapt). Platform's `npm run seed` opens
DATABASE_PATH, applies db/schema.sql, and idempotently inserts the 14 catalog items before calling it.
This adapter must use the app's own signing + evidence recorder, do no outbound network calls,
and idempotently create one active `Groceries, $200/month` mandate (USD 200.00,
groceries only, approval_above 75.00) and 2-3 **synthetic** completed historical purchases with
valid evidence chains. Please use stable seed identities, a current UTC month timestamp,
and clearly synthetic PayPal order/capture IDs. Never delete/rewrite existing evidence or keys.
Backend supplied this adapter and an explicit handoff; full seed verification is now complete.

Please apply `db/schema.sql` on boot and serve `dist/ui/`. Bind the HTTP listener on 0.0.0.0
for Render. A successful webhook receipt should write a sanitized log containing only
event ID/type + verification/processing status (no raw body, headers, credentials).
UI dev uses http://localhost:3000 with API http://localhost:8787: please support that origin,
including OPTIONS/Authorization/Content-Type if not already supported.

## Frontend coordination

Platform is honoring handoffs/deps.md: Next.js 15, React 19, AG Grid Community/React 33,
TypeScript 5.9 and types (the initial build also passed with Next 16 / AG Grid 36).
Requests for other dependencies go in handoffs/deps.md. UI owner supplies src/ui/next.config.*
with `output: 'export'` and its own tsconfig; build:ui invokes Next for src/ui and copies out/
to dist/ui. `npm run dev:ui` uses port 3000, default API http://localhost:8787.
Public builds must use NEXT_PUBLIC_DATA_SOURCE=api and same-origin NEXT_PUBLIC_API_URL="".

## Orchestrator: Render day-1 steps

1. Review files and publish the repository using your own git workflow. Platform never runs git.
2. In Render, New > Blueprint > connect the published repository > use root render.yaml.
   Select Node 24; build `npm install && npm run build:ui`, start `npm run seed && npm start`,
   health /api/health. The blueprint restores synthetic demo state on each fresh-service boot.
   The source seed is ready; do not claim a deployed demo until Render checks pass.
3. The blueprint fixes PAYPAL_ENV=sandbox, PAYPAL_MODE=sandbox, CHECKOUT_MODE=payer_approval.
   Enter sandbox credentials privately. Set dashboard-managed AGENT_MODE, WEBHOOK_VERIFY,
   and ANTHROPIC_MODEL (all sync:false). For initial receiver registration only, use
   WEBHOOK_VERIFY=off; set PUBLIC_BASE_URL to the Render HTTPS URL. Leave ANTHROPIC_BASE_URL
   empty on Render; AGENT_MODE=live there requires a real Anthropic API key.
   Keep the generated APPROVAL_TOKEN private; enter it in the UI's runtime approval field.
4. Create PayPal Developer sandbox business + personal accounts and a Sandbox REST app for
   the business. Enter credentials only in Render's private environment settings.
5. Register https://<service>.onrender.com/webhooks/paypal on that sandbox app for
   CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED/DENIED and
   CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED. Save its webhook ID privately in PAYPAL_WEBHOOK_ID.
6. Set PAYPAL_MODE=sandbox and WEBHOOK_VERIFY=paypal; leave PAYPAL_ENV=sandbox. Redeploy.
   Send a PayPal sandbox webhook (or perform the real sandbox approval flow).
7. Verify a webhook POST appears in Render logs AND GET /api/webhooks reports it verified.
   Record only the public service URL, event ID/type and outcome here, never secrets.
   If a webhook simulator cannot pass real verification, label that smoke unverified and use
   a real sandbox transaction to establish the done-test. Do not turn verification off silently.

Render free disk is ephemeral; schema/catalog can be rebuilt, but lost evidence cannot be recovered
by seed. Preserve DATABASE_PATH and signing key using an appropriate persistent service for a
stable judged run, or clearly disclose resets. Real PayPal delivery, API access and deployment
remain unverified until the human provides account-side completion evidence.

## Verification history

- Node v24.19.0 / npm 11.17.0 available. `npm install --no-fund --no-audit` passed (36 packages).
- Initial `npm test`: 14 tests, 0 passed, 14 failed because src/server/index.ts was not yet
  present. This is an integration dependency, not a platform test pass. Rerun after backend lands.
- `node infra/verify-platform.ts` passed: fresh file DB, schema applied twice, 10 tables,
  all 3 evidence indexes, UPDATE/DELETE rejected on both immutable tables (4 operations),
  catalog seeded twice with 14 distinct rows, all 17 contract environment names present.
- `npm run build:ui` passed (Next 16.4.5, static export copied to dist/ui, TypeScript passed).
  Next automatically normalized the UI owner's tsconfig during this required build (jsx
  react-jsx and .next/dev/types include); platform made no manual source/config edits in src/ui.
  UI owner: retain Next-compatible settings to prevent future build-time config rewriting.
- Render YAML parsed successfully: exact build/start commands, health path, sandbox environment,
  generated approval token and private secret declarations checked.
- Dependency request applied: Next 15.5.29 + AG Grid 33.3.2; npm install passed. Rebuilt static UI
  successfully with these requested versions; TypeScript passed. UI CSS emitted nonblocking
  autoprefixer warnings for align values `start`/`end` (prefer flex-start/flex-end if desired).
- `node infra/smoke-runtime.ts` passed using the real `npm start` command with isolated SQLite
  and no credentials: /api/health, static HTML, referenced JS asset, POST /webhooks/paypal,
  and stored local event `verified:false`. Child process tree stopped and temp DB removed.
  This is a local smoke test, not Render deployment or verified PayPal delivery.
- Initial backend-integrated `npm test`: **22 tests, 19 pass, 3 fail** (subsequently resolved):
  1. tests/checker.test.ts:24 blocked electronics choice records budget_after 0.00; expected
     hypothetical spend 129.00 per contract evidence budget definition.
  2. tests/checker.test.ts:69 over-cap choice records 84.00; expected hypothetical spend 88.50.
  3. tests/webhooks.test.ts:68 unknown dispute stores error unknown_dispute; contract/test expect
     unknown_purchase for unknown order/dispute IDs.
  Repro: `npm test` with isolated mock-provider suites. Platform did not edit backend/tests.
- Initial `npm run test:e2e`: **5 tests, 1 pass, 3 fail, 1 skipped** (sandbox opt-in).
  All three demo repeats fail at e2e/demo.test.ts:61: simulated packet.paypal_response contains
  extra action/note fields, while contract section 4 requires exactly `{ "simulated": true }`.
  Subsequently resolved by backend; current results below.
- Backend seed adapter received and verified: `node infra/verify-seed.ts` ran **npm run seed
  twice** against a fresh isolated file DB. Both passed; 14 catalog rows, 1 active signed
  mandate/version, 3 completed synthetic purchases, 9 valid evidence records, 1 persisted key.
  Repeat preserved row counts, key, signature and chain head. No credential values printed.

## Final platform result: DONE

- `npm install` passed with requested Next 15 / React 19 / AG Grid 33 dependencies and lockfile.
- Schema executed twice on a fresh temp SQLite DB; all append-only triggers and indexes verified.
- `npm run seed` twice: stable 14 catalog / 1 signed mandate / 3 synthetic completed purchases /
  9 evidence records; original key, mandate signature and chain head preserved and verified.
- Seed then **npm start** in mock mode: health, seeded API state, complete chain, static HTML/JS,
  and local unverified webhook POST/readback passed. Temp process tree and DB cleaned up.
- `npm test`: **22 passed, 0 failed**. `npm run test:e2e`: **4 passed, 0 failed, 1 skipped**
  (opt-in sandbox connectivity); all three mock demo repetitions passed. Previous failures resolved.
- `npm run build:ui` passed on requested dependencies, including TypeScript and copy to dist/ui.
- README covers clean-machine mock and sandbox setup, Claude/9router, account creation,
  deploy/seed behavior, and claims/simulation boundaries. Render YAML parsed and commands checked.
- No git commands; no credential values printed/hardcoded. All manual edits stayed in platform
  territory/handoffs. Required Next builds generated UI artifacts and normalized its tsconfig.

**Human-owned remaining acceptance:** deploy the blueprint and follow the steps above; verify
a real sandbox webhook POST in Render logs and verified:true in /api/webhooks. No deployed
Render URL, real PayPal checkout/dispute access, or verified public delivery is claimed here.

## Render prep follow-up: DONE (2026-11-08)

- render.yaml now starts `npm run seed && npm start`, fixes PayPal to sandbox, preserves
  payer_approval checkout, and leaves AGENT_MODE / WEBHOOK_VERIFY / ANTHROPIC_MODEL as sync:false.
- Added all seven requested internal planning/test-artifact ignore entries. This changes ignore
  rules only; the orchestrator must ensure already-tracked internal files are excluded when publishing.
- README's Deploying to Render section covers GitHub Blueprint setup, prompted credentials,
  PUBLIC_BASE_URL, all six webhook event types, webhook ID + verification + redeploy, empty
  ANTHROPIC_BASE_URL / real Anthropic key for hosted live mode, and free-plan sleep/ephemeral DB.
- Verification: Render YAML parsed; requested commands, environment settings, seven ignore rules
  and deployment instructions checked. `npm test`: **22 passed, 0 failed**. No git commands used.
