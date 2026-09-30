---
agent: devin-local
session: rebel-duckling
created: 2026-09-30T04:44:55Z
---
# Signal Shift — Part 1 Implementation Plan (Hidden experiment + participant experience)

Build the disguised "Signal Shift" perception game and the hidden reference-group assignment as a single Render-hosted Node/TypeScript service (Fastify + Socket.IO + SQLite on a Render persistent disk, React/Vite client) that is reliable for ~25 live players, can be finished inside the 2-day deadline shared with Parts 2–3, stores everything Part 2's reveal needs, and leaves clean seams for Parts 2–3.

---

## 0. Decisions locked in (from Q&A)

| Topic | Decision | Consequence for the plan |
|---|---|---|
| Hosting | **Render**, paid always-on instances are fine ($50 credits) | Use `1c-2g` web service + 1 GB persistent disk. No free-tier sleep, no 30-day DB expiry. |
| Class size | **~25 players** | Thresholds tuned for a small pool; ghost fill guarantees valid comparison sets. |
| Timeline | **Class in 2 days, and Parts 2 + 3 are due too** | Part 1 is lean. Strict P0/P1/P2 tiers. Polish goes only to hero moments. Deploy a skeleton first. |
| Result screen | **Bare score (no "/1000") + non-anchoring stats** | Show avg reaction ("lock") time, best streak, fastest lock. No hit count, no %. Hit/miss feedback per round stays. |
| Leaderboard question | **Dropped** | Flow ends at rating_after → done. |
| Groups | **3 conditions, score-matched triplets** | Stratified assignment; `stratum` stored for the Part 2 reveal. |
| Opt-out | **No toggle**; anonymity notice only | One-line notice merged into the identity screen. There is no display-consent field. |
| Fabricated peers | **Allowed if necessary** | **Real-first, ghost-fill.** Synthetic "ghost" players fill slots only when real classmates can't satisfy a condition. Every ghost is persisted, reused consistently, and flagged. |

---

## 1. Repository inspection findings

