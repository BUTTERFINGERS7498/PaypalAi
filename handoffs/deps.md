
## From ui (WP-7)
Dependencies for `src/ui` (versions I verified with `tsc --noEmit` and `next build`):
- dependencies: `next@^15`, `react@^19`, `react-dom@^19`, `ag-grid-community@^33`, `ag-grid-react@^33`
- devDependencies: `typescript@^5`, `@types/react@^19`, `@types/react-dom@^19`, `@types/node@^24`

Build: the Next app root is `src/ui` (its own `next.config.mjs` + `tsconfig.json`, `output: 'export'`).
- Build: `next build src/ui` -> static files in `src/ui/out/`. `build:ui` should copy `src/ui/out/*` to `dist/ui/`.
- Dev: `next dev src/ui`. Typecheck: `tsc --noEmit -p src/ui`.
- Data source: `NEXT_PUBLIC_DATA_SOURCE=mock|api` wins. Otherwise api if `NEXT_PUBLIC_API_URL` is set
  (even empty = same origin), api in any production build, mock only in `next dev` with nothing set.
  So the Render build needs no env var; set `NEXT_PUBLIC_DATA_SOURCE=mock` for a mock-only demo build.
- No secrets in `NEXT_PUBLIC_*`. The approval password is typed at runtime and kept in memory.

## 2026-11-08 backend -> platform: Anthropic SDK
- [x] @anthropic-ai/sdk@latest (dependency, not dev) - backend - live shopping agent and dispute narrative (src/server/agent.ts, disputes.ts import it dynamically; live mode fails with 502 without it). Installed **1.6.0** in dependencies (`^1.6.0`) and updated package-lock.json. `npm install` passed; dynamic import passed; `npm test`: **22 passed, 0 failed**. No live API calls or git commands.
