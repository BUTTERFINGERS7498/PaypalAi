# QA contract suites

Node 24 built-ins only; no test packages. Run from the repository root:

```text
npm test
npm run test:e2e
```

Without the platform scripts, equivalent commands are `node --test tests/*.test.ts` and
`node --test e2e/*.test.ts`. Missing `src/server/index.ts` is an explicit test failure.

Each API test starts a new backend child on an OS-selected free port with a disposable SQLite
database under `tests/.tmp/`. The server must apply `db/schema.sql` on boot. After health is ready,
the test inserts its deterministic catalog rows into its own database; it does not depend on the
demo seed or modify application data. Shutdown removes the database and its journal files.

Mock children receive an environment allowlist, never inherited credentials or `NODE_OPTIONS`,
and are launched without `.env`. They always use `PAYPAL_ENV=sandbox`, `PAYPAL_MODE=mock`,
`AGENT_MODE=mock`, `WEBHOOK_VERIFY=off`, and payer approval checkout. A preload blocks and records
fetch, sockets/TLS, HTTP(S)/HTTP2, DNS, UDP, WebSocket and subprocess attempts. Teardown requires
an empty audit log. Literal IP lookup for server listening is permitted without network traffic.
This is an application-test guard, not an OS security boundary against hostile native code.

Coverage:

- Mandate ed25519 verification against the persisted public key; version history, SQL immutability,
  corruption detection, revocation, and approval-token auth.
- Deterministic category/cap/threshold checks; reserved awaiting-payer spend; approval rechecks
  after revocation, category change, or budget consumption; repeated approve/reject handling.
- Independent canonical JSON/hash verification; exact decision counts; pagination/filters;
  SQL UPDATE/DELETE rejection; test-side corruption with triggers restored; honest invalid-chain verdict.
- Contract webhook builders, replay idempotency, capture completed/denied, unknown resources,
  and dispute created/updated/resolved handling.
- Three isolated complete mock demo runs, including normal and rogue purchases, simulated
  dispute assembly/submission, plus adversarial instruction text that must not flip the verdict.

The opt-in sandbox test is OAuth connectivity only: set `PAYFLOW_E2E_SANDBOX=1` and supply
`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` through your environment. It skips when disabled or
credentials are missing, pins the PayPal sandbox host, rejects redirects, and never logs the
response body or token. It does not establish real Orders/Disputes API access or hosted webhook
delivery. No backend integration test skips when implementation is missing.

The public contract exposes no in-process mock PayPal call counters. Blocked/queued-path tests
assert no order/capture identifiers, no order-created evidence, and zero attempted outbound I/O;
they cannot detect a fake client method called internally and then discarded. See the QA handoff
for the cross-territory observability request and actual run counts.
