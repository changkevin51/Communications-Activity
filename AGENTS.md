# Agent notes

- Node 24 is required (`node:sqlite`).
- Participant-facing code (`src/client`, `src/shared/protocol.ts`, `src/server/views.ts`) must never expose condition, peer kind, diffs, strata, thresholds, or generated-peer flags. `npm run check:bundle` enforces this on the built participant chunks.
- Validate with: `npm run typecheck && npm test && npm run build && npm run check:bundle && npm run test:e2e`.
- `npm run sim -- --url <server> --key <ADMIN_KEY> --n 60` exercises a running server with 60 socket bots.
