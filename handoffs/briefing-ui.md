# Briefing: ui (Claude 2, frontend), WP-7

You own **`src/ui/**` ONLY**. Never edit outside it. API changes go in `handoffs/ui-requests.md`.
Dependencies: ask platform in `handoffs/deps.md` (platform owns `package.json`). No git.

Read first: `docs/api-contract.md` (esp. sections 3, 4, 11) and `implementation-plan.pdf` (sections 2 and 8).

## Build (Next.js + TypeScript, `output: 'export'`, AG Grid)
The Mandate Ledger console, four views a judge can follow end to end:
1. **Mandate editor** — list/create mandates, edit limits (creates a new version), revoke, "verify
   signature" button showing the `/verify` result. Show budget spent/remaining.
2. **Purchase ledger** — AG Grid of purchases, live via SSE (`/api/stream`), status chips, flags for
   `within_mandate:false` and `demo_rogue`, and the "Ask the agent" box (`POST /api/agent/instructions`)
   with a mandate picker and a clearly labelled "demo: let the agent break its mandate" switch.
   Also the approval queue (approve/reject; `needs_approval` outcomes) and, for `awaiting_payer`,
   an "Open PayPal to approve" link (`approve_url`).
3. **Evidence trail** — for a purchase, the records oldest-first: instruction, options seen with
   prices, choice and rationale, budget before/after, mandate id+version, within_mandate/breaches,
   short hash + prev_hash, and a chain-valid badge (`/api/evidence/verify`).
4. **Dispute console** — list disputes, "Assemble evidence" (`/assemble`), show verdict
   (`DEFENSIBLE` vs `MANDATE_BREACH`) and the packet narrative, "Submit" (`/submit`). Label
   `simulated` disputes visibly.

## Rules
- Until the backend is live, use mock data matching the contract behind **one data-source switch**
  (`NEXT_PUBLIC_DATA_SOURCE=mock|api`; default api when `NEXT_PUBLIC_API_URL` is set).
- If `APPROVAL_TOKEN` is set on the server, ask for it at runtime in an in-memory "Approval password"
  field and send it as `Authorization: Bearer`. **Never read a `NEXT_PUBLIC_` secret.**
- Accessible, readable, responsive; real `<button>`/`<a>`; text contrast >= 4.5:1.
- The honest-claims boundary (contract section 0.6) applies to every label: no "AP2 compliant", no
  "liability shifted".
- Done = `tsc --noEmit` and `next build` pass and you have seen it run against mock data. Report
  DONE + what you verified, or BLOCKED + two sentences, then wait.
