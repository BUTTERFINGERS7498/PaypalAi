# QA handoff — 2026-11-08

QA owns `tests/**` and `e2e/**`. Only this handoff is written outside those directories.
No git commands, production PayPal calls, hardcoded credentials, or application-source edits.
Read the QA briefing, the entire API contract, and the implementation plan (including sections
1.3, 4, and 8). Tests use Node 24 built-ins; no additional dependencies requested.

## Dependency tracking

**QA-DEP-001 — initially OPEN, now startup verified:** `src/server/index.ts` was absent at task
start. Initial contract runs failed explicitly with `OPEN DEPENDENCY: src/server/index.ts is
missing`; missing implementation was never skipped. The backend and platform landed during QA,
and current runs successfully start a fresh backend per integration test, apply the schema,
and exercise the public HTTP contract. The initial dependency is resolved by observed startup.

## Current run results

| Command | Tests | Passed | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm test` | 22 | 22 | 0 | 0 | 0 |
| `npm run test:e2e` | 5 | 4 | 0 | 1 | 0 |
| `node --test tests/harness.test.ts` | 3 | 3 | 0 | 0 | 0 |
| Sandbox smoke with opt-in enabled and credentials absent (sanitized child env) | 1 | 0 | 0 | 1 | 0 |

Full logs: `tests/results/npm-test.log` and `tests/results/npm-e2e.log`.
The explicit missing-credentials skip is recorded in `tests/results/sandbox-no-credentials.log`.
The three full mock demo paths each ran successfully, consecutively, with isolated children/DBs.
Each covers both the normal and rogue purchase, payer-approved capture, ordered evidence,
simulated dispute assembly/submission, and final hash-chain verification. The fourth e2e pass
checks that hostile narrative instructions cannot change the breach verdict.
The one skip is the opt-in real-sandbox OAuth smoke, disabled by default; it is not a skipped
backend dependency. No real sandbox checkout/dispute API or Render webhook delivery is claimed.
The standalone QA TypeScript no-emit check passed against all test/helper sources.
An earlier backend run was 19 passed / 3 failed (exit 1); both findings below were then fixed by
the backend owner and the final requested rerun is green. QA made no application-source changes.

## Findings — resolved in final verification

### QA-001 — blocked choice records omit projected spend (two failing tests)

**Status: RESOLVED.** Both category-block and cap-block repro tests pass in the final `npm test`.
The description below preserves the original observed behavior and reproducible regression case.

Contract section 3 states `budget_after = budget_before + price` when a choice is made; it is the
projected spend if the choice executes. A blocked choice still has an explicit `choice` and price.
The checker correctly blocks it and makes no purchase, but evidence sets `budget_after` to current
spend instead. Source route: `src/server/gate.ts`, blocked branch.

Repro A: `node --test --test-name-pattern="category breach" tests/checker.test.ts`.
The isolated fixture creates a groceries-only mandate and selects electronics SKU `QA-ELE-129`
at USD 129.00. Inspect the returned `evidence_record_id` with GET `/api/evidence/:id`:
`budget_before` is `0.00`, `choice.price` is `129.00`, but `budget_after` is `0.00` (expected `129.00`).

Repro B: `node --test --test-name-pattern="threshold and monthly" tests/checker.test.ts`.
A USD 84.00 cap / USD 42.00 threshold allows two USD 42.00 awaiting-payer orders, reserving USD 84.00.
Selecting USD 4.50 oats then blocks correctly, but its evidence has `budget_after: "84.00"`
(expected `"88.50"`). The actual mandate budget must still remain USD 84.00; this finding is about
the decision's hypothetical evidence field only.

Original request: align the blocked evidence projection with the contract, without changing actual
budget accounting to include blocked purchases. The final tests verify both projection and budget.

### QA-002 — unknown dispute webhook error code disagrees with contract (one failing test)

**Status: RESOLVED.** The unknown-order/dispute webhook repro test passes in the final `npm test`.
The description below preserves the original observed behavior.

Contract section 5 requires unknown order/dispute IDs to be stored with `processed:false` and
`error:"unknown_purchase"`, with HTTP 200. Unknown dispute UPDATED/RESOLVED events instead store
`error:"unknown_dispute"`. Source route: `src/server/webhooks.ts`, dispute updated/resolved branch.

Repro: `node --test --test-name-pattern="unknown order and dispute" tests/webhooks.test.ts`.
POST `/webhooks/paypal` an envelope from `disputeUpdated('QA-UNKNOWN-DISPUTE')` or
`disputeResolved('QA-UNKNOWN-DISPUTE')`, then GET `/api/webhooks?limit=50` and find its event ID.
Expected `processed:false,error:"unknown_purchase"`; observed `processed:false,error:"unknown_dispute"`.

Original request: use the contracted error code, or revise the contract first and announce it.

## Verification details and coverage limits

- Passed: independent ed25519/public-key verification; old signed versions remain verifiable;
  immutable version rows; signature tampering detection; revoke evidence and `409 mandate_inactive`;
  generated-token auth; approval waiting/execute/replay/rejection; mandate rechecks after revoke,
  category edit, or consumed cap; no-match decision; evidence SQL immutability, pagination/filters,
  independent chain hashes, precise corruption seq, and invalid-chain honest dispute verdict.
- Passed: order-approved replay idempotency, completed/denied capture events, dispute webhook
  create/update/resolve and no extra evidence for non-capture webhook actions. The UPDATED test
  establishes successful processing; exact mapping of PayPal's provider status strings to the
  local dispute status enum is not specified by the contract.
- Every mock child uses a credential-free env allowlist, sandbox/mock modes, and a preload that
  blocks/records outbound I/O. Every teardown asserts zero attempted outbound requests and removes
  its disposable SQLite directory. Guard self-tests verify ten blocked I/O paths and local listening.
  Final cleanup check found zero remaining temporary test directories.
- Public HTTP behavior proves no checkout identifiers/order-created evidence on blocked paths,
  and the child audit proves no outbound attempts. The fake client's in-process `calls` array is
  not visible through the public API; a fake call that is silently discarded cannot be excluded by
  HTTP tests alone. Backend request: provide a mock-only, test-side way to observe mutation counts
  without adding a public production endpoint; until then, do not overstate this assertion.
- Sandbox smoke pins `api-m.sandbox.paypal.com`, rejects redirects, only obtains OAuth, and never
  prints tokens or response bodies. It cleanly skips when disabled or credentials are absent.
- Contract clarification: the evidence JSON example subtracts a choice's price in `budget_after`,
  but the normative field definition adds it. QA follows the normative spend definition.
- Simulated submission currently adds `action`/`note` metadata to `paypal_response`. QA verifies the
  required `simulated:true` flag and accepts additive metadata; this is not filed as a product bug.

## Future regression runs

Run `npm test` and `npm run test:e2e`. Verified: 22/22 tests pass, and 4/4 enabled e2e tests pass
with one optional sandbox skip. Mock green results do not establish the plan's real PayPal/Render
done-tests; the orchestrator still owns account-side verification and deployment evidence.