- `C:\Users\chang\Documents\Projects\Communications` is **empty**. No code, packages, config, tests or deploy setup exist to reuse.
- **Hazard:** `git rev-parse --show-toplevel` resolves to **`C:/Users/chang`**, an uninitialized repo (no commits) rooted at the home directory. Any git command in this folder currently targets the home directory. **First implementation step:** `git init` inside `Communications/`. This is a non-destructive nested repo, and git then uses the nearest `.git`. We do not touch `C:\Users\chang\.git`. The user may delete it themselves later.
- Local tooling: Node **24.18**, npm 11.16, git 2.55 (identity configured). **Not installed:** `gh`, Docker, Render CLI. So the user creates the GitHub repo in the browser, and Render is connected through the dashboard or a Blueprint.
- Verified: **`node:sqlite` works unflagged on Node 24.18** (bundled SQLite 3.53.1). That means no native dependencies are needed for persistence.
- Patterns from the user's other projects (Codex AirCad, uOttaHack7, etc.): Vite + React 19 + TypeScript, Vitest, Playwright, raw `ws` Node servers. The plan follows these conventions.
- Package versions checked on npm today (pin exact versions ≥7 days old at install time): socket.io/socket.io-client 4.8.4, fastify 5.12.5, @fastify/static 10.1.5, zod 4.6.5, motion 13.4.6, qrcode 1.5.4, @fontsource-variable/{anybody, instrument-sans, jetbrains-mono} 5.3.0, fast-check 4.10.2, @playwright/test 1.63.0, tsx 4.23.15, esbuild 0.28.2, vite 8.3.x, vitest (4.1.x as in the user's other repo, or 5.0.x).

---

## 2. Scope, priorities, constraints

### In scope (Part 1)
- The participant flow: join → identity + notice → tutorial → 12-round game → score → rating #1 → calibrating/wait → personalized recap with 3 selected "other players" → rating #2 → done.
- Server-authoritative session and participant state, reconnect, idempotent commands, and server-side scoring.
- Hidden condition assignment (up / neutral / down): stratified, real-first with ghost fill. Every shown peer is persisted.
- Minimal host console: create/reset sessions, QR, stage funnel, release, raw table with internals hidden by default, a fallback summary by condition, export, and test bots.
- A Render deployment defined as a Blueprint.
- Tests: unit, integration, a multi-user simulation, Playwright E2E, and manual real-device checks.

### Out of scope (later parts)
- Projector/presenter dashboard and the dramatic reveal (Part 2).
- Polls, scenarios and the discussion system (Part 3).
- Leaderboard, accounts, analytics beyond the fallback table.

### Priority tiers (the 2-day deadline makes these binding)
- **P0** = must ship for class. **P1** = ship if every P0 is green. **P2** = defer.
- Rule: no P1 work starts until the P0 walking skeleton runs end-to-end **on Render** with bots and one real phone.

### Constraints
- Phones only; one-handed; no audio; Chrome Android and iOS Safari, including in-app browsers opened from QR scanners.
- No personal information (no names, emails, IPs or user agents in the DB).
- The purpose must stay hidden (see §11, leak hygiene).
- Single server instance. At ~25–100 users that is a feature: synchronous transactions mean no races.
- Dependencies: minimal, pinned, published ≥7 days ago.

---

## 3. Architecture

```
 Student phones (React SPA, index.html)          Presenter laptop/phone (Host SPA, host.html)
        │  Socket.IO ns "/p"  (wss, auto-reconnect,           │  Socket.IO ns "/h" (ADMIN_KEY)
        │  long-polling fallback)                             │  + GET /api/export (x-admin-key)
        └──────────────────────┐              ┌───────────────┘
                 Render Web Service "signal-shift" (Node 24, 1 instance, plan 1c-2g, region ohio)
                 ├─ Fastify: static SPA (/, /:code → index.html; /host → host.html), /healthz, /api/export
                 ├─ Socket.IO /p and /h → command handlers (validate with zod → one synchronous SQLite tx)
                 ├─ Domain core (pure TS in src/shared + src/server/assign): generator, scoring, flow, assignment
                 └─ node:sqlite (WAL) → /var/data/signal-shift.db on a 1 GB Render persistent disk
```

### Why this stack (and why not the obvious alternatives)
- **Render single web service (same origin):** the user asked for Render. One URL goes on the QR, there is no CORS, one deploy, and Socket.IO plus the static files come from the same host.
- **SQLite (`node:sqlite`) on a persistent disk instead of Render Postgres:** with one Node process, every command handler can run **one synchronous transaction with no `await` inside**. Commands therefore cannot interleave. Duplicate joins, double submits and two presenters pressing Release at once all become impossible races. That removes a whole class of bugs without advisory locks or `SELECT … FOR UPDATE`, which matters most on a 2-day timeline. Tests use `:memory:`, local dev needs no Docker, and there are no native builds.
  - *Trade-offs, accepted:* deploys on a disk-attached service have a short downtime, so we never deploy during class. There's no external SQL access, which export endpoints cover. Scaling is single-instance only, which is fine for a classroom.
  - *Fallback if `node:sqlite` misbehaves on Render:* swap in `better-sqlite3` (same SQL, same sync API) or move to Render Postgres with a global command queue.
- **Socket.IO instead of raw `ws`:** built-in reconnection with backoff, heartbeats, acks with timeouts (`emitWithAck`), rooms, namespaces and **HTTP long-polling fallback** for restrictive campus networks. A Node client exists for the simulation.
- **Vite + React SPA instead of Next.js:** the app is 100% client-interactive (a timed game, animation, sockets). SSR and SEO add nothing here and would add hydration and deploy complexity. It also matches the user's existing projects.
- **Rejected:** Supabase (pauses after inactivity on free, adds RLS/RPC complexity, and isn't Render) and Convex (excellent fit technically, but not Render and adds a second platform).

### Concurrency and consistency model
- Each socket event handler runs: zod-validate → `tx(() => { reads + guards + writes })` (sync) → build view(s) → `ack` → emit to rooms → debounced host push.
- DB `UNIQUE` constraints act as a backstop: one participant per token, one attempt per participant, one rating per phase, one assignment per participant.
- Views are **full snapshots** (small JSON), never deltas. Each participant row has a monotonic `rev`, and clients drop stale snapshots.

---

## 4. Participant flow and state machine

### Server-authoritative stages (tutorial is client-only, which removes two stages and two failure points)

| Stage | Screens shown (client sub-steps in order) | Entered by | Exits via | Server guard |
|---|---|---|---|---|
| `joined` | Identity + notice → Tutorial (1 practice, 1 retry) → "Ready?" | `join` (new token) | `start` | room exists; new joins are blocked if `closed` |
| `playing` | Game (12 rounds, runs offline) | `start` | `finish` | attempt exists, `status=playing` |
| `scored` | Result → Rating #1 | `finish` | `rate(before)` | attempt complete |
| `rated_before` | Calibrating (waiting) | `rate(before)` | assignment (release, late or instant) | — |
| `assigned` | Calibrating until `revealAt` → Recap | assignment | `seen` | client waits for server-time `revealAt` |
| `recap_seen` | Rating #2 | `seen` | `rate(after)` | — |
| `done` | Done ("look at the main screen") | `rate(after)` | — (Part 3 hook) | — |

- **Idempotency rule for every command:** if the participant is already at or past the command's target stage, return the current view with `ok: true` and write nothing.
- `rate(after)` arriving while still `assigned` (a lost `seen`) is accepted. It sets `recap_seen_at = now` and flags `implicit_seen`.
- Removed participants (`removed_at`) see a neutral "You're all set" screen and are excluded from pools and summaries.

### Session phases
- `open`: joins are allowed and waiting players are held.
- `released`: the batch has been assigned. Late finishers are assigned immediately with a ~3 s calibrating beat.
- `closed`: no new joins. Existing tokens can still resume and finish.
- Part 2 will add presenter/reveal state *alongside* `phase`; it won't reuse `phase` itself.

### Session config (frozen at creation, stored in `config_json`)
`{ gameVersion: "signal-shift@1", studyScale: 1.0, peers: 3, countdownMs: 3500, ghostPolicy: "fill" | "off", assignMode: "release" | "instant" }`

- `studyScale` lets the presenters tune difficulty after rehearsal without a code change. `>1` means longer study time, which is easier.
- `assignMode: "instant"` (P1) means no waiting at all: assignment happens on rating #1. Use it if the class choreography needs it.

---

## 5. Data model (SQLite, `PRAGMA user_version` migrations applied at boot)

```sql
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,            -- 4 chars from 23456789ABCDEFGHJKMNPQRSTUVWXYZ
  label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL CHECK (mode IN ('live','test')),
  phase TEXT NOT NULL DEFAULT 'open' CHECK (phase IN ('open','released','closed')),
  config_json TEXT NOT NULL, seed TEXT NOT NULL,             -- seed drives assignment RNG (reproducible)
  release_json TEXT,                                         -- frozen thresholds, counts, algo version
  created_at INTEGER NOT NULL, released_at INTEGER, reveal_at INTEGER, closed_at INTEGER
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('human','bot','ghost')), -- bot only in test sessions; ghost = synthetic peer
  token_hash TEXT,                                           -- sha256(token); NULL for ghosts/server bots
  codename TEXT NOT NULL, sigil_json TEXT NOT NULL,
  stage TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL, started_at INTEGER, scored_at INTEGER, rated_before_at INTEGER,
  assigned_at INTEGER, recap_seen_at INTEGER, done_at INTEGER, last_seen_at INTEGER, removed_at INTEGER,
  flags_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (session_id, codename)
);
CREATE UNIQUE INDEX participants_token ON participants(session_id, token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX participants_stage ON participants(session_id, stage);

CREATE TABLE attempts (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL, game_version TEXT NOT NULL, seed TEXT NOT NULL, study_scale REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('playing','complete')),
  started_at INTEGER NOT NULL, completed_at INTEGER, score INTEGER,
  stats_json TEXT,   -- hits, misses, timeouts, avgLockMs, medianLockMs, fastestMs, bestStreak, interruptions, practice
  flags_json TEXT NOT NULL DEFAULT '[]'   -- too_fast | too_quick | interrupted | restarted  → excluded from real pool
);

CREATE TABLE rounds (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, variant INTEGER NOT NULL, target INTEGER NOT NULL,
  tapped INTEGER, correct INTEGER NOT NULL, rt_ms INTEGER, study_ms INTEGER, mask_ms INTEGER,
  PRIMARY KEY (participant_id, idx)
);

CREATE TABLE ratings (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('before','after')),
  value REAL NOT NULL CHECK (value >= 0 AND value <= 100),   -- 0.1 precision
  response_ms INTEGER, adjustments INTEGER, created_at INTEGER NOT NULL,
  PRIMARY KEY (participant_id, phase)
);

CREATE TABLE assignments (                                   -- SERVER-ONLY. Never serialized to participants.
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('up','neutral','down')),
  batch TEXT NOT NULL CHECK (batch IN ('release','late','instant')),
  stratum INTEGER,                                           -- triplet id at release (matched-score reveal)
  viewer_score INTEGER NOT NULL, thresholds_json TEXT NOT NULL, algo_version TEXT NOT NULL,
  assigned_at INTEGER NOT NULL, reveal_at INTEGER NOT NULL, dial_dwell_ms INTEGER
);

CREATE TABLE shown_peers (                                   -- exactly what each viewer saw, in reveal order
  viewer_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  peer_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  peer_kind TEXT NOT NULL, peer_score INTEGER NOT NULL, diff INTEGER NOT NULL,
  PRIMARY KEY (viewer_id, slot)
);
CREATE INDEX shown_peers_peer ON shown_peers(peer_id);

CREATE TABLE events (                                        -- append-only debug log (joins, reconnects, errors)
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, participant_id TEXT,
  type TEXT NOT NULL, at INTEGER NOT NULL, data_json TEXT
);
```

- **rating_delta** is derived as `after.value − before.value`. It is computed in export and host queries, never stored twice.
- **Ghosts** are `participants(kind='ghost', stage='ghost')` plus an `attempts` row holding their score. That gives one uniform peer reference and one consistent identity and score across every phone they appear on. Ghosts are never counted as players.
- **Reset session** deletes that session's participants, which cascades to everything else, and returns the session to `open`.

---

## 6. Realtime protocol, reconnect and clock

### Participant namespace `/p`: client → server (all via `socket.timeout(5000).emitWithAck`)

| Event | Payload (zod-validated) | Response | Idempotency |
|---|---|---|---|
| `join` | `{ code, token }` (token = 43-char base64url) | `{ ok, view }` or `{ ok:false, reason:'NO_ROOM'|'CLOSED' }` | same token → same participant (unique index) |
| `start` | `{ practice: { tries, correct } }` | `{ ok, view }` (view.game has seed) | returns the existing attempt |
| `finish` | `{ rounds: RoundSubmission[12], interruptions }` | `{ ok, view }` (view.result) | a complete attempt returns the stored result |
| `rate` | `{ phase:'before'|'after', value, responseMs, adjustments }` | `{ ok, view }` | first write wins |
| `seen` | `{ dialDwellMs }` | `{ ok, view }` | set once |
| `clock` | `{}` | `{ serverNow }` | — |

`RoundSubmission = { idx, variant, tapped: number|null, rtMs: number|null, studyMs, maskMs }`. The client never sends correctness or a score.

- Server → client: `view` (a full `ParticipantView` snapshot) after every change to that participant. It goes to room `p:<participantId>`, so multiple tabs stay in sync.

```ts
type ParticipantView = {
  rev: number; serverNow: number;
  room: { code: string; open: boolean };
  me: { codename: string; sigil: Sigil; stage: Stage };
  game?:   { version: string; seed: string; studyScale: number };                 // stage >= joined (preload)
  result?: { score: number; avgLockMs: number|null; bestStreak: number; fastestMs: number|null }; // >= scored
  recap?:  { revealAt: number; dialSpan: number;
             others: { codename: string; sigil: Sigil; score: number }[] };        // >= assigned, reveal order
};
```
**Never present:** condition, peer kind, diff, stratum, thresholds, ghost flags, or other players' ids.

### Host namespace `/h` (handshake `auth: { key }`, constant-time compare to `ADMIN_KEY`)
`sessions`, `create {label, mode, config?}`, `watch {sessionId}` → debounced (250 ms) `hostView` pushes, `release {sessionId}`, `close`/`reopen`, `reset {sessionId, confirm:'RESET'}`, `remove {participantId}`, `bots.spawn {sessionId, n, mean, sd}` and `bots.advance {sessionId, to}` (**test sessions only, enforced server-side**). HTTP: `GET /api/export/:sessionId?format=json|csv` with the `x-admin-key` header. The host UI downloads it via fetch → Blob.

### Reconnect strategy
1. The code comes from the path `/:code`. With no code, the Join screen asks for it.
2. `token = localStorage['ss.t.'+code]`, or else 32 random bytes from `crypto.getRandomValues` (which works on insecure LAN dev too) are generated and stored. The fallbacks are sessionStorage, then memory.
3. `io('/p', { transports: ['websocket','polling'], reconnectionDelayMax: 5000 })`. On every `connect`, the client emits `join` and renders the returned view.
4. A client **outbox** queues commands, retries after reconnect (max 5 attempts, backoff), and is safe because every command is idempotent.
5. Mid-game refresh: finished rounds live in `localStorage['ss.g.'+seed]`. On resume the game continues at the next round. An interrupted round replays as `variant+1`, which is equivalent in difficulty but a different screen. **Cap: 2 replays.** A third interruption scores the round as a timeout, and `interrupted` is flagged. If storage is lost, the game restarts at round 1 with variants +10 and is flagged `restarted`.
6. A disconnect shows a small non-blocking "Reconnecting…" pill. The game never needs the network until `finish`.

### Clock sync (P1)
On connect the client takes 3 `clock` pings, keeps the lowest-RTT sample, and computes `offset = serverNow + rtt/2 − Date.now()`. The countdown to `revealAt` then synchronizes to about ±100 ms. Without it (P0 fallback), the client uses `view.serverNow` as a coarse offset.

---

## 7. The game: "Signal Shift" (precise mechanics)

### Round timeline (scored rounds)

| Phase | Duration | What's on screen |
|---|---|---|
| cue | 400 ms | empty grid "sockets", center pulse |
| study | `spec.study × studyScale` | glyphs (array A) |
| mask | 400 ms | **every** cell shows a static-noise tile, luminance-matched (kills the change transient and location cues) |
| test | until tap, max 5000 ms | array B (exactly one cell changed) |
| feedback | 550 ms | hit: tapped cell "locks" (paper ring + accent flash). Miss: tapped cell dims and the true cell gets a dashed ring. Timeout: dashed ring + "Missed" |
| gap | 250 ms | — |

- Tier interstitials after rounds 3 and 8 (700 ms): "4 × 4", "5 × 5". Before round 1: "3 · 2 · 1" (1.5 s).
- **Sparse grids** (items < cells) keep 4×4 and 5×5 skill-based. With full 25-item grids and memory capacity around 3–4 items, accuracy collapses to near guessing.

### Round schedule (constants in `src/shared/game/specs.ts`, version `signal-shift@1`)

| # | Grid | Items | Study (ms) | Change | Target zone | Weight | Speed window (fast→slow ms) |
|---|---|---|---|---|---|---|---|
| 1 | 3×3 | 5 | 1400 | color | edge | 1.00 | 600 → 2600 |
| 2 | 3×3 | 5 | 1400 | shape | corner | 1.00 | 600 → 2600 |
| 3 | 3×3 | 5 | 1300 | rotate | edge | 1.00 | 600 → 2600 |
| 4 | 4×4 | 7 | 1400 | color | inner | 1.25 | 700 → 3000 |
| 5 | 4×4 | 7 | 1300 | shape | edge | 1.25 | 700 → 3000 |
| 6 | 4×4 | 7 | 1300 | rotate | corner | 1.25 | 700 → 3000 |
| 7 | 4×4 | 7 | 1200 | color | edge | 1.25 | 700 → 3000 |
| 8 | 4×4 | 7 | 1200 | shape | inner | 1.25 | 700 → 3000 |
| 9 | 5×5 | 9 | 1400 | color | inner | 1.50 | 800 → 3400 |
| 10 | 5×5 | 9 | 1300 | rotate | edge | 1.50 | 800 → 3400 |
| 11 | 5×5 | 9 | 1300 | shape | corner | 1.50 | 800 → 3400 |
| 12 | 5×5 | 9 | 1200 | color | inner | 1.50 | 800 → 3400 |

- Expected accuracy is ~85% on 3×3, ~65% on 4×4 and ~50% on 5×5, averaging about 60–65%. This is **tuned at rehearsal via `studyScale`**.
- A typical round lasts ~4.5 s, so the 12 rounds take ~55 s. With the tutorial (~12 s) and intro, total play is about **70 s**.

### Stimuli
- **Shapes (6):** symmetric `circle`, `square`, `ring`, `plus`; oriented `triangle`, `halfdisc` (rotations 0/90/180/270).
- **Colors (5), picked for lightness spread:** sun (~#FFD23F), paper (~#F4F1EA), sky (~#38BDF8), rose (~#FF5C8A), cobalt (~#3B5BDB).
- **Color-change pairs must differ by CIELAB ΔL\* ≥ 20.** A change is then visible to every type of color-vision deficiency, because it's a lightness change and not just a hue change. A unit test asserts this, and the palette is checked manually once in Chrome DevTools → Rendering → "Emulate vision deficiencies".
- Glyphs are inline SVG (viewBox 100×100) rendered on a dark board. There are no SVG filters per glyph.

### Deterministic generation (shared by client and server)
- PRNG: `sfc32`, seeded by `cyrb128("<attemptSeed>:<idx>:<variant>")`. It uses 32-bit integer math only, so it's bit-identical across JS engines.
- **Algorithm per spec:**
  1. Choose the target cell uniformly within its zone (corner/edge/inner of the grid).
  2. Choose `items − 1` other cells uniformly, rejecting any layout where a row or column has more than `ceil(items/grid) + 1` items.
  3. Assign shape, color and rotation per cell. There must be no identical glyph in the 4-neighborhood, at least `min(items, 4)` distinct colors, and at least 3 distinct shapes.
  4. Apply the change to the target:
     - `color`: pick a color from the allowed ΔL\* pairs that isn't used by its neighbors.
     - `shape`: pick a different shape that doesn't duplicate a neighbor.
     - `rotate`: force the target to be oriented *before* the change, then rotate ±90°.
  5. Output `{ grid, A: (Glyph|null)[], B: (Glyph|null)[], target }`.
- **Equivalence across participants:** everyone plays the same spec sequence. Only positions and feature values differ, within identical constraints. Neighbors see different screens ("Everyone's game is a little different").
- The server regenerates `target` from `(seed, idx, variant)` to compute correctness.

### Input (robust to accidental taps)
- Pointer Events on the board, primary pointer only. Taps are **only accepted in the `test` phase**, and only if the pointerdown timestamp is later than the test onset (a finger already resting on the screen doesn't count).
- **Press-then-release commit:** RT is taken at `pointerdown`. The tap commits on `pointerup` inside the same cell with less than 12 px of movement. Sliding off cancels it.
- Board CSS: `touch-action: none; user-select: none; -webkit-touch-callout: none;`. The global `overscroll-behavior: none` blocks pull-to-refresh, and `touch-action: manipulation` elsewhere disables double-tap zoom.
- Cell size: a 5×5 board on a 360 px-wide phone gives about 64 px cells (58 px targets), above the 48 px minimum. The board sits slightly below center, in the thumb zone.

### Timing implementation
- A `GameRunner` (plain TS, no React state during timed phases) drives the phases with `requestAnimationFrame`. It switches phase on frame boundaries by setting a single `data-phase` attribute on the board.
- All three layers (A, mask, B) are pre-rendered during `cue`, so a phase switch is one attribute change and no DOM creation.
- Onset = the rAF timestamp of the frame that applied `test`. RT = `pointerdown.timeStamp − onset`. Both use the same `performance` clock and are accurate to about 1 frame, which is irrelevant for scoring (see §8).
- Measured study and mask durations are recorded per round for data quality.
- `visibilitychange` → hidden during cue, study, mask or test voids the round. A "Paused — tap to resume" overlay appears, and the round replays as `variant+1`, within the replay cap.

### Micro-tutorial (client-only)
- One practice round: 3×3, 4 items, 2000 ms study, 500 ms mask, a color change and no timeout.
- Coach captions change with the phase: "Memorize the grid." → "Blink." → "Tap the one that changed."
- A miss shows "It was this one. One more." and allows 1 retry with a new variant.
- Then "12 rounds. It gets harder. Ready?" → **Go**. `{tries, correct}` is sent with `start`.

---

## 8. Scoring (server-computed, shared module)

```
For scored round i (1..12) with spec weight w_i and speed window [fast_i, slow_i]:
  hit_i   = (tapped_i == target_i)                    // server-computed from the seed
  speed_i = hit_i ? clamp((slow_i − rt_i) / (slow_i − fast_i), 0, 1) : 0
  pts_i   = w_i · hit_i · (0.80 + 0.20 · speed_i)
raw   = Σ pts_i / Σ w_i                               ∈ [0, 1]
score = round(200 + 800 · raw)                        ∈ [200, 1000], displayed with NO denominator
```

### Why this beats a plain 80/20 blend
1. **Speed only counts on hits.** Fast guessing earns nothing, so there's no incentive to tap randomly.
2. **Saturating, wide speed windows.** Anything faster than `fast` gets full credit, which removes any reason for anticipatory taps and any need for an RT floor. The windows are ~2–2.6 s wide, which makes device and touch-latency differences negligible. Worst case for a +50 ms device offset: Δspeed ≤ 0.025 per hit → Δscore ≤ 800·0.2·0.025 = **4 points**. The smallest comparison gap is ≥45 points.
3. **Difficulty weights (1.0 / 1.25 / 1.5)** reward the hard rounds, spread the top of the distribution, and make the score non-transparent: students can't back-compute "9/12 → 742".
4. **Scale floor at 200.** An all-miss run scores 200 and a perfect, fast run scores 1000. A typical run (~62% weighted hits, medium speed) lands around **650–700**. That is mid-scale and ambiguous, which avoids floor and ceiling effects on the self-ratings. With no "/1000" shown, there's no objective anchor, which is exactly Festinger's condition for social comparison to kick in.
5. **Displayed stats are non-anchoring.** Avg lock time (mean RT on hits), best streak and fastest lock are shown. Hits, misses and timeouts are stored but never displayed.

### Plausibility flags
These exclude an attempt from the real peer pool only. The student's own experience is unchanged.
- `too_fast`: median hit RT < 250 ms.
- `too_quick`: less than 25 s of server time between `start` and `finish` (the physical minimum is ~35 s).
- `interrupted`: more than 2 replays.
- `restarted`: storage was lost and the game restarted.

---

## 9. Hidden comparison assignment

### Pools
- **Real pool:** participants with `kind ∈ {human, bot}` (bots exist only in test sessions), a complete attempt, no flags, and not removed. That includes players who haven't rated yet, since their score is already final.
- **Ghost pool:** the session's existing ghosts, reused before any new ghost is created.
- **Viewers:** stage `rated_before` with no assignment yet.

### Thresholds (computed from real scores and frozen into `sessions.release_json` at release)
```
robustSD      = n ≥ 8 ? IQR/1.349 : 110;  clamp to [60, 200]
gapMin        = round(clamp(0.6·robustSD, 45, 120))        // every up/down peer is at least this far away
gapMax        = round(gapMin + 1.6·robustSD)
neutralWindow = round(min(clamp(0.3·robustSD, 20, 45), gapMin − 15))   // neutral is always strictly closer than up/down
targetGap     = gapMin + 0.6·robustSD;  sigma = 0.5·robustSD
dialSpan      = round(clamp(5·robustSD, 360, 640))          // fixed dial scale, so visual distance ∝ points
ghostBounds   = [260, 985]                                  // plausible displayed scores
k             = config.peers (3)
```
Example at ~25 players (robustSD ≈ 120): gapMin 72, gapMax 264, neutral ±36, so "up" peers sit roughly +72…+264 above the viewer (preferring about +144).

### Feasibility per viewer (score s)
- **up:** at least k real candidates in the band, OR (`ghostPolicy = fill` AND `s + gapMin ≤ 985`).
- **down:** at least k real candidates in the band, OR (`fill` AND `s − gapMin ≥ 260`).
- **neutral:** at least k real candidates within ±window, OR `fill`. This is always feasible with `fill`.
- With `ghostPolicy = off`, a viewer with no feasible condition gets `neutral` with the closest available real peers, flagged `degraded`. This never happens with `fill`, which is the class default.

### Batch assignment at Release: score-matched triplets (stratified constrained randomization)
1. Sort viewers by score, breaking ties with a seeded random key, and chunk them into consecutive triplets. These are the **strata**; the last one may hold 1–2 viewers.
2. For each full stratum, list the permutations of (up, neutral, down) where every member's condition is feasible. If none exist, allow repeats.
3. Process the most-constrained strata first, typically the top and bottom scorers. Within each, pick uniformly at random among the options that minimize global imbalance. Top strata lack "up" and bottom strata lack "down", so they naturally cancel out.
4. Leftover viewers get the least-represented feasible condition, with random ties.
5. Store `stratum` on every assignment. This enables Part 2's "three of you scored 741/742/745, saw different players, and moved −12/+1/+9" reveal.

### Peer selection (real-first), processed in seeded random viewer order
- **Bands:**
  - up = `[s+gapMin, min(s+gapMax, 985)]`
  - down = `[max(s−gapMax, 260), s−gapMin]`
  - neutral = `[s−win, s+win] ∩ [260, 985]`
- Real candidates are the real pool inside the band, excluding the viewer. Choose k by weighted sampling without replacement:
  `w(q) = exp(−(|diff|−target)²/(2σ²)) / (1+exposure[q])²`. For neutral, target = 0 and σ = window/2. The exposure term spreads appearances so one star player isn't in everyone's recap.
- **Neutral balance:** if both picked candidates so far fall on the same side and a real candidate exists on the other side, force the third pick from the other side.
- **Fill:** if fewer than k real candidates exist, first reuse existing ghosts in the band (lowest exposure first), then create new ghosts. A new ghost gets a score sampled around the target inside the band, distinct from the other chosen scores, plus a unique codename and sigil not used by anyone in the session.
- Slots are ordered by |diff| ascending, which is the reveal order on the dial.
- **Everything is persisted:** `assignments` (condition, batch, stratum, thresholds, algo version, revealAt) and `shown_peers` (peer id, kind, score, diff, slot).

### Late and instant assignment
This runs inside the `rate(before)` transaction when `phase = released` or `assignMode = instant`:
- Thresholds are the frozen release ones. In instant mode they're computed now and stored on the assignment.
- The condition is the feasible one with the lowest count **within the viewer's score tercile**, then the lowest global count, then random.
- Peers are chosen as above, and `revealAt = now + 3000` gives a consistent short calibrating beat.

### Determinism and purity
- `assignBatch()` and `assignOne()` are **pure functions**: inputs are viewers, pools, exposure counts, thresholds, an RNG and a ghost factory; outputs are assignments plus new ghost specs. Persistence happens afterward, in the same transaction.
- The RNG is seeded from `session.seed + ':release'` or `':late:' + participantId`, so the same data always produces the same assignment. That is reproducible and debuggable.

### Edge cases

| Case | Handling |
|---|---|
| Highest scorer | Never "up" from real data. With `fill`, "up" is possible via ghosts if `s + gapMin ≤ 985`. Otherwise the assignment balances between neutral and down. |
| Lowest scorer | Mirror of the highest scorer. |
| Ties | diff = 0 counts as a neutral candidate. Sorting breaks ties randomly. All-equal scores → neutral uses real players; up/down use ghosts. |
| Tiny class (1–8) | Ghost fill guarantees 3 valid peers each. The host console warns "small pool: many generated players". |
| Not enough neutral within window | Fill with ghosts inside ±window. The window never expands past `gapMin − 15`. |
| Late finisher | Assigned immediately against the full real pool with frozen thresholds. |
| Disconnect before release | Still assigned at release, and sees the recap on return. `recap_seen_at` marks actual exposure. |
| Refresh or rejoin | Same token → same assignment and same peers, never re-randomized. |
| Flagged, removed or test-bot players | Excluded from the real pool. Bots can't exist in live sessions. |
| Release pressed twice or concurrently | Synchronous transaction plus a `phase` guard: first wins, second is a no-op. |
| Released with few finishers | Allowed. Early viewers get more ghosts, and later ones get mostly real peers. The host sees counts first. |

---

## 10. Waiting, synchronization and release

- **Default choreography (`assignMode: release`):** play is self-paced. Players who finish rating #1 wait on **Calibrating**. The presenter watches the funnel and presses **Release** when about 90% are waiting (or at a planned moment).
- **Release** runs the batch transaction and sets `revealAt = now + countdownMs (3500)`. Every waiting phone gets its view at once and shows a synchronized **3 · 2 · 1 → lock flash → recap** (P1 countdown; the P0 fallback reveals as soon as the view arrives). Around 25 phones flipping together is the room-wide wow moment.
- Players still in the game at release are assigned the moment they submit rating #1 (late batch) and see a ~3 s calibrating beat, so their experience is identical in shape.
- The Calibrating screen always shows for at least ~3 s, even in instant mode or for late finishers, so the cover story ("calibrating your results") stays consistent.
- Screen Wake Lock (P1) is requested on Calibrating and Done, with feature detection and failures ignored.

---

## 11. Privacy, ethics and leak hygiene

### Privacy
- No accounts, names or emails. Anonymous codename + generative sigil.
- The token is stored hashed (SHA-256). No IPs or user agents are stored in app tables.
- Minimal logs.
- Data is exported after class and deleted when the course ends (host "Delete session").

### Notice
One line on the identity screen: *"No names, no accounts — you're VELVET MOTH. Anonymous results may appear on screens during class."* It's truthful, it covers peers' scores shown on other phones, and it doesn't hint at comparison.

### Low stakes
- No evaluative words anywhere: no "better/worse/average/rank/percentile/group".
- No class average and no distribution are ever shown to participants.
- The dial shows only 4 markers, with no "average" line.

### Ghost peers
- Flagged, consistent across phones, and plausible (260–985). Ghost codenames never collide with real ones.
- **Recommendation for Part 2's debrief:** add one honest line, e.g. "most 'other players' were real classmates — a few were generated so everyone had a set."
- Real-first keeps the stronger discussion message true for most students: *nothing you saw was fake — it was selected* (curated, not fabricated, like social media feeds).

### Leak hygiene (the class must not guess the purpose)
- Participant-facing names stay neutral: app title "Signal Shift", Render service `signal-shift` (URL `signal-shift*.onrender.com/<CODE>`), event names `join/start/finish/rate/seen/clock`, and payload key `others` (not `comparison`/`peers`).
- The host console is a **separate Vite HTML entry**. It is never referenced by participant pages, and every host event requires the key.
- Internal labels (`up/neutral/down`, `ghost`, `stratum`) exist only in server code and DB rows. Participant views are shape-tested to exclude them.
- **Automated bundle check (P1):** after `vite build`, scan the participant chunks for forbidden tokens (`upward`, `downward`, `reference group`, `social comparison`, `experiment`, `ghost`, `synthetic`, `fabricat`, `manipulat`, `stratum`, `control group`, `condition`) with an allowlist for third-party strings. The build fails on a match.
- The host console is **safe to project** by default: conditions, ghosts and summaries sit behind a "Show internals" toggle.
- No `console.log` in the production client. Error copy is neutral.
- **Cover story by design:** the perception-instrument aesthetic ("signal", "calibrating", "lock time") points students toward "this is an attention/perception test". That decoy protects the real manipulation, which looks like incidental analytics.

---

## 12. Visual design direction: "Night Broadcast"

The concept is a late-night broadcast studio crossed with an editorial poster, with a precise instrument feel. Students feel they're tuning a signal, not taking a test. The look is dark, confident and typographic, with one hot accent, no cards and no pills.

### Tokens
- Ink `#0B0C10` / ink-2 `#14161D`, hairline `rgba(244,241,234,.12)`, paper `#F4F1EA`, mute `#8F93A3`.
- **Signal vermilion `#FF4F1F`** is the single accent, reserved for the one most important element per screen (primary bar, needle, lock ring). Phosphor `#C8FF3D` appears only for rare micro-highlights.
- The stimulus palette is separate (§7).
- A fine static-grain overlay at ~5% opacity (static PNG, not animated).

### Type (self-hosted via @fontsource-variable, Latin subset, preloaded)
- **Anybody** (variable width 50–150) for display and numerals. Headlines use wide cuts (wdth ~120). Numerals start condensed and *stretch* as they lock in, which is the signature motion.
- **Instrument Sans** for UI text.
- **JetBrains Mono** for micro-labels: uppercase, tracked, e.g. `SIGNAL SCORE`, `ROUND 07/12`, `ROOM K7QX`.

### Motifs
- **Lissajous sigils** (unique per player, animated stroke tracing).
- Tick-mark rails at the screen edges, like an instrument bezel.
- Static noise (mask, transitions, calibrating).
- A tuning-dial scale.
- Primary actions are **full-width bottom bars**: 64 px tall, square corners, a 1 px inner hairline and an arrow glyph. The pressed state inverts.

### Per-screen design
1. **Join:** a huge two-line wordmark `SIGNAL / SHIFT` and 4 segmented code boxes (auto-uppercase). The bar reads **Tune in →**. With a QR deep link, the code is prefilled and this step is skipped.
2. **Identity:** the static field resolves (~700 ms). The player's sigil traces itself (1.2 s), then `YOU'RE ON AIR AS` (mono) above the codename in wide display type, then the one-line notice, then **Start →**.
3. **Tutorial and Ready:** the board with big 2–4 word captions synced to the phase, a `PRACTICE` label, and "12 rounds. It gets harder. Ready?" → **Go**.
4. **Game:** a 12-tick progress rail at the top (neutral: it fills without encoding hit or miss), a mono phase label (`MEMORIZE` / `—` / `WHAT CHANGED?`), and the board. Nothing else: no running score.
5. **Result:** the mono label `SIGNAL SCORE`. The number **assembles odometer-style**: each digit spins, then locks left→right with a width-stretch settle. Below it sit 3 stat columns (avg lock 1.24s · best streak 5 · fastest 0.71s), then **Continue**.
6. **Rating #1 and #2 (identical):** the question in display type at the top, the score small in the corner ("742"), a **vertical fader** filling ~60% of the height, and **Lock it in** (see the spec below).
7. **Calibrating:** the player's sigil centered and **slowly morphing** (animated Lissajous phase: one 200-point SVG path), a thin static ring, and a cycling status line ("Syncing timing data" → "Mapping your run" → "Building your recap"). On release: big 3·2·1 → lock flash.
8. **Recap:** see below.
9. **Done:** the sigil idles (slow morph), "You're done." in big type, then "Keep this page open and look at the main screen." with a tiny room code.

### Recap ("tuning in"): the hero moment
- **Frame A: `YOUR RUN` (P1, ~3.5 s, tap to skip).** The 3 personal stats appear one after another as huge numerals over a *decorative* oscilloscope trace. The trace is derived from the run but can't be decoded per round, so it never reveals the hit count. This frames the recap as "personal analytics".
- **Frame B: `ALSO ON THE DIAL` (P0).**
  - A horizontal tuner band spans the width at about 45% of the height. Minor ticks mark every 10 points and major ticks every 50, with small mono labels.
  - The window is a **fixed span `dialSpan` centered on the viewer**, so visual distance is proportional to point difference and identical across players. Neutral peers appear close; up and down peers appear clearly off to one side.
  - Sequence:
    - 0.0 s: the band draws in.
    - 0.6 s: the viewer's vermilion needle drops, with the sigil above and "YOU · 742" below.
    - 1.2 s: a scan line sweeps with a static flicker, and **station 1 locks**: its marker blooms, its sigil draws, and its codename and score count up.
    - 2.4 s: station 2. 3.6 s: station 3 (nearest first).
    - At ≥5.5 s: **Continue** fades in (minimum dwell). The dwell time is recorded.
  - Stations beyond the window pin to the edge with a chevron.
  - Below the band, the 3 others are listed in reveal order: sigil · codename · score.
- **Frame C: `YOUR SIGNAL` (P1).** A full-bleed poster composition (not a card): sigil, codename, big score, 3 stats and a mini-dial with the 4 markers. **Continue** → Rating #2.
- If P1 is cut, the recap is Frame B alone, with the stats in its header.
- No labels such as "better players" or "comparison". The copy stays truthful and neutral ("Also on the dial").

### Rating component: vertical-fader visual analog scale
- The track is ~60vh tall with a 120 px-wide hit area. The top label reads "Extremely well" and the bottom "Not well at all" (mono small caps). A subtle midpoint tick has no label.
- **No default thumb.** The thumb appears where the student first touches, and dragging adjusts it. The track fills bottom→thumb as feedback. **No numeric readout**, which reduces anchoring to the first answer and makes it harder to remember precisely.
- Value = `(1 − y/h)·100`, rounded to 0.1. **Lock it in** enables after the first touch. The component records `responseMs` (mount → confirm) and `adjustments` (drag count).
- Accessibility: `role="slider"`, aria-valuemin/max/now/valuetext, Arrow keys ±1, PageUp/PageDown ±10, Home/End.
- Rating #2 is the **same component, wording and layout**, and starts empty. It's never prefilled with rating #1.

### Avoid
Rounded white cards, gray-bordered panels, shadcn defaults, pill buttons everywhere, gradients-as-decoration, emoji, excess text, and anything that looks like a quiz or survey.

---

## 13. Motion, performance and accessibility

- **Motion library:** `motion` (React) for AnimatePresence stage transitions, springs, and the staged recap and score sequences. It is used via `LazyMotion` and `m` to keep the bundle small. The game's timed phases **never** go through React or motion; they're driven by rAF and attribute toggles.
- **Signature transition:** a "tune" effect between major stages (12 px horizontal slide + 120 ms low-contrast static flash). It's used sparingly: join→identity, game→result, calibrating→recap.
- **Reduced motion** (`prefers-reduced-motion` + `useReducedMotion`):
  - Cross-fades only; no slide or static flashes.
  - Sigils render fully drawn, with no tracing or morph.
  - Scores fade in with no odometer.
  - Dial stations fade in with the **same dwell timing**, so the measure is unchanged.
  - The countdown uses fading numerals.
  - Game timing is identical.
- **Photosensitivity:** the mask is a static, luminance-matched pattern that doesn't animate. There are no full-screen white flashes and at most 3 luminance transitions per second (WCAG 2.3.1).
- **Performance budget:**
  - Participant JS under ~200 KB gzip; fonts ~80 KB; first load on 4G under ~2.5 s.
  - Only `transform` and `opacity` are animated; no `backdrop-filter`; canvas DPR is capped at 2.
  - `data-quality="low"` is set automatically if average frame time during the identity animation exceeds 24 ms. It disables grain, glows and noise animation.
- **Mobile ergonomics:**
  - `100dvh` layouts, `viewport-fit=cover` with safe-area insets, portrait-first (landscape scales the board to fit).
  - The primary action sits in the thumb zone.
  - Minimum 48 px touch targets.
  - `theme-color` set to ink.
- **Color accessibility:** color changes are lightness-distinct (ΔL\* ≥ 20). Feedback never relies on color alone (ring, dashed ring, dim state).

---

## 14. Minimal host console (functional, not the Part 2 dashboard)

`/host` (separate entry). It's dark and plain, but usable on a laptop or phone.

- **Login:** ADMIN_KEY, stored in the host device's localStorage.
- **Sessions:** a list (code, label, mode, phase, player count) and **New session** (label, mode `live|test`, advanced config: studyScale, countdownMs, assignMode, ghostPolicy).
- **Session panel:**
  - Code, join URL, **QR** (fullscreen overlay, safe to project, plus a "Download PNG" button for slides).
  - **Funnel:** joined · playing · scored · waiting · assigned · recap seen · done · connected now.
  - **Release** button showing a live readiness line ("18 of 21 finished players are waiting"), a confirm dialog and the countdown. Once released: "Late finishers are assigned automatically."
  - **Close room / Reopen**, **Export JSON / CSV**, **Reset session** (typed `RESET`), **Delete session**, **Remove participant**.
  - **"Show internals" toggle (off by default):**
    - A per-condition summary with n, mean score, mean rating #1, mean rating #2, mean Δ and n done. This is the **fallback reveal** if Part 2 slips.
    - Ghost count and ghost vs real exposures.
    - Frozen thresholds.
    - The participants table: codename, kind, stage, score, r1, r2, Δ, condition, stratum, the 3 peers (score/kind) and flags.
- **Test-session tools** (the server refuses them on live sessions):
  - **Spawn N bots** (normal distribution, mean/sd, clipped 260–985).
  - **Bots → rated_before** (rating ≈ f(score) + noise).
  - **Bots → done** (rating #2 = rating #1 + synthetic effect by condition + noise, *only for pipeline testing*).
  - **Remove bots**.

---

## 15. Project structure and routes

```
Communications/
  package.json  .node-version(24)  tsconfig.json  tsconfig.shared.json  vite.config.ts
  vitest.config.ts  playwright.config.ts  render.yaml  .gitignore  AGENTS.md (created at build start)
  index.html            # participant entry  (title "Signal Shift")
  host.html             # host entry
  public/               # favicon, noise.png, neutral og image
  src/shared/           # pure TS, no DOM/Node APIs (enforced by tsconfig.shared lib: ES2022 only)
    rng.ts  flow.ts  protocol.ts(zod + types)  time.ts
    game/{specs.ts, types.ts, generate.ts, scoring.ts, palette.ts}
    identity/{codenames.ts, sigil.ts}
  src/server/
    index.ts(boot, graceful SIGTERM)  http.ts(fastify static + SPA fallback + /healthz + /api/export)
    sockets/{participant.ts, host.ts, rateLimit.ts}
    db/{schema.sql, db.ts(node:sqlite, tx(), migrations), repo.ts}
    services/{join.ts, game.ts, rating.ts, release.ts, host.ts, bots.ts, exporter.ts}
    assign/{thresholds.ts, assign.ts(pure), ghosts.ts}
    views.ts  auth.ts  config.ts
  src/client/
    main.tsx  App.tsx(stage router)  storage.ts
    net/{connection.ts(socket, outbox, clock), useView.ts}
    screens/{Join, Identity, Tutorial, Ready, Game, Result, Rating, Calibrating, Recap, Done, Problem}.tsx
    game/{runner.ts, Board.tsx, Glyph.tsx, input.ts}
    recap/{Dial.tsx, RunFrame.tsx, SignalFrame.tsx, ScoreLockIn.tsx}
    ui/{Sigil.tsx, Fader.tsx, BarButton.tsx, Static.tsx, StageTransition.tsx, ReconnectPill.tsx}
    styles/{tokens.css, global.css}  *.module.css
  src/host/  main.tsx HostApp.tsx Login.tsx Sessions.tsx SessionPanel.tsx QrOverlay.tsx Internals.tsx host.css
  tests/  unit/ (or colocated *.test.ts)  integration/  e2e/  sim/sim.ts  bundle/forbidden-words.test.ts
```

- **Routes:**
  - `/` is the join screen with code entry; `/:code` (4 chars) is a deep link.
  - `/host` serves host.html; `/healthz` returns 200 only if `SELECT 1` succeeds.
  - `/api/export/:id`.
  - Socket.IO at `/socket.io`, namespaces `/p` and `/h`.
- **Scripts:**
  - `dev`: Vite on 5173, proxying `/socket.io` and `/api` → 3000, plus `tsx watch` server on 3000 with `.data/dev.db`. `vite --host` exposes it for phones on the LAN.
  - `build`: `vite build` followed by an esbuild server bundle (`--platform=node --format=esm --packages=external`).
  - `start` (runs migrations at boot); `test` (vitest unit + integration); `test:e2e`; `sim`; `typecheck`; `check:bundle`.
- **Server hardening:**
  - Socket.IO `maxHttpBufferSize` 32 KB and a per-socket token bucket (20 events/s).
  - Same-origin only (no CORS). Headers: `nosniff`, `Referrer-Policy: no-referrer`.
  - Constant-time key compare.
- **Known gotcha:** Vitest/Vite resolving the prefix-only builtin `node:sqlite`. Mark it external (`server.deps`/`ssr.external`) if needed.

---

## 16. Testing strategy (the live demo must not fail)

### Unit tests (Vitest, P0)
**`scoring`**
- All hits ≤ fast → 1000. All misses → 200. All hits ≥ slow → 840.
- A fast miss earns 0.
- Properties: more hits never lower the score; lower RT never lowers it; a ±50 ms shift moves it ≤ 4 points.
- Stats: zero hits → null avg and fastest; streak edge cases.

**`generate`** (property tests with fast-check over thousands of seeds per spec)
- Exactly one cell differs between A and B, and the target sits in its zone.
- Item count, change type and the ΔL\* ≥ 20 rule for color pairs hold.
- Rotations apply only to oriented shapes and are visibly different.
- No identical 4-neighbors, and heterogeneity minimums are met.
- Determinism, plus a golden snapshot for 3 fixed seeds.

**`thresholds`**
- Small-n fallback and clamps.
- neutralWindow < gapMin always holds.

**`assign`** (fast-check over random score distributions with n = 1…60)
- Every viewer gets k distinct peers, and never themselves.
- Every peer lies in its condition's band, and ghosts only appear when real in-band candidates < k.
- Ghost scores stay in [260, 985], and ghost identities are unique and reused consistently.
- Condition counts differ by ≤ 1 when n ≡ 0 (mod 3) and all conditions are feasible.
- For n ≥ 24, per-condition mean score differences stay ≤ 0.35·robustSD (score matching works).
- Deterministic per seed.
- Named edge cases: highest and lowest scorer under `off` and `fill`, all-tied scores, n = 1/2/3/5, a bimodal distribution, late assignment balancing within the tercile using frozen thresholds, and exposure (no peer shown to more than ~6 viewers at n = 25).

**`flow`**
- Allowed and forbidden transitions; repeated commands are idempotent.

### Integration tests (Vitest, in-memory SQLite, real Fastify + Socket.IO on an ephemeral port with `socket.io-client`, P0)
- **Join:**
  - The same token sent twice, including concurrently, yields one participant.
  - A new token gets a distinct codename.
  - An unknown room returns `NO_ROOM`.
  - A closed room rejects new tokens, but an existing token still resumes.
- `start` ×2 yields one attempt with the same seed.
- `finish` ×2, including concurrently, yields one score. Tampered payloads (wrong length, out-of-range cell, negative RT, extra `score` field) are rejected or ignored.
- `rate(before)` ×2 with different values keeps the first.
- **Release ×2** yields one batch: all waiting clients receive views with an identical `revealAt`, the assignments and `shown_peers` are persisted, and the thresholds are frozen.
- **Late finisher** after release: assigned immediately, with `revealAt` ≈ now + 3000.
- **Reconnect:** disconnect while waiting, release, then reconnect with the same token → the recap arrives with identical peers.
- **No-leak:** at every stage the participant view has none of the forbidden keys or values (`condition`, `kind`, `diff`, `stratum`, `up/down/neutral`, `ghost`).
- Host events without a key are rejected, and bot events are rejected on live sessions.
- Export row counts and deltas are consistent.

### Multi-user simulation (P0), `npm run sim -- --url <base> --key <ADMIN_KEY> --n 30 [--late 0.15] [--refresh 0.1] [--effect]`
- Creates a test session, then spawns N `socket.io-client` bots. Each one:
  - joins with a random delay;
  - plays using the shared generator plus a per-bot ability model (p(hit) by tier, lognormal RTs);
  - finishes, rates #1, waits, receives the recap, then rates #2 (with `--effect`, a shift by mean peer diff that tests the Part 2 pipeline).
- A fraction of bots refresh or reconnect mid-flow, and a fraction finish after release.
- The host releases once ≥90% of bots are waiting.
- **Verifies:**
  - every bot reaches `done`;
  - there are no duplicate participants;
  - all peers are in-band and balance holds;
  - the ghost share is reported;
  - ack latency p50/p95 and release fan-out time (release → last view received) are reported.
- **Run locally with n = 60, and against the Render deployment with n = 30 and n = 60.**

### E2E (Playwright, P0 happy path; P1 for the rest)
- `webServer` runs the built server with a temp SQLite file and a test ADMIN_KEY.
- Projects: **mobile Chromium (Pixel 7)** and **mobile WebKit (iPhone 13)**, plus 375×667 (SE) screenshots.
- Test builds (`VITE_TEST_HOOKS=1`, stripped from production) mark the changed cell with `data-changed` so the bot can play deterministically.
- **P0:** the host context creates a session → a participant context completes the full flow → the host releases → the participant finishes → export contains the ratings.
- **P1:**
  - Refresh during Calibrating and during the Recap → same codename and same peers.
  - 5 participant contexts + host → each sees 3 others.
  - `context.setOffline(true)` during `finish`, then back online → completes.
  - Double-tapping "Lock it in" still yields one rating.
  - `emulateMedia({ reducedMotion: 'reduce' })` completes.
  - Landscape viewport.
- The bundle forbidden-words test runs after the build.

### Manual (P0)
- **Real devices:** iPhone Safari (current iOS), Android Chrome and at least one QR-scanner in-app browser, on the deployed URL and on campus Wi-Fi if possible, with cellular as backup.
- A CVD palette check in DevTools and a reduced-motion pass.
- **Rehearsal:** presenters plus friends on 3–6 real phones and 25 simulated bots in a `test` session.

---

## 17. Developer and test mode

- **Session `mode: test`** unlocks bots (server-enforced); `live` sessions reject every bot operation.
- Ghosts are the only synthetic data allowed in live sessions, and they are always flagged.
- **Host bot tools** (server-side, no sockets) give instant, large pools for checking assignment and host or Part 2 views.
- **`npm run sim`** (socket-based) exercises the real protocol, reconnects and concurrency.
- **Local dev:** `npm run dev` with `.data/dev.db`. Phones on the same Wi-Fi use `http://<LAN-IP>:5173/<CODE>`. Wake Lock needs a secure context, so it just degrades there.
- **Reproducibility:** because assignment is seeded, `release_json` plus the DB state reproduce any assignment offline for debugging.

---

## 18. Deployment on Render

```yaml
# render.yaml (Blueprint)
services:
  - type: web
    name: signal-shift
    runtime: node
    region: ohio                    # closest Render region to Waterloo
    plan: 1c-2g                     # 1 CPU / 2 GB (credits cover it); 0.5c-512mb would also suffice for 25
    buildCommand: npm ci && npm run build
    startCommand: npm start         # runs migrations at boot, then serves (pre-deploy is paid-only anyway)
    healthCheckPath: /healthz
    autoDeployTrigger: commit       # flip to 'off' before rehearsal/class
    disk: { name: data, mountPath: /var/data, sizeGB: 1 }
    envVars:
      - { key: NODE_VERSION, value: "24" }
      - { key: DB_PATH, value: /var/data/signal-shift.db }
      - { key: APP_ENV, value: production }
      - { key: ADMIN_KEY, sync: false }   # long random string entered in the dashboard
```

- **Setup steps:**
  1. `git init` in the project.
  2. The user creates a private GitHub repo in the browser; we add the remote and push.
  3. Render → New → Blueprint → select the repo.
  4. Set `ADMIN_KEY`.
  5. Deploy.
  6. Verify `/healthz`, create a test session, and run the sim against it.
- **Operational rules:**
  - A disk-attached service means deploys have brief downtime. **Never deploy during class.** Auto-deploy goes off before rehearsal, and Render's rollback to the last good deploy stays available.
  - On SIGTERM the server closes sockets gracefully; clients auto-reconnect and resync.
  - Render takes daily disk snapshots. Also **export JSON + CSV immediately after class**.
  - Socket.IO pings (25 s) keep connections alive. Render has no WebSocket duration cap.

---

## 19. Implementation order (critical path first)

Parts 2–3 can start once Phase 2 lands (data model and host namespace), in parallel with Phase 6 polish.

| Phase | Tier | Deliverable | Exit check |
|---|---|---|---|
| 0. Foundations | P0 | `git init`; scaffold Vite + React + TS + server; scripts; tsconfigs; `render.yaml`; "hello" server with `node:sqlite` + `/healthz`; **deployed to Render with the disk** | Render URL live, health green, DB file persists across a manual restart |
| 1. Shared core | P0 | rng, specs, generator, scoring, palette (ΔL\*), codenames, sigil, flow, protocol schemas + unit tests | Unit suite green |
| 2. Server | P0 | schema/migrations, repo, all participant and host commands, views, thresholds + pure assignment + ghosts, release/late, export, bots + integration tests | Integration suite green; `sim --n 30` local passes |
| 3. Participant skeleton | P0 | connection + outbox + reconnect; stage router; functional (plain) screens for every stage; full GameRunner with input and interruptions; Fader; basic Dial | Full flow on a desktop mobile emulator + sim bots |
| 4. Host console | P0 | login, sessions, QR, funnel, release, internals toggle + fallback summary, table, export, reset, bot tools | A presenter can run a whole test session alone |
| 5. Deploy + device smoke | P0 | deploy; iPhone + Android run-through; `sim --n 30` against Render | Zero errors; p95 ack < 300 ms |
| 6. Hero polish | P0→P1 | tokens, type, grain; identity reveal; game feel + feedback; **score lock-in (P0)**; **dial recap (P0)**; calibrating morph + synced countdown (P1); frames A/C (P1); tune transitions (P1); reduced-motion variants (P0) | Screenshots reviewed at 375 and 430 widths; reduced motion OK |
| 7. Hardening | P0/P1 | Playwright happy path, mobile Chromium + WebKit (P0); refresh/offline/double-tap/reduced-motion E2E (P1); bundle leak test (P1); `sim --n 60` on Render (P0) | All green |
| 8. Rehearsal + freeze | P0 | pilot with presenters and friends → tune `studyScale` (target median ~650–700, visible spread); auto-deploy off; wipe test data; create the **live** session; QR into slides; practise export | DoD checklist ticked |

**Dependency order to add:** react, react-dom, socket.io, socket.io-client, fastify, @fastify/static, zod, motion, qrcode, @fontsource-variable/{anybody, instrument-sans, jetbrains-mono}. Dev: typescript, vite, @vitejs/plugin-react, vitest, @playwright/test, fast-check, tsx, esbuild, concurrently, @types/{react, react-dom, node, qrcode}.

---

## 20. Acceptance criteria (testable)

1. Scanning the QR reaches the identity screen with **no login or personal data**, within about 3 s on 4G.
2. **Refresh at any stage** resumes the same codename, stage and (after assignment) the **same peers**.
3. Game: 1 practice round plus **12 scored rounds**, exactly one change per round, taps accepted only in the response phase with press-release commit, interruption replay capped at 2, and ~55–80 s of play for a typical player.
4. **Score is computed server-side** from taps and the seed. Identical inputs give an identical score, and a client-sent score is ignored.
5. The result screen shows the bare score and three non-anchoring stats. **No hit count, rank, average or other players.**
6. Ratings #1 and #2 use the **identical component and wording**, start empty, and record value, latency and adjustments. The first write wins.
7. Calibrating holds until release. **Release is atomic and idempotent**, and waiting phones reveal together (P1: within ~±300 ms via the countdown; P0: within ~2 s).
8. At ~25 players, conditions are **balanced within ±1** and **score-matched**. Every peer is inside its band; **real-first** (ghosts only when needed); every shown peer is persisted with score, kind and slot.
9. **Late finishers** are assigned immediately with a ~3 s calibrating beat.
10. **Participant payloads and bundle contain no internal labels.** The host console hides internals by default.
11. The host can create, QR, monitor, release, export, reset and spawn bots (test sessions only).
12. `sim` with 30 and 60 bots completes against Render with **zero errors** and p95 ack under 300 ms.
13. The Playwright happy path passes on mobile Chromium and mobile WebKit, and **real iPhone Safari plus Android Chrome** complete the flow.
14. Reduced motion completes the flow without motion-heavy effects.
15. Render: paid plan, disk attached, health green, auto-deploy off for class, data survives a restart.

---

## 21. Major risks and mitigations

| Risk | Mitigation |
|---|---|
| 2-day deadline for 3 parts | P0/P1/P2 tiers; skeleton on Render first; freeze features before rehearsal; host fallback summary covers the reveal if Part 2 slips |
| Render or deploy surprises (Node 24, disk, `node:sqlite`) | Deploy the Phase 0 skeleton immediately. Fallback: `better-sqlite3` (same SQL) or Render Postgres |
| Campus network blocks WebSockets | Socket.IO long-polling fallback; cellular as backup; test on eduroam at rehearsal |
| iOS Safari quirks (dvh, pull-to-refresh, backgrounding, in-app browsers) | `overscroll-behavior`, pointer events, `touch-action`, `visibilitychange` replay, real-device test |
| Students compare phones | Personal recaps naturally differ; ghost codenames never collide; "Everyone's game is a little different"; neutral copy |
| Purpose leaks (URL, bundle, host console projected) | Neutral names, separate host entry, forbidden-words build check, internals hidden by default |
| Host forgets or releases early | Readiness line in the console; ghosts keep everything valid; late finishers auto-assigned; optional `instant` mode |
| Server restart mid-session | State lives in SQLite on the disk; clients reconnect and resync; game rounds live in localStorage |
| Difficulty mis-tuned (no time for a real pilot) | `studyScale` per session; quick pilot at rehearsal; sparse grids avoid a guessing floor |
| Accidental deploy during class | Auto-deploy off; don't push during class |
| Data loss | Disk snapshots + immediate post-class JSON/CSV export |
| Low-end Android jank | Transform/opacity only; auto low-quality mode; game timing independent of React |
| Ethical optics of fabricated peers | Real-first, flagged, consistent, plausible; one-line disclosure in the Part 2 debrief |
| Stray home-directory git repo | Nested `git init` in the project; never run git from `C:\Users\chang` |

---

## 22. Where this plan changes the original spec, and why

1. **Real-first ghost fill** instead of strictly real peers (the user's new direction). It guarantees valid, balanced sets for the top and bottom scorers and a small class, while keeping "nothing was fake, it was selected" true for most students.
2. **Score-matched triplets plus a stored `stratum`**, beyond "balance when possible". This makes conditions comparable on actual performance and gives Part 2 its strongest visual: same score, different reference group.
3. **No denominator and no hit count on the score** (Festinger's ambiguity condition). Per-round feedback stays.
4. **Scale 200–1000 with a median around 650–700** instead of 0–1000, to avoid floor and ceiling effects in the ratings. **Speed counts only on hits, with saturating windows and difficulty weights**, making the score latency-proof and skill-weighted.
5. **Sparse grids** (items < cells) keep late rounds skill-based rather than guesswork.
6. **Vertical visual-analog scale with no default and no number**, used identically twice, to reduce anchoring to rating #1.
7. **Synchronized countdown reveal** as the room-wide wow moment.
8. **The consent step is merged into one line** on the identity screen. There's no opt-out toggle, no spectator mode and no leaderboard question (user decisions).
9. **Tutorial is client-only** and **rounds are submitted once at the end** (with localStorage resume): fewer server stages and messages to get wrong.
10. **SQLite on a Render disk with synchronous transactions** instead of Next.js + Supabase or Postgres. That's the simplest race-free design for a single-instance classroom app on a 2-day timeline.
11. **Perception-instrument aesthetic as a deliberate decoy** that protects the hidden purpose.

---

## 23. Seams left for Parts 2 and 3 (not built now)

- **Data for the reveal:** per participant, condition, stratum, score, r1, r2 and Δ; per viewer, the exact peers shown (score, kind, reveal order) and the dial dwell time. All of it is exposed through `/h` and the export.
- **Presenter state:** Part 2 adds `presenter_json` on `sessions` and a read-only projector route (e.g. `/screen`, key-auth) on the same Socket.IO server. The host namespace simply grows.
- **Phone takeover:** `done` is a server-driven stage. Part 3 adds an optional `view.overlay` (poll, scenario) so phones can be driven after Part 1 without touching earlier stages.
- **Clock sync** is already in place for synchronized moments such as poll closes and reveal beats.
- **Debrief honesty:** Part 2 should state that different students saw different "other players", and that a few were generated when needed.

---

## 24. Classroom run-of-show for Part 1 (for the presenters)

1. **T−30 min:** open the host console; check health. The `live` session is already created (or create it now) and the QR is on the slide ("SIGNAL SHIFT — scan to play"; the slide never mentions the topic).
2. **Intro line:** "Quick one-minute game before we start. Play solo — everyone's game is a little different."
3. Students play; a presenter watches the funnel on a laptop or phone that is **not projected**.
4. At ~90% waiting (or ~4 min in), press **Release**. Phones count down 3·2·1 together and the recaps drop.
5. Students rate again → "You're done — look at the main screen." Move to Part 2's reveal. Export data right after class.
6. **Contingencies:**
   - Very few players: ghosts keep it working.
   - Network hiccups: phones reconnect automatically, and cellular is the fallback.
   - Server trouble: Render restart or rollback; the data sits on the disk.

---

## PART 1 DEFINITION OF DONE

- [ ] Project has its own git repo (not the home-directory one), is pushed to GitHub, and is deployed on Render (paid plan, 1 GB disk, `/healthz` green, data survives a restart, auto-deploy **off** for class).
- [ ] Phone flow works end-to-end on the deployed URL: QR/code → identity + notice → tutorial → 12-round game → bare score + 3 stats → rating #1 → calibrating → recap dial with 3 others → rating #2 (identical) → done.
- [ ] No login or personal data; refresh at every stage resumes the same identity and stage, and after assignment the same peers.
- [ ] Score is computed server-side from taps and the seed; tampered or duplicate submissions can't change it; plausibility flags keep bad attempts out of the peer pool.
- [ ] Assignment passes unit and property tests: in-band peers, no self, real-first ghost fill, ±1 balance, score-matched triplets, extremes, ties, tiny pools, late finishers, determinism. `shown_peers` stores every peer shown (score, kind, slot).
- [ ] Release is atomic and idempotent; waiting phones reveal together; late finishers are auto-assigned with a ~3 s beat.
- [ ] Participant payloads and the participant bundle contain no internal labels; the host console hides internals by default; all copy is neutral (no compare/rank/better/worse).
- [ ] Host console can create a session with a QR, show the live funnel, release, show the internals summary (fallback reveal), export JSON/CSV, reset, remove players, and spawn bots in test sessions only.
- [ ] `npm test` (unit + integration) is green; `sim` with 30 and 60 bots passes against Render with zero errors and p95 ack under 300 ms; the Playwright happy path passes on mobile Chromium and WebKit.
- [ ] Verified on a real iPhone (Safari) and Android (Chrome), including one QR in-app browser; reduced-motion and color-vision emulation passes done.
- [ ] Hero moments polished: identity reveal, game feedback, score lock-in, dial recap; 60 fps on a mid-range phone; photosensitivity-safe mask.
- [ ] Rehearsal done with real phones plus 25 bots; `studyScale` tuned (median ~650–700 with visible spread); test data wiped; live session created; QR in slides; export drill done.
- [ ] Data model confirmed sufficient for Part 2 (condition, stratum, r1/r2/Δ, peers shown, ghost flags); `AGENTS.md` documents dev, test, sim, e2e and deploy commands.
