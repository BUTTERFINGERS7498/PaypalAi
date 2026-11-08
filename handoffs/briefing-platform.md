# Briefing: platform (Codex 1), WP-1 and WP-9

You own **`infra/**`, `scripts/**`, `db/**`, `package.json`, lockfiles and root configs ONLY**
(including `LICENSE`, `.gitignore`, `render.yaml`, `.env.example`, `README.md`). Never edit `src/**`
or `tests/**`/`e2e/**`. Others request dependencies in `handoffs/deps.md`. No git.

Read first: `docs/api-contract.md` (sections 1, 2, 9) and `implementation-plan.pdf` (sections 4 and 8).

## Do, in this order
1. **Scaffold (WP-1):** `package.json` (Node 24, `"type": "module"`), `npm start`
   (`node --env-file-if-exists=.env src/server/index.ts`), `npm run dev:server`, `npm run dev:ui`,
   `npm run build:ui` (Next.js static export copied to `dist/ui/`), `npm test`
   (`node --test tests/*.test.ts`), `npm run test:e2e` (`node --test e2e/*.test.ts`), `npm run seed`.
   **MIT `LICENSE`** at the repo root (GitHub must detect it), `.gitignore` (node_modules, .env,
   data, dist, .next), `.env.example` with every name from contract section 2 and placeholder values.
2. **`db/schema.sql`** exactly per contract section 9: idempotent `CREATE TABLE IF NOT EXISTS`,
   append-only triggers on `evidence_records` and `mandate_versions` (`RAISE(ABORT)` on UPDATE and
   DELETE), the listed indexes.
3. **Render (WP-1):** `render.yaml` for a Node 24 web service (build `npm install && npm run build:ui`,
   start `npm start`, health check `/api/health`), env vars declared (secrets `sync: false`, generate
   `APPROVAL_TOKEN`). A public `/webhooks/paypal` is the day-1 goal: a webhook POST must show in the
   Render logs. The human owns the Render account; tell the orchestrator the exact steps they need.
4. **`scripts/seed.ts` (WP-9):** per the contract's seed paragraph. It must call the server's own
   modules for signing and evidence (the backend will expose them under `src/server/`), so wait for
   the backend handoff before finishing it; build the idempotent skeleton and catalog first.
5. **README (WP-9):** judge-ready, clean-machine setup and run, a no-credentials mock path
   (`PAYPAL_MODE=mock AGENT_MODE=mock WEBHOOK_VERIFY=off`), the real sandbox path, where the 9router
   or Anthropic key goes, how to create the PayPal sandbox business + personal accounts, and the
   claims boundary (contract 0.6). State plainly what is simulated.

## Rules
Never print or hardcode secrets. Verify by running `npm install`, `npm test`, the schema twice on a
fresh temp DB, and (once `src/server/index.ts` exists) `npm start` + `/api/health`.
Report DONE + what you verified, or BLOCKED + two sentences, then wait.
