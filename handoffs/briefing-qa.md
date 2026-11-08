# Briefing: qa (Codex 2), WP-10

You own **`tests/**` and `e2e/**` ONLY**. Read everything; write only tests. File bugs as
`handoffs/qa-findings.md` with repro steps; never fix other agents' code. No git. Node's built-in
`node:test`, no test dependencies.

Read first: `docs/api-contract.md` (all of it) and `implementation-plan.pdf` (sections 1.3, 4, 8).

## Build
Each integration test starts `src/server/index.ts` as a child process on a free port with a temporary
SQLite DB and `PAYPAL_ENV=sandbox PAYPAL_MODE=mock AGENT_MODE=mock WEBHOOK_VERIFY=off`, then stops it
and deletes the data. Missing implementation is a **failure**, never a skip. Block/record outbound
network from the child; mock runs must make zero outbound requests.

1. **Webhook simulation harness** (`tests/helpers/`): builders for `CHECKOUT.ORDER.APPROVED`,
   `PAYMENT.CAPTURE.COMPLETED|DENIED`, `CUSTOMER.DISPUTE.CREATED|UPDATED|RESOLVED` per contract section 5.
2. **Core loop e2e:** create + verify a signed mandate -> agent instruction -> evidence record ->
   (`awaiting_payer`) simulated `CHECKOUT.ORDER.APPROVED` -> `completed` -> evidence trail in order.
3. **Mandate guarantees:** limits edit creates a new version and old versions stay verifiable; tampering
   is caught by `/verify`; revoke blocks the agent (`409 mandate_inactive`) and records evidence.
4. **Checker:** category breach -> `blocked`, no purchase, no PayPal call; over `approval_above` ->
   `needs_approval`, nothing charged until approve; exceeding the monthly cap -> blocked; approval
   re-checks the mandate; double approval -> 409.
5. **Evidence chain:** every decision writes exactly one record; `prev_hash`/`hash` link; `/evidence/verify`
   valid; a direct DB edit of a record makes it report `valid:false` with the right `broken_at_seq`
   (do this against the temp DB file, test-side only); UPDATE/DELETE on evidence is rejected by SQL.
6. **Rogue path:** `demo_rogue:true` completes an out-of-mandate purchase with `within_mandate:false`,
   `breaches` and `demo_rogue:true` recorded; its dispute assembles to `MANDATE_BREACH` /
   `accept_claim`; a within-mandate purchase assembles to `DEFENSIBLE` / `provide_evidence`; the verdict
   cannot be changed by narrative text.
7. **Webhooks:** idempotent replay, unknown order stored unprocessed, dispute events create/update a dispute.
8. An opt-in sandbox test (`PAYFLOW_E2E_SANDBOX=1`) that skips cleanly without credentials.

Record real `npm test` / `npm run test:e2e` counts and every bug (with repro) in
`handoffs/qa-findings.md`. Report DONE + what you verified, or BLOCKED + two sentences, then wait.
