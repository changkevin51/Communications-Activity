# Signal Shift

Anonymous classroom perception game with a hidden score-matched recap (Part 1, `plan.md`) and a presenter-controlled projector reveal (Part 2, `plan2.md`).

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
npm run test:e2e                        # Playwright mobile + desktop projector, Chromium + WebKit
```

## Projector reveal (Part 2)

The host console has a **Present** button on each session. It opens the presenter console (`/host#present=<sessionId>`) with the current and next projector frames, speaker notes, a scene strip, readiness, data health and the projector link. The projector itself is `/screen/<CODE>#k=<screen key>`; the key is removed from the address bar after load and can be rotated from the console (open projectors disconnect).

### Rehearsal

1. Create a **test** session and click **Present**.
2. Open the projector link on a second window/display (fullscreen with F11).
3. In **Rehearsal**, pick a scenario (`expected`, `noisy`, `none`, `reversed`, `small`, `ties`, `imbalanced`, `lateheavy`), class size and seed, then **Run rehearsal**. The projector shows `REHEARSAL · SYNTHETIC DATA`; test sessions without a rehearsal show `TEST SESSION`. Rehearsal data is refused on live sessions.
4. Walk the show with the keyboard or a clicker. **Hold to REWIND** clears the snapshot and returns to the lobby.

`npm run sim -- --n 40 --reveal` also plays a bot class through BEGIN → end and prints a projector link.

### Classroom checklist

1. Before class: create the **live** session, click **Present**, open the projector link on the room display and confirm the console says *Projector connected*.
2. Lobby shows the room code and QR; the projector auto-follows lobby → playing → stand by while students play (turn off *auto-follow* to pin a frame).
3. When nearly everyone is done: **Close joins** in the host panel → check *Readiness* and *Data health* → **Hold to BEGIN REVEAL** (or press Enter twice within 2 s). BEGIN freezes an immutable snapshot; later ratings do not change it. Phones switch to a neutral “Eyes up here”; students still finishing see a small banner and can keep going.
4. Late finishers are counted on the console. **Hold to RESNAP** re-freezes the data if you want to include them.
5. A second device can open the console (phone backup QR) and **Take control**; only the controlling console can drive.

### Presenter keys

| Key | Action |
| --- | --- |
| → ↓ Space PageDown | next beat |
| ← ↑ PageUp | previous beat |
| Shift+→ / Shift+← | next / previous scene |
| B or . | hold (blackout) — emergency |
| R | replay the current beat |
| F | plain mode (static text, no animation) — emergency |
| G | focus the scene strip |
| Enter Enter | BEGIN REVEAL |
| ? | shortcut overlay |

Motion can be set to full / calm / off from the console; projectors with reduced-motion enabled use calm.

## Deploy

`render.yaml` defines a single Render web service with a persistent disk at `/var/data` (`DB_PATH=/var/data/signal-shift.db`). Set `ADMIN_KEY` in the Render dashboard. Health check: `/healthz`.
