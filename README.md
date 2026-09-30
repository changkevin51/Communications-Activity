# Signal Shift — Part 1

Anonymous classroom perception game with a hidden score-matched recap. See `plan.md` for the full design.

## Run locally (Node 24)

```sh
npm ci
npm run dev          # server :3000 + Vite :5173 (participant at /, host at /host.html)
```

Host key in development: `dev-admin-key` (set `ADMIN_KEY` to override).

## Checks

```sh
npm run typecheck
npm test                                # unit, property, integration
npm run build && npm run check:bundle   # participant bundle leak check
npm start & npm run sim -- --n 60       # load simulation against a running server
npm run test:e2e                        # Playwright mobile Chromium + WebKit
```

## Deploy

`render.yaml` defines a single Render web service with a persistent disk at `/var/data` (`DB_PATH=/var/data/signal-shift.db`). Set `ADMIN_KEY` in the Render dashboard. Health check: `/healthz`.
