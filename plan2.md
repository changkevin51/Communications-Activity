# Signal Shift — Part 2 Implementation Plan (The Reveal: presenter control + projector)

Part 1 collects the data: a disguised perception game, two self-ratings and a hidden reference group. Part 2 turns that data into a sequenced, presenter-paced reveal on the classroom projector. The build extends the Part 1 service. It's the same Fastify + Socket.IO + `node:sqlite` process on Render, the same session model, the same host key, and the same "Night Broadcast" visual language. It adds a **presentation state machine**, an **immutable reveal snapshot**, a **private presenter console** and a **public projector surface**, synchronized through the existing Socket.IO server.

> Status: plan only. Nothing here is implemented yet. Part 3 (polls, scenarios, reflected appraisal) is only given an extension point (§20).

---

## 0. Decisions this plan makes (and the facts from Part 1 that force them)

| Topic | Part 1 reality (inspected) | Part 2 decision |
|---|---|---|
| Consent / display preference | **Does not exist.** Part 1 dropped the opt-out toggle and the leaderboard question (plan.md §0). Only the notice is shown: "Anonymous results may appear on screens during class." | Every participant is treated as **anonymous-by-default, never labeled**. Dots never carry a codename, sigil or any stable public label. Individual numbers appear in exactly one controlled place (the "same score" demo, §9.7), and even there only scores are shown, never ratings. The `share` field is reserved for a future opt-out (§12). |
| Leaderboard scene (brief 2G) | Not collected. | **Dropped.** The scene registry supports optional scenes, so it can be added later if a question is ever collected. |
| Generated ("ghost") peers | Real-first, generated only when needed (`ghostPolicy: fill`). They are flagged in `shown_peers.peer_kind`. | **Never drawn as class members.** The mechanism scene discloses the real count honestly ("41 of the 45 others you saw were classmates; 4 were generated to fill gaps"). The demo scene prefers sets with only real peers. See §15 for the recommendation about `ghostPolicy` on the live session. |
| Live data or snapshot | Ratings keep arriving until everyone finishes. | **Frozen snapshot at BEGIN REVEAL** (§5). Every chart reads one immutable, versioned snapshot. Late finishers still finish and export, but they never move a chart. |
| Where analytics run | The host view already computes per-condition means on the server. | **Server-side, pure, computed once at freeze and stored with the snapshot** (§7). The projector receives a derived, privacy-filtered payload and renders it. It never sees raw rows with IDs. |
| Realtime | Socket.IO namespaces `/p` (phones) and `/h` (host, `ADMIN_KEY`), full-snapshot views, a monotonic `rev`, and server clock sync. | **Reuse it.** `/h` gains presentation commands. A new read-only namespace **`/s`** (screen) serves the projector. `/p` gains one neutral field (`view.room.screen`) for "look up". There is no second realtime system. |
| Rendering tech | React 19 + `motion` + CSS; custom SVG sigils/dial. | **One Canvas 2D "field"** for all participant dots (≤ 200 marks, stable identity across scenes) **plus a DOM/SVG layer** for typography and axes, animated with `motion`. No WebGL, no D3 runtime (only a few pure helpers such as a quantile, a beeswarm packer and easing, written in-house). |
| Presenter auth | `ADMIN_KEY` in the host device's localStorage. | The presenter console is part of `host.html` and uses the same key. The projector gets a **separate per-session screen key** (random, rotatable, read-only), so the projector laptop never holds the admin key. |

---

## 1. Current architecture assessment (what Part 1 actually is)

Inspected at `main` after PR #1 merged:

- **Server** (`src/server`): `app.ts` wires Fastify static routes (`/`, `/:code`, `/host`, `/assets/*`, `/healthz`, `/api/export/:id`) and Socket.IO. `hub.ts` tracks connected participants and pushes full `ParticipantView`s to `p:<pid>`, plus debounced (250 ms) `hostView` pushes to `h:<sessionId>`.
- **Commands** are zod-validated and run as **one synchronous SQLite transaction** each (`db.tx`), so there are no interleavings. They are idempotent and rate-limited by a token bucket. This model is ideal for the presentation state machine too: `next` pressed on two devices at once simply cannot race.
- **Data model** (`src/server/db/schema.ts`, migration 1): `sessions(phase open|released|closed, mode live|test, config_json, seed, release_json)`, `participants(kind human|bot|ghost, stage, codename, sigil_json, timestamps, removed_at, flags_json)`, `attempts(score, stats_json, flags_json)`, `rounds`, `ratings(phase before|after, value 0–100)`, `assignments(condition up|neutral|down, batch, stratum, viewer_score, thresholds_json)`, `shown_peers(viewer, slot, peer, peer_kind, peer_score, diff)`, `events`. Migrations use `PRAGMA user_version`, so migration 2 can be added cleanly.
- **Everything the reveal needs is already stored**: score, r1, r2, condition, stratum (score-matched triplets), the exact peers shown (score, kind, slot), dial dwell time and plausibility flags. `hostView.internals.summary` already computes n, mean score, mean r1, mean r2 and mean Δ per condition. That summary is the fallback reveal and the oracle for Part 2's unit tests.
- **Participant client** (`src/client`): a stage router in `App.tsx`. `Done.tsx` already says "You're done. Keep this page open and look at the main screen." It requests a wake lock and shows a morphing sigil. Phones are therefore already parked correctly. Part 2 only needs to make that screen react to the reveal.
- **Host console** (`src/host`): functional and plain (system font, `host.css`). It has a session list, QR, funnel, Release, a hidden internals panel, export, reset/delete, remove, and test bots (`bots.spawn`, `bots.advance → rated_before | done`, with a synthetic per-condition effect of −8/0/+8).
- **Visual system**: tokens in `src/client/styles/tokens.css` (ink `#0B0C10`, paper `#F4F1EA`, signal vermilion `#FF4F1F`, phosphor `#C8FF3D`, mute `#8F93A3`). Fonts are self-hosted: Anybody variable (with width axis), Instrument Sans and JetBrains Mono. Motifs are the sigil (Lissajous), tick rails, static grain and the tuning dial. `motion` is installed, and `useReducedMotion` and `useNow` exist.
- **Leak hygiene**: `tests/bundle/forbidden-words.ts` walks only the participant chunks from `dist/client/index.html`. The host chunks are excluded. A projector entry that references words like "upward" or "condition" is therefore safe **as long as it is a separate HTML entry** that the participant bundle never imports.
- **Tests**: Vitest unit/property tests (fast-check), integration against a real Fastify + Socket.IO server on an ephemeral port (`tests/integration/flow.test.ts`), `tests/sim/sim.ts` (N socket clients, ack latency, release fan-out), and Playwright (`playwright.config.ts`: mobile Chromium Pixel 7 plus mobile WebKit iPhone 13; `tests/e2e/serve.mjs` builds with `VITE_TEST_HOOKS=1`). CI runs `.github/workflows/ci.yml`.

### Technical debt that materially affects Part 2

1. **No presentation state anywhere.** Session `phase` is about joins and assignment. Part 1's plan explicitly reserved "presenter state *alongside* `phase`" (plan.md §4). → New `presentations` table (§5).
2. **`sessions.mode` CHECK is `('live','test')`.** Rehearsal data must be isolated without rebuilding `sessions`. → Rehearsal snapshots live in `reveal_snapshots.source = 'demo'` and are only allowed on `test` sessions (§13). No CHECK change is needed.
3. **The host view is one blob** (funnel plus internals) that is pushed on every change. The presenter console needs a **readiness** view that stays cheap at 100 players, plus the presentation state. → Add a separate `presenterView`. `hostView` stays as is.
4. **Funnel "connected" is per participant socket count in memory** (`Hub.connections`). That's fine: readiness reuses it.
5. **The participant view has no hook for session-level screens.** → Add `view.room.screen?: 'look'` (a neutral word; §8.4) and later `view.prompt` for Part 3.
6. **The host UI is not presentation-grade.** The presenter console gets its own component set, but it reuses tokens and fonts (the host currently uses system-ui).
7. **Bots jump straight to `scored`**, and their `advanceBots(done)` effect is a fixed −8/0/+8 (plus noise sd 4). Rehearsal needs richer, scenario-driven data. → Add a pure demo generator (§13). Bots stay the path for testing the **full pipeline**.
8. **The `SCORE_LO/HI` clamp (260–985)** exists only for generated peers. Real scores span 200–1000. The projector's score axis must use the real range and handle extremes (§9.4).

---

## 2. Proposed Part 2 architecture

```
Presenter laptop/tablet                     Projector (any browser)                 Phones (Part 1 app)
/host → "Present" (host.html)               /screen/<CODE>#k=<screenKey> (screen.html)   /<CODE> (index.html)
   │  io('/h', auth:{key})                     │  io('/s', auth:{code, screenKey})        │ io('/p')
   ▼                                           ▼                                          ▼
┌──────────────────────────── one Node 24 process (Render, 1 instance) ─────────────────────────────┐
│ sockets/host.ts  + pres.* commands ──► services/presentation.ts (reducer, 1 SQLite tx per command) │
│ sockets/screen.ts (read-only)             │                 │                                      │
│                                           ▼                 ▼                                      │
│                              presentations (1 row/session)  reveal_snapshots (immutable, hashed)  │
│ hub.pushPresentation(sessionId) → emits `screen` to s:<id>, `presenterView` to h:<id>,            │
│                                   `view` to affected phones (only when room.screen changes)       │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Principles:

1. **The server is the only source of truth for "where we are".** The state is `{sceneId, beat, rev, nonce, hold}` in one row. Clients render `f(snapshot, sceneId, beat, viewport)`, a pure function. Nothing about progress lives only in a browser.
2. **Commands, not events.** The presenter sends intents (`pres.next {rev}`). The reducer validates them against the scene registry and the current `rev`, commits them, and broadcasts the full state. A stale command (wrong `rev`) is rejected and answered with the current state. This is the same idempotent full-snapshot pattern as Part 1.
3. **Snapshot first, render second.** `BEGIN REVEAL` freezes the data (§5). The derived payload (`RevealData`) is sent to the projector once per snapshot hash and cached by the client. Beat changes send only about 100 bytes.
4. **The projector is a dumb, deterministic renderer**, and the presenter console embeds the *same* scene components at thumbnail size for preview. There is only one implementation of every scene.
5. **Phones are not part of the show** (§8.4). They receive only a "look up" flag. There are no reveal internals in `/p`.

### New / changed server modules

```
src/server/
  db/schema.ts              + migration 2 (presentations, reveal_snapshots, presentation_log)
  reveal/
    registry.ts             scene list, beats per scene, optional/required, data guards
    eligibility.ts          rows → {included[], excluded{reason→count}}
    derive.ts               included rows → RevealData (pure, versioned 'reveal@1')
    copy.ts                 RevealData → adaptive headline/caption keys (pure)
    demo.ts                 scenario + n + seed → synthetic rows (pure, deterministic)
  services/presentation.ts  reducer + snapshot freeze + lease; all in db.tx
  sockets/screen.ts         '/s' namespace: auth(code, screenKey) → join s:<sid> → emit 'screen'
  sockets/host.ts           + pres.* handlers (admin key already enforced)
  hub.ts                    + pushPresentation(sessionId) (not debounced; beats must feel instant)
  app.ts                    + GET /screen/:code → screen.html (no-store)
src/shared/
  reveal.ts                 types shared by server/screen/host: SceneId, Beat, RevealData, ScreenState
```

---

## 3. Route and component structure

| Route | Entry | Who | Auth |
|---|---|---|---|
| `/` and `/:CODE` | `index.html` (unchanged) | students | anonymous token (Part 1) |
| `/host` | `host.html` | presenter | `ADMIN_KEY` |
| `/host#present=<sessionId>` | `host.html` → `Presenter` view | presenter (control) | `ADMIN_KEY` |
| `/screen/:CODE#k=<screenKey>` | **new `screen.html`** | projector | per-session `screenKey` (read-only) |

- **Why the key is in the hash:** fragments aren't sent in HTTP requests, logs or `Referer`. The screen client reads it and passes it in the Socket.IO `auth`. It is stored in `sessionStorage` so a refresh works. The console shows the projector link together with a large QR, so the projector laptop can open it by scanning or through a copy-able link, and it never needs the admin key.
- **Why `/host#present` and not `/control/:code`:** it keeps the admin key in one origin/entry, it needs no new server route, and it lets a presenter jump between the session panel and the presenter console without re-login. The brief's `/control/:code` maps exactly onto this.
- `vite.config.ts` gets a third `rollupOptions.input` entry: `screen: 'screen.html'`. The bundle checker stays scoped to `index.html` chunks. A new check asserts that **no participant chunk imports `src/screen/**` or `src/shared/reveal.ts`**.

```
src/screen/                      projector (public surface)
  main.tsx, ScreenApp.tsx        connection, clock offset, snapshot cache, scene router
  stage/Stage.tsx                16:9 safe-area letterbox, scale-to-fit, grain, hold/blackout
  stage/Field.tsx                <canvas> dot field: stable marks, tweened positions (§10)
  stage/Type.tsx                 kinetic headline/caption primitives (Anybody width axis)
  stage/Axis.tsx, Ticks.tsx      SVG rails/axes reused from Part 1 tick motif
  scenes/                        one file per scene: layout(data,beat,vp) + overlay(data,beat)
    Lobby.tsx  Playing.tsx  Hold.tsx  OneGame.tsx  SelfRating.tsx  Cut.tsx
    SameScore.tsx  Worlds.tsx  Movement.tsx  Compare.tsx  Mechanism.tsx  Concept.tsx  End.tsx
  layout/                        pure: beeswarm.ts, lanes.ts, scatter.ts, triplet.ts (unit-tested)
src/host/presenter/              private console
  Presenter.tsx                  layout: current | next preview | notes | readiness | controls
  Readiness.tsx  DataHealth.tsx  SceneStrip.tsx  Shortcuts.ts  ProjectorLink.tsx
```

`src/client/ui/Sigil.tsx`, the tokens and the fonts are imported by `src/screen` through relative imports. Vite chunking puts shared UI in a common chunk, which is fine because it contains no forbidden words. The bundle check enforces this.

---

## 4. Presentation state machine

### State (one row per session)

```sql
-- migration 2
CREATE TABLE presentations (
  session_id   TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  scene        TEXT NOT NULL DEFAULT 'lobby',
  beat         INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL DEFAULT 1,       -- bumps on every accepted command
  nonce        INTEGER NOT NULL DEFAULT 0,       -- bumps on "replay"; forces animation restart
  hold         INTEGER NOT NULL DEFAULT 0,       -- 1 = projector shows HOLD card (blackout/pause)
  plain        INTEGER NOT NULL DEFAULT 0,       -- 1 = static no-animation rendering (emergency)
  snapshot_id  TEXT REFERENCES reveal_snapshots(id),
  screen_key   TEXT NOT NULL,                    -- random 24 bytes b64url; rotatable
  controller   TEXT,                             -- socket-lease id of the active controller
  controller_at INTEGER,
  changed_at   INTEGER NOT NULL                  -- server ms when (scene,beat,nonce) last changed
);
CREATE TABLE presentation_log (                  -- append-only, for debugging & export
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, at INTEGER NOT NULL,
  cmd TEXT NOT NULL, from_scene TEXT, from_beat INTEGER, to_scene TEXT, to_beat INTEGER, rev INTEGER NOT NULL
);
```

The row is created lazily on first `pres.open` or `watch`, with `screen_key` generated then.

### Scenes and beats

A **scene** is a named visual composition. A **beat** is one presenter click inside it (one reveal step). Scenes are ordered in `reveal/registry.ts`:

| # | `scene` | Beats | Needs snapshot | Optional | Guard (auto-skip or fallback when false) |
|---|---|---|---|---|---|
| 0 | `lobby` | 1 | no | – | – |
| 1 | `playing` | 1 | no | – | – (live counts) |
| 2 | `hold` | 1 | no | – | "Waiting for the reveal" |
| 3 | `onegame` | 3 | **yes (freeze on entry)** | – | n ≥ 1, else fallback card |
| 4 | `selfrating` | 2 | yes | – | n with r1 ≥ 3 |
| 5 | `cut` | 2 | yes | – | – |
| 6 | `samescore` | 4 | yes | yes | a valid real triplet or single (§9.7); else **skip** by default |
| 7 | `worlds` | 3 | yes | – | ≥ 2 worlds with n ≥ 1 |
| 8 | `movement` | 4 | yes | – | n with r1&r2 ≥ 3 |
| 9 | `compare` | 3 | yes | – | ≥ 2 worlds with paired n ≥ 2 |
| 10 | `mechanism` | 2 | yes | – | – |
| 11 | `concept` | 1–3 | no | yes | at least one configured quote, else skip |
| 12 | `end` | 1 | no | – | – |

This improves on the brief's list: *Reveal intro* becomes the first beat of `onegame`, *Hidden difference* becomes `cut`, and *Individual movement* and *Group comparison* are split into `movement` (dots) and `compare` (averages). *Same-score* moves **before** `worlds` (see §15: it's the strongest way to introduce the manipulation). `playing` and `hold` are pre-reveal projector states that the presenter moves through (or that auto-follow session phase; see below).

### Transitions (reducer, `services/presentation.ts`)

```ts
type Cmd =
  | { t: 'next'; rev: number } | { t: 'prev'; rev: number }
  | { t: 'goto'; rev: number; scene: SceneId; beat?: number }
  | { t: 'begin'; rev: number; confirm: 'BEGIN' }         // lobby/playing/hold → onegame:0 (freezes)
  | { t: 'hold'; rev: number; on: boolean }              // blackout / pause card
  | { t: 'replay'; rev: number }                         // nonce++
  | { t: 'resnap'; rev: number; confirm: 'RESNAP' }      // new snapshot, jump to onegame:0
  | { t: 'rewind'; rev: number; confirm: 'REWIND' }      // back to lobby, keeps snapshots (rehearsal)
  | { t: 'take' }                                        // claim controller lease
```

- `next`: if `beat < beats(scene)−1`, then `beat+1`. Otherwise go to the next scene whose guard passes (skipped scenes are logged as `skip`). At `end` it's a no-op.
- `prev`: the mirror of `next`. It **never crosses back into pre-reveal scenes** once a snapshot exists (to go back there you must `rewind`). That keeps an accidental back-click from exposing the lobby mid-reveal.
- `goto`: to any scene/beat that passes its guard. Pre-reveal scenes need `rewind`.
- Any scene with `needsSnapshot` is unreachable until `begin` has run. `begin` is the only command that creates a snapshot on a live session.
- Commands fail with `{ok:false, reason:'STALE'|'NOT_CONTROLLER'|'GUARD'|'NO_SNAPSHOT'}` and always return the current state.
- **`rev` check**: every mutating command carries the `rev` the client was rendering. If `rev !== row.rev`, the reply is `STALE`. That's how a double-tap, two clickers, or a reconnecting console replaying an old command is safely ignored.
- **Auto-follow before reveal** (a convenience you can turn off): while `scene ∈ {lobby, playing, hold}` and no command has been given in the last 10 s, the server moves the scene based on session phase and the funnel. It stays in `lobby` while the room is open and fewer than 1 participant has started. It goes to `playing` once anyone has started. It goes to `hold` once ≥ 90% of started participants are `done`. The presenter can always override.

### Idle, pause and emergency

- **Hold** (keys `B` / `.`, which are the standard "blank screen" buttons on presentation clickers) toggles a full-screen HOLD card (the wordmark plus a slow sigil). The scene and beat are kept, and un-hold returns to the settled frame.
- **Emergency skip** is `Shift+→` (next scene) or the scene strip. **Emergency fallback** (`F`) switches the projector to *plain mode* for the current scene: static text and numbers, no canvas and no animation (§14). This is a per-screen flag in the state, so it survives refreshes.

---

## 5. Reveal snapshot strategy

### Live data vs. frozen snapshot

| | Continuously live | **Frozen at BEGIN REVEAL (chosen)** |
|---|---|---|
| Story stability | Numbers can change mid-sentence ("n = 27 … now 28, average moved") | The same numbers from the first beat to the last |
| Presenter trust | They can't rehearse what they'll say | The data-health panel is final before the first beat |
| Late finishers | They'd be included, but they'd shift charts they haven't seen explained | They finish normally, are stored and exported, and are reported as "+2 still finishing" |
| Reproducibility | A refresh could render different data | A refresh renders **byte-identical data** (hash-checked) |
| Complexity | Every scene needs "data changed" animation | Every scene is a pure function |

### What gets frozen

```sql
CREATE TABLE reveal_snapshots (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('live','test','demo')),  -- live ⇔ sessions.mode='live'
  scenario     TEXT,                    -- demo only (e.g. 'expected'); NULL otherwise
  seed         TEXT,                    -- demo only
  version      TEXT NOT NULL,           -- 'reveal@1' (eligibility + derive + copy)
  created_at   INTEGER NOT NULL,
  counts_json  TEXT NOT NULL,           -- {joined, started, scored, ratedBefore, assigned, done, excluded:{reason:n}}
  rows_json    TEXT NOT NULL,           -- SnapshotRow[] (below), pseudonymous
  data_json    TEXT NOT NULL,           -- RevealData (derived, privacy-filtered)
  hash         TEXT NOT NULL            -- sha256(data_json), used by clients as cache key
);
CREATE TRIGGER reveal_snapshots_immutable BEFORE UPDATE ON reveal_snapshots
BEGIN SELECT RAISE(ABORT, 'snapshot is immutable'); END;
CREATE TRIGGER reveal_snapshots_demo_guard BEFORE INSERT ON reveal_snapshots
WHEN NEW.source = 'demo' AND (SELECT mode FROM sessions WHERE id = NEW.session_id) = 'live'
BEGIN SELECT RAISE(ABORT, 'demo data on live session'); END;
```

```ts
type SnapshotRow = {            // one per included participant; no ids, no codenames
  k: number;                    // stable dot index = rank of sha256(sessionSeed + pid); not join order
  kind: 'human' | 'bot';        // bots only possible on test sessions
  score: number;                // server-authoritative
  r1: number | null; r2: number | null;
  world: 'up' | 'neutral' | 'down' | null;   // null ⇒ never assigned
  stratum: number | null;
  peers: { score: number; real: boolean }[]; // exactly what they were shown, in slot order
  dwellMs: number | null;
};
```

The snapshot freeze runs **inside the `begin` transaction**, so no rating can land "halfway". Freezing reads at most about 150 rows × 3 peers and completes in < 5 ms.

### Eligibility (`reveal/eligibility.ts`, versioned)

A participant is in the snapshot if **all** of these hold:
1. `kind ∈ {human}` on live sessions (`{human, bot}` on test sessions). Ghosts are **never** rows. They appear only as `peers[].real = false`.
2. `removed_at IS NULL`.
3. They have a complete attempt with a non-null score.
4. Attempt flags don't include `invalid`. Flags like `interrupted` or `restarted` are **kept**, because the score is still server-computed, and they're counted in `counts.flagged`.

Then each scene applies its own **analysis subset**, so no one is double-excluded silently:

| Subset | Used by | Rule |
|---|---|---|
| `scored` | onegame | all eligible |
| `rated1` | selfrating | `r1 != null` |
| `assigned` | worlds, samescore | `world != null` |
| `paired` | movement, compare | `world != null && r1 != null && r2 != null` |

Excluded counts are stored as `excluded:{removed, invalid, noScore, stillPlaying}` and shown in the presenter console. On the projector they appear as one neutral footnote when non-zero: "24 of 27 players shown · 3 still finishing".

**Opt-outs:** Part 1 has no opt-out, so there is nothing to filter. If a future `display_pref` column exists, `eligibility.ts` treats `display_pref = 'hidden'` as "count in aggregates, draw no individual mark". This is designed as a field on `SnapshotRow` (`share: 'mark' | 'aggregate'`) so all layout functions already handle it.

### Computed once, cached, derived from immutable records

- `derive(rows) → RevealData` runs once at freeze. The result is stored in `data_json` and hashed.
- The projector gets `RevealData` only (never `rows_json`). Clients cache it by `hash` in memory plus `sessionStorage`. On reconnect the server sends `{state, dataHash}`, and the full data only if the client says its hash differs.
- `version` pins the logic. If `derive` changes later, old snapshots still render with their stored `data_json`.

### Re-snapshot and rehearsal

- **Resnap** (`confirm:'RESNAP'`, hold-to-confirm in the console) creates a *new* snapshot row, points the presentation at it, and jumps to `onegame:0`. Old snapshots are kept, for audit and export.
- It's allowed on live sessions (e.g. the class ran late and 6 more finished before the reveal really started), but the console warns: "This changes the numbers on screen."
- After the reveal, an optional **"late finishers" beat** is available at `end` only. It says "+N finished after we froze the data" and never changes any chart.

---

## 6. Presenter / projector synchronization

### Wire protocol

```ts
// server → projector ('/s', room s:<sessionId>) and → presenter ('/h', room h:<sessionId>)
type ScreenState = {
  rev: number; serverNow: number; changedAt: number;
  scene: SceneId; beat: number; nonce: number; hold: boolean; plain: boolean;
  source: 'live' | 'test' | 'demo' | null;        // null before any snapshot
  dataHash: string | null;
  live?: { joined: number; started: number; done: number; code: string; joinUrl: string }; // pre-reveal scenes only
  concept?: ConceptSlot[];                         // configured quotes (§9.12)
};
// '/s' events: 'screen' (ScreenState), 'data' (RevealData, on request 'need' {hash})
// '/h' adds:   'presenterView' = ScreenState + readiness + dataHealth + lease + notes
```

- **Full state, every time.** There are no deltas and no "event queues". A client that missed 5 beats renders the latest one directly.
- `hub.pushPresentation(sid)` is **not debounced**: a beat must hit the projector within one RTT. Pre-reveal `live` counts piggy-back on the existing 250 ms `pushHost` debounce, so 100 joins cause ≤ 4 screen updates per second.

### Deterministic rendering and animation replay

The projector renders `settled(scene, beat)` as a pure layout. **Animation is only the path from the previous settled frame to the new one**:

- If `serverNow − changedAt < 1500 ms` when the state arrives, **and** the client was already showing `(scene, beat−1)`, it plays the transition from the elapsed offset. Motion is time-based, so a projector 200 ms behind catches up rather than lagging.
- Otherwise (fresh load, reconnect, jump, `prev`), it renders the settled frame with a 250 ms cross-fade. There is **no replaying an entire scene after a reconnect**.
- `nonce` changes → re-run the transition into the current beat from the previous beat's settled frame (the "Replay" button).
- Clock offset uses the Part 1 method (3 pings, lowest RTT) on `/s` too. It's used for the timing inside a beat (e.g. counting-up numbers finish at the same moment on the projector and the preview).
- Randomness in layouts (beeswarm jitter, particle drift) is seeded from `dataHash + scene`, so two projectors and the console preview draw identical frames.

### Reconnects and failures

| Situation | Behavior |
|---|---|
| Projector refresh | Reads `k` from hash/sessionStorage → connects → gets `screen` → requests `data` if its cache is missing → renders the settled frame. Target: < 1.5 s to the correct scene. |
| Projector network blip | Keeps the last frame (never blanks). After 5 s disconnected a 6 px dim dot appears bottom-right, visible only up close. Socket.IO reconnects with backoff (max 5 s), and polling fallback works on restrictive networks. |
| Presenter console crash/refresh | State is on the server. The console reconnects, re-takes its lease (same `leaseId` in sessionStorage), and shows the same scene. The **projector is unaffected**. |
| Presenter laptop dies entirely | Open `/host` on a phone, log in, open the session → Present → "Take control". The phone layout is a big NEXT / BACK / HOLD pad (§12). |
| Duplicate controllers | **Lease:** one active `controller` (the most recent `take`). Other consoles are **observers**. They see everything, their controls are disabled, and they show a "Take control" button. A lease is released 30 s after its socket disconnects, and until then others can still `take` explicitly. Commands from non-holders get `NOT_CONTROLLER`. |
| Stale / duplicate commands | The `rev` precondition (§4). A clicker's key-repeat or a double-tap produces exactly one advance. The console also locks input for 200 ms after sending. |
| Server restart / deploy mid-class | State and snapshot are in SQLite on the persistent disk. Everyone reconnects to the same scene. (Deploys are still avoided during class; see the Part 1 runbook.) |
| Two projectors (e.g. overflow room) | Both subscribe to `s:<id>`. They are identical because rendering is deterministic. |

### Security

- The `/s` handshake needs `{code, screenKey}`, compared in constant time. On failure the socket is dropped and the screen shows "Projector link expired — open it from the presenter console". `screenKey` rotates via `pres.rotateScreenKey` (disconnects existing screens).
- `/s` has **no inbound commands** except `need {hash}` and `clock`, and both are rate-limited.
- Students can't reach `/s` data without the key. The `screen.html` assets are public static files, but they contain only code, never data. Hashed asset names are never referenced from participant pages.
- Presenter commands go over `/h`, which already requires `ADMIN_KEY`.

---

## 7. Data aggregation strategy (`reveal/derive.ts`)

`RevealData` is **the only thing the projector knows**. Every number is precomputed and rounded server-side, and every optional value is typed as `number | null` with a matching `…Ok: boolean`. Renderers therefore never do arithmetic that could produce `NaN`.

```ts
type WorldKey = 'up' | 'neutral' | 'down';
type RevealData = {
  version: 'reveal@1'; source: 'live'|'test'|'demo'; scenario: string | null;
  n: { eligible: number; rated1: number; assigned: number; paired: number; stillFinishing: number };
  scoreAxis: { lo: number; hi: number; ticks: number[] };      // nice bounds from data, ⊂ [0,1000]
  marks: Mark[];                                               // one per eligible participant (share==='mark')
  scores: { mean: number; median: number; min: number; max: number; ties: number };
  selfRating: { ok: boolean; mean: number | null; corr: 'none'|'weak'|'clear'|null };   // corr: presenter only
  worlds: Record<WorldKey, WorldStats>;
  samescore: SameScoreDemo | null;
  mechanism: { peersShown: number; realShown: number; generatedShown: number; perPerson: 3 };
  pattern: Pattern;                                            // drives copy (§9.10)
  warnings: Warning[];                                         // presenter-only
};
type Mark = { k: number; score: number; r1: number | null; r2: number | null; world: WorldKey | null };
type WorldStats = {
  n: number; nPaired: number;
  meanScore: number | null;                                    // shows performance was matched
  meanR1: number | null; meanR2: number | null; meanDelta: number | null; medianDelta: number | null;
  moved: { up: number; down: number; same: number };           // |Δ| < 2 counts as "same"
  small: boolean;                                              // nPaired < 5
};
```

Rules:

- **Descriptive only.** Means, medians and counts. There are **no p-values, CIs or effect sizes on the projector**. (A bootstrap interval is computed for the *presenter's* data-health panel only, labeled "rough spread, not a test".)
- **Rounding:** scores are integers. Ratings and deltas are 1 decimal place, shown as integers on the projector when |Δ| ≥ 10. Averages from fewer than 2 values are `null`.
- **Ties** (common when many players get identical scores): the beeswarm stacks them, so no tie-breaking is needed. `scores.ties` feeds a presenter note.
- **Extremes:** ratings are bounded 0–100, so there are no outliers in position. Score extremes (200 or 1000) set `scoreAxis` from data plus 5% padding, clamped to [0, 1000]. The median delta is kept beside the mean. If the two have **opposite signs** or differ by > 5, a presenter warning says "One or two big moves are driving the average in <world>."
- **Imbalance:** assignment is stratified, so the worlds are within 1 of each other when there are no late joiners. Late assignment can unbalance them. All stats show their own `n`. If one world has `nPaired = 0`, `compare` drops that lane and says so ("No one in this group finished both ratings").
- **Missing r2:** these participants are excluded from `paired` only. They still appear as dots in `onegame`, `selfrating` and `worlds`. In `movement` they are drawn as hollow dots that don't travel, with the caption "○ didn't give a second rating".
- **Late participants:** not in the snapshot, and counted only in `n.stillFinishing`.
- **`pattern`** is classified from the *paired* means: `expected` (Δup < Δneutral < Δdown with spread ≥ 4), `partial` (the right order but spread < 4, or only up/down differ), `flat` (all |Δ| < 2 and spread < 3), `reversed` (Δup > Δdown by ≥ 4), `mixed` (anything else), `thin` (paired < 6 or < 2 worlds with nPaired ≥ 2). This choice changes **only wording and emphasis**, never the data drawn.

---

## 8. Privacy filtering strategy

### 8.1 What the projector may show

| Allowed | Never |
|---|---|
| Unlabeled dots (position only) | Codenames, sigils, participant ids, join order |
| Aggregates (n, mean, median, counts) | Any name, email, IP, device, user agent (none are stored anyway) |
| The score-only demo (§9.7): three scores and their shown peers | Any individual's rating or rating change as a number |
| Generated-peer counts | Which specific peers were generated |

### 8.2 Why unlabeled dots are still sensitive, and how we handle it

With no opt-out, a student could recognize "their" dot by its score. So:
- **Dot identity is stable within the reveal but not published.** `k` comes from a hash, not join order or codename, and marks are never labeled.
- Individual dots **move** between scenes (score → rating → world → change). Anyone who knows their own score could follow their own dot, which is fine and even meaningful for them. But **nobody else knows another person's score** (phones showed only their own score plus 3 codenamed peers), so they can't follow others' dots.
- The one exception is **the demo**. It shows three real scores. It never shows their ratings or rating changes, and the console lets the presenter **skip** it or swap it for **"use an example"** mode (§9.7). If `n.eligible < 8`, the demo auto-switches to example mode: in a tiny class, a score is too identifying.
- **Codenames never cross from phones to the projector.** Peers' codenames were shown on phones, but the projector only ever shows peer *scores* and "classmate/generated" (in aggregate).

### 8.3 Code-level enforcement

- `derive.ts` output passes through `assertPublic(data)`, a zod schema that strips everything not whitelisted. The test suite snapshots its keys.
- Grep test: `data_json` for any snapshot must not contain any participant id, codename or token hash from the session (integration test).
- `/s` never sees `rows_json`. The presenter's `presenterView` gets warnings and counts, not rows. (Rows remain in the existing internals table and export, behind the admin key.)

### 8.4 Phones during the reveal

Phones get **one neutral flag**: `view.room.screen = 'look'` once `begin` has run (and it is removed on `rewind`). `Done.tsx` already says "look at the main screen". When the flag is set it dims further, shows the wordmark and "Eyes up here ↑", and stays awake.

Participants who are still mid-game or mid-rating when the reveal begins are **not blocked**. They can finish (their data is stored and exported and counted as late), but their screen gains a thin banner: "The class has moved on — finish up, then look at the main screen." New joins stay allowed only if the session is open, and the presenter should close the session before BEGIN (a console checklist item). The participant bundle gains **no** forbidden words. The flag's name and text are neutral, and the bundle check stays green.

---

## 9. Reveal narrative and scene-by-scene UX

### 9.0 The arc in one breath

> *You all played the same game. (Here's the room.) You judged yourselves. (Here's how.) — But you didn't all see the same thing. Three people with the same score got three different rooms. The whole class was quietly sorted into three rooms. Here's what happened to your judgments. Here's exactly how we did it. Here's the idea it was built on.*

**World vocabulary** (plain words first, then academic terms). Plain labels come first: **"SAW HIGHER SCORES"**, **"SAW SIMILAR SCORES"**, **"SAW LOWER SCORES"**. Academic labels are revealed in `worlds` beat 3: **UPWARD · SIMILAR (LATERAL) · DOWNWARD** comparison.

**World encoding** is redundant, so it never relies on color alone:

| World | Glyph | Color (on ink) | Position (lanes, left→right) |
|---|---|---|---|
| up | ▲ | ice `#7CC8FF` | left |
| neutral | ● | paper `#F4F1EA` | center |
| down | ▼ | amber `#FFB547` | right |

Vermilion `--signal` stays reserved for the **interruption** and the "you are here" focal marker. Phosphor `--phos` is reserved for the **headline number** of a scene. Ice and amber are distinguishable under deuteranopia and protanopia (they are blue vs. yellow), and the glyphs back that up.

**Every scene spec below** lists: *Appears · Communicates · Animates · Why this form · Class size / data patterns · Presenter · Fallback.*

---

### 9.1 `lobby` — "Tune in" (pre-reveal)

- **Appears:** a giant `SIGNAL SHIFT` wordmark (Anybody, width axis slowly breathing). There's a **join QR** big enough to scan from row 10 (≥ 38% of the screen height), the **room code** in 12vh mono letterspaced type, and the URL in text. A **constellation** field fills the background: each joined phone adds one sigil-shaped point of light that drifts into a slow orbit. The count "**27 tuned in**" is shown in 6vh type.
- **Communicates:** join here. The room is alive. Nothing about scores.
- **Animates:** each join makes a small ripple where its point appears (≤ 1 ripple / 200 ms, batched). The wordmark's width oscillates ±6 over 8 s.
- **Why:** it reuses the Part 1 sigils and makes the join count social without identity. The points are unlabeled and their positions are random, so no one can be identified by them.
- **Class size:** from 1 to 200 points. Beyond 120, the points get smaller and orbit speed decreases. At 0 it shows "Waiting for the first signal…".
- **Presenter:** the auto-follow can be turned off. `→` moves to `playing`.
- **Fallback:** plain mode shows a static QR + code + count.

### 9.2 `playing` — "Signal in progress" (pre-reveal)

- **Appears:** the QR shrinks to the top-right corner (late joiners). A three-segment **tuner rail** runs across the screen: *playing · rating · done*, with counts only (e.g. `12 · 6 · 9`). Constellation points move to their segment.
- **Communicates:** progress, so the presenter knows when to start, and it's calm for the room. **No scores.**
- **Animates:** points slide between segments on stage change (spring, 600 ms).
- **Why:** a rail is the Part 1 tick motif. Counts are safe because they contain no outcomes.
- **Fallback:** plain counts only.

### 9.3 `hold` — "Stand by"

- **Appears:** "**Hold on to what you felt.**" in display type, plus the sigil loop and "27 / 29 finished". The same card, without the count, is the HOLD/blackout card during the reveal.
- **Communicates:** a pause before the reveal.
- **Presenter:** the **BEGIN REVEAL** button (hold-to-confirm 1.2 s, or `Enter` twice within 2 s). The console first shows a pre-flight: *session closed? · N finished · N still playing · world balance*.

---

### 9.4 `onegame` — "One game" (3 beats) · freeze happens on entry

- **Beat 0 — "EVERYONE PLAYED THE SAME GAME."** The constellation collapses to the center, then explodes into a **horizontal score field**. Each eligible participant is a dot placed at its score on one axis (200–1000 ticks), in a **beeswarm** (dots stack vertically at ties instead of overlapping). The headline sits above: `ONE GAME.` / `12 ROUNDS. SAME SCREENS. SAME RULES.` (these are true because the rounds are seed-identical per session, per `plan.md`).
- **Beat 1 — the scale.** The axis labels light up. There are short text markers for **lowest · middle half · highest** (a quiet band for the IQR, never "average" labeled as a verdict). The caption reads "27 of you. Scores from 312 to 941."
- **Beat 2 — "SCORED THE SAME WAY."** A thin vermilion scan line sweeps once across the axis, and each dot flashes as it's passed. The caption reads "Every score was calculated by the server, not your phone." This establishes that performance was measured, not perceived.
- **Communicates:** a shared, fair baseline. The spread is real and normal.
- **Why this form:** a beeswarm keeps every person visible (no bars that hide individuals) while preserving anonymity. It also makes ties visible.
- **Class size:** dot radius = `clamp(√(W·H·0.05 / n) / 2, 6px, 22px)` of the stage. At n = 5 the dots are big and sparse. At n = 150 they stack up to about 12 high, and the packer compresses the vertical step when the stack exceeds 40% of the height.
- **Data patterns:** an extreme score (e.g. 200 after timeouts) just sits at the edge, and the axis includes it. With all ties you get one tall stack, with the caption "Most of you landed on the same score" (true by definition).
- **Presenter:** the usual. Note: "Don't mention comparison yet."
- **Fallback:** n = 0 → "No finished games in this snapshot" (the console suggests RESNAP). n < 3 → dots are shown, and the axis caption omits the range.

### 9.5 `selfrating` — "How did you think you did?" (2 beats)

- **Beat 0:** Each dot **rises** vertically to its first self-rating (0 at bottom, 100 at top), becoming a **score × felt** scatter. The Y axis is labeled with the fader's own words ("didn't go well" ↔ "went really well", which are the exact Part 1 labels). Headline: `THEN YOU RATED YOURSELF.`
- **Beat 1:** A soft horizontal band marks the **room's average first rating** (e.g. "Room average: 58 / 100"), and a brief text notes the connection between score and rating: "Higher scorers *tended* to rate themselves higher." This appears **only if** `corr = 'clear'` (Spearman ≥ 0.4 with n ≥ 10). Otherwise it says "Your scores and your ratings didn't line up much." With no clear pattern, it shows no caption at all.
- **Communicates:** feelings about performance are only loosely tied to performance. That sets up the question of what else moves them.
- **Why:** rising dots keep continuity (the same dots are now in 2D), which is more understandable than a new chart.
- **Data:** hollow dots for participants without r1 (they stay on the axis). Many identical ratings (e.g. everyone left the slider in the middle): the jitter separates them by ≤ 1.5% vertically, and the caption is omitted.
- **Fallback:** `rated1 < 3` → skip beat 1, and beat 0 shows only "You rated your performance on a slider" with no plot.

### 9.6 `cut` — the interruption (2 beats)

- **Beat 0:** **Everything stops.** The field freezes, then drains to 15% opacity in 400 ms. There's a hard 600 ms black frame, and the grain intensifies. Then a single line appears, typed at 28 chars/s in mono: `ONE THING WAS NOT THE SAME.`
- **Beat 1:** Display type slams in at 18vh with the width axis collapsing (wide→condensed over 500 ms): **`YOU DIDN'T ALL SEE THE SAME CLASSMATES.`** A thin vermilion rule underlines it.
- **Communicates:** the turn. It frames the manipulation as *what you saw*, not *how you did*.
- **Why:** a break in rhythm (silence, black, a single sentence) signals a story beat better than any chart. It is the only scene with no data.
- **Presenter note:** "Pause here. Let it land. Ask: *Who looked at the other players' scores after the game?*" The notes suggest a 5–10 s silence.
- **Fallback:** it's text only, so it can't fail. In reduced-motion mode it's a straight cut to text.

### 9.7 `samescore` — "Same score. Different room." (4 beats, optional)

The Part 1 assignment stratifies by score: triplets of adjacent scores get one each of up/neutral/down (`assignments.stratum`). **That means the class already contains a real, near-identical-score triplet who saw three different rooms.** That is the most honest possible version of the brief's "same score" demo.

**Selection (`derive.ts`, deterministic):** among strata with all three members eligible and assigned to three different worlds, choose the one with the smallest score range. Tie-break in this order: (1) all 9 shown peers real, (2) closest to the class median score (least identifying: middle scores are the most common), (3) hash order. The stratum is valid if its range is ≤ 30 points.

- **Beat 0 — "THREE OF YOU SCORED ABOUT 740."** One large **tuning dial**, the exact Part 1 `Dial` semicircle scaled up. The needle points at the focal score, shown in phosphor. The caption gives the real scores: `738 · 742 · 745`.
- **Beat 1 — the split.** The dial clones into **three dials side by side**, each with its needle at *its* member's score (they barely differ, which is the point).
- **Beat 2 — the rooms.** In each dial, the three peers that member actually saw **fade in and slide to their true scores**, as tick marks with score labels (no codenames). The left dial fills above the needle, the center dial close to it, and the right dial below. Plain-language captions are under the dials: `saw higher scores` · `saw similar scores` · `saw lower scores`. Generated peers are drawn identically (that's what the student saw). When the chosen set includes any, a footnote says "includes 1 generated score". Full disclosure comes in `mechanism`.
- **Beat 3 — the line.** The dials dim to 40%. Center text over them: **`SAME SCORE. DIFFERENT CONTEXT. DIFFERENT MEANING.`** It builds one phrase per 450 ms.
- **Communicates:** it separates performance (identical) from context (manipulated) using real data from *this* room.
- **Why this form:** the dial is the exact visual students saw on their phones. Recognition ("that's what I saw!") is the aha moment. Three side-by-side copies make the comparison immediate with no legend.
- **Privacy:** only three scores and nine peer scores are shown. **No ratings, no changes, no codenames.** The presenter can skip it, and with `eligible < 8` it auto-switches to example mode.
- **Example mode** (no valid triplet, a small class, or the presenter chooses it): the focal score = the class median, rounded to 10. For each world, the three peers are chosen *from real scores in the snapshot* using the same `bandFor` rules as Part 1. The **persistent label `EXAMPLE · built from real scores in this room`** sits top-left. If even that fails (n < 4), it uses a **fixed illustration** with the label `ILLUSTRATION · not real data`. Otherwise the scene is skipped.
- **Class size:** it's independent of n, since it always shows 3 dials × 4 marks.

### 9.8 `worlds` — "One game. Three social realities." (3 beats)

- **Beat 0 — the sort.** Back to the full field. Every dot (in score position from `onegame`) **lifts off and flies into one of three vertical lanes**, one per world. Within its lane, each dot keeps its horizontal score position, rotated so the score runs bottom→top. Glyphs appear (▲ ● ▼) and the colors fade in. The flights are staggered by score rank (40 ms × rank, capped at 1.6 s total), so it reads as *a sorting*, not an explosion. Headline: `ONE GAME.` → `THREE SOCIAL REALITIES.`
- **Beat 1 — matched.** Each lane shows `n` and its **average score** as a large number at its base (`683 · 679 · 686`). Caption: **"Same kinds of scores in every group. Only the comparison was different."** This is the anti-confound beat. It's true by construction (stratification), and the numbers prove it. If any lane's mean score differs by > 60 from the others (e.g. late-joiner imbalance), the caption becomes "Roughly similar scores in each group" and a presenter warning is shown.
- **Beat 2 — the words.** Lane titles flip from plain to academic, one at a time, with a mechanical split-flap letter change: `SAW HIGHER` → **`UPWARD COMPARISON`**, `SAW SIMILAR` → **`LATERAL COMPARISON`**, `SAW LOWER` → **`DOWNWARD COMPARISON`**.
- **Communicates:** hidden assignment, balanced groups, and the textbook vocabulary.
- **Why:** lanes are the simplest spatial metaphor for "three rooms", and they persist through the next two scenes as the frame for the effect.
- **Privacy:** dots only. Moving a dot into a lane reveals the world of an anonymous dot, and only the dot's owner knows it's theirs.
- **Class size / patterns:** lanes rescale per lane n. With empty or tiny lanes: a lane with n = 0 shows "nobody landed here" and stays as a dashed outline. Lanes with n ≤ 2 have their average score hidden ("too few to average").
- **Fallback:** if fewer than 2 worlds are assigned (e.g. assignMode instant with only 2 finishers), the scene becomes text only: "Each of you was shown one of three sets of classmates: higher, similar or lower."

### 9.9 `movement` — "Then you rated yourself again." (4 beats)

- **Beat 0 — before.** Each lane turns into a **slope field**: two short vertical rails per lane, `BEFORE` on the left and `AFTER` on the right. Each paired dot sits on the BEFORE rail at its first rating (0–100). Hollow dots (no second rating) are grayed out beside the lane. Headline: `AFTER SEEING YOUR CLASSMATES, YOU RATED YOURSELF AGAIN.`
- **Beat 1 — the move.** Every dot **travels to the AFTER rail at its second rating**, leaving a thin trail (a straight segment, 20% opacity, in the world color). Lanes animate one at a time, up → neutral → down, 1.2 s each, so the room watches each world move. Dots that moved up more than 2 points brighten slightly, and dots that moved down dim slightly. There's no red/green judgment.
- **Beat 2 — counts.** Under each lane, three small tallies: `▲ 7 rose · ■ 3 held · ▼ 2 fell` (with icons, in 5vh type). Nothing else.
- **Beat 3 — the average line.** The trails fade to 8%, and one **thick average slope** draws per lane from `meanR1` to `meanR2`. The **mean change** counts up in phosphor type at the top of each lane (`−6.8`, `+0.4`, `+5.1`), each with its `n = 9`.
- **Communicates:** individual variation is real (the trails go both ways in every lane), *and* a group tendency (the average line).
- **Why this form:** a slopegraph is the most legible before/after encoding. Showing individuals first, then the average, avoids implying that everyone moved the same way.
- **Class size:** at n > 40 per lane, the trails get thinner (1 px) and more transparent. At n ≤ 3 per lane, dots get large and trails are thicker. Lanes with `small` show a `small group` tag.
- **Data patterns:** flat → the trails are mostly horizontal, and the caption is "Most ratings barely moved". Reversed → shown as is, no special treatment. A single big mover → visible as one steep trail. The presenter warning (median vs mean) prepares the presenter.
- **Fallback:** `paired < 3` → beats 0–2 are dropped, and beat 3 shows text: "Only 2 people finished both ratings — too few to show a pattern."

### 9.10 `compare` — "In our class" (3 beats)

- **Beat 0 — the overlay.** The three average slopes **slide together into one shared chart**: a single BEFORE → AFTER frame, with three thick colored lines plus glyphs, each labeled at the right end with its world name and change. The axis is zoomed to the data (min 10-point window), with a clear label "rating, zoomed in" so small differences are readable but not exaggerated. The full 0–100 bar is shown as a thumbnail to its left.
- **Beat 1 — the sentence.** An adaptive headline (below) sits in display type, with a supporting line in UI type.
- **Beat 2 — the honesty line.** In small caps: `One class · N people · descriptive, not proof`. The presenter note gives talking points about variation, sample size, and why a real study would replicate this.
- **Why:** after seeing the individuals, a single comparative view is the payoff. Zoom + thumbnail is honest scaling.

**Adaptive copy (`reveal/copy.ts`)** chooses by `pattern`. The copy is *never* causal:

| `pattern` | Headline | Supporting line |
|---|---|---|
| expected | `SAME GAME. THE JUDGMENTS MOVED APART.` | "In our class, people who saw higher scores rated themselves {Δup} on average; people who saw lower scores, {Δdown}." |
| partial | `A SMALL SHIFT — IN THE EXPECTED DIRECTION.` | "The groups moved differently, but only by a few points." |
| flat | `IN OUR CLASS, THE RATINGS BARELY MOVED.` | "Seeing different classmates didn't change much here. That's a real result too." |
| reversed | `IN OUR CLASS, IT WENT THE OTHER WAY.` | "People who saw higher scores rated themselves {Δup}; lower, {Δdown}. Why might that be?" |
| mixed | `MIXED SIGNALS.` | "Some groups shifted, some didn't — no clear pattern." |
| thin | `TOO FEW TO CALL.` | "With {n} people, any pattern could be chance." |

Numbers are formatted with a sign and the unit ("+5 points out of 100"). A template is rendered only if all its values are non-null. Otherwise the next simpler template is used, down to `thin`.

### 9.11 `mechanism` — "Here's exactly how." (2 beats)

- **Beat 0 — the pipeline.** Five stations appear left→right along a tick rail, each with an icon drawn from Part 1 visuals: **PLAY** (a mini-board) → **SCORE** (a number) → **RATE** (the fader) → **SELECTED CLASSMATES** (the dial, with the hidden step highlighted in vermilion: "the only difference") → **RATE AGAIN**. A pulse travels along the rail.
- **Beat 1 — the disclosure.** Under SELECTED CLASSMATES: "Everyone saw 3 other players. **{realShown} of {peersShown}** were real classmates; **{generatedShown}** were generated scores used when there weren't enough real ones." Then the line: "Nothing you saw was fake about *your* score — only *who* you were compared with was chosen." If `generatedShown = 0`, that sentence becomes "Every one was a real classmate."
- **Why:** transparency builds trust after deception, and it teaches the methodology.
- **Fallback:** static; no data needed except the counts. Those always exist when a snapshot exists, even as 0.

### 9.12 `concept` — the textbook transition (1–3 beats, optional)

- **Appears:** a slow full-bleed dark scene. Quote text in Instrument Sans at 5–6vh, max 3 lines per beat. There's an attribution line (author, *title*, **page**) and a **concept title** at the top in display type (e.g. `SOCIAL COMPARISON THEORY`).
- **Content comes from session config only** (`presentation.concept: {title, quotes: [{text, source, page}]}`), edited in the console. **No default quote ships with the app.** Unconfigured → the scene is skipped, and the console shows "Add your textbook quote".
- **Animates:** words fade in at reading speed (about 180 wpm), or all at once in reduced-motion mode.

### 9.13 `end`

The wordmark, "**Thanks for playing.**", and a small line: "Your data stays anonymous and will be deleted at the end of term." Optional beat: "+N finished after we froze the data" (never changes charts).

---

## 10. Motion and animation system

**Rule: every motion explains a change in the data or the story.** There's no decorative looping in data scenes, apart from background grain and the hold card.

### Architecture

- **`Field` (Canvas 2D, DPR-aware):** holds one `MarkState {k, x, y, r, glyph, color, alpha}` per mark. Each scene exports `layout(data, beat, vp) → Target[]` (pure). On a state change, `Field` builds per-mark tweens from the current *rendered* positions to the new targets. That means an interrupted transition (a fast double-click) continues smoothly from wherever the dot was. It uses one `requestAnimationFrame` loop that sleeps when idle (no tweens active → no frames).
- **DOM/SVG overlay:** axes, headlines and numbers, animated with `motion` (already a dependency) for opacity, transforms and the variable-font width axis. Counters use a pure `countUp(from, to, t)` so the final value is always exact.
- **The timeline per beat** is declared data, not imperative code:

```ts
type BeatSpec = { duration: number; tracks: Track[] };  // e.g. {target:'field', at:0, dur:1200, ease:'outExpo', stagger:{by:'rank', step:40, max:1600}}
```

  Declared timelines let the console preview, the projector, the reduced-motion path and the tests all use the same numbers. Tests can call `settled()` without waiting.

### Vocabulary (consistent across scenes)

| Motion | Meaning | Easing / duration |
|---|---|---|
| **Fly** (dot changes position) | the same person, a new view of them | `outExpo`, 900–1400 ms, staggered by rank |
| **Rise** (vertical move) | a rating | `outCubic`, 800 ms |
| **Trail** (a line left behind) | a change over time | 1200 ms per lane |
| **Drain + black** | interruption / a story turn | 400 ms + 600 ms hold |
| **Split** (one becomes three) | the same thing in different contexts | `inOutQuart`, 900 ms |
| **Count-up** | a number arriving | 700 ms, ends exact |
| **Width collapse** (Anybody wdth 150→70) | emphasis on a key sentence | 500 ms |

### Reduced motion and plain mode

- `prefers-reduced-motion` on the projector **or** the console toggle `Motion: full / calm / off`. *Calm* keeps positional moves but at 1/3 duration with no stagger, drain or typing. *Off* is instant settled frames with 200 ms cross-fades.
- **Plain mode** (`F`, emergency): no canvas at all. Each scene has a `plain(data, beat)` text/number rendering, and it's always available.

---

## 11. Projector design system ("Night Broadcast — Stage")

- **Canvas:** 16:9 logical stage **1920×1080**, scaled to fit with letterboxing in ink. A **safe area** inset of 5% keeps content away from edges (some projectors overscan). Other ratios: 16:10 and 4:3 use the same stage with letterboxing, never reflowed. That keeps layouts deterministic and testable.
- **Type scale (at 1080p stage):** display 140–200 px (Anybody, 800–900, width axis 70–150), headline 72 px, body 44 px, label 32 px mono. The minimum on-screen text is **32 px at 1080p** (about 2.5 cm on a 3 m wide screen, readable at 12 m). Text in data scenes stays ≤ 12 words.
- **Color:** ink `#0B0C10` background (projectors wash out blacks, so large type is paper `#F4F1EA`, never mid-gray). World colors ice/paper/amber. Signal vermilion is used only for the turn and focus, and phosphor only for the key number. The contrast of every text/background pair is ≥ 7:1 (checked in a unit test against tokens).
- **Grain:** the Part 1 static SVG noise at 4% opacity, as a pre-rendered texture (no per-frame noise).
- **No legends:** labels sit directly on data (lane titles, line-end labels). No hover and no tooltips.
- **Layout grid:** 12 columns, 96 px gutter. Headlines sit top-left at a consistent baseline across scenes, so the eye knows where to look.
- **Density:** at most one chart per scene. Numbers shown at once are ≤ 6.
- **Watermark:** `REHEARSAL · SYNTHETIC DATA` (demo) or `TEST SESSION` (test with bots) in 32 px mono top-right, always visible. It's never shown on live.
- **Cursor:** hidden after 2 s idle. Fullscreen: a button and `F11`, plus a first-click prompt, because browsers require a gesture to enter fullscreen.

---

## 12. Presenter controls

### Console layout (`/host#present=<id>`, laptop ≥ 1280 px)

```
┌───────────────────────────────┬────────────────────────┐
│ CURRENT (live mirror, 16:9)   │ NEXT beat preview      │
│                               ├────────────────────────┤
│                               │ Notes for this beat    │
├───────────────────────────────┴────────────────────────┤
│ Scene strip: lobby · playing · hold | onegame ●●● · selfrating ●● · cut ●● · samescore ●●●● · … │
├─────────────────┬────────────────────┬─────────────────┤
│ Readiness       │ Data health        │ Controls        │
│ joined 29       │ n=27 · paired 24   │ ◀ BACK  NEXT ▶  │
│ playing 2       │ worlds 9/9/9       │ HOLD  REPLAY    │
│ done 25         │ pattern: expected  │ PLAIN  MOTION ▾ │
│ projector ● 1   │ ⚠ small group: up  │ BEGIN / RESNAP  │
└─────────────────┴────────────────────┴─────────────────┘
```

- **Current / Next** are the real scene components rendered at thumbnail scale from the same state and data (`Stage` with `scale`). What you see is what the projector draws.
- **Notes:** per-beat speaker notes from `registry.ts`, plus live-data-aware lines ("Upward group moved −6.8 — mention it before they see the chart?"). The notes say what's coming next so the presenter never gets surprised by the data.
- **Readiness** (before BEGIN): funnel, connected phones, **projectors connected** (count on `s:<id>`), session open/closed, and a checklist: *close joins · projector connected · quote configured · motion setting*.
- **Data health:** n per subset, world balance, pattern, and warnings (`small group`, `mean≠median`, `generated peers in demo`, `no valid triplet → example mode`, `stillFinishing > 20%`).
- **Scene strip:** click to `goto`. Skipped scenes are grayed out with their reason.
- **Phone layout** (< 700 px): a big NEXT / BACK pad plus HOLD and a scene name. It's the backup controller.

### Keyboard (also works with standard USB clickers)

| Key | Action |
|---|---|
| `→` `↓` `Space` `PageDown` | next beat |
| `←` `↑` `PageUp` | previous beat |
| `Shift+→` / `Shift+←` | next / previous scene |
| `B` `.` | hold / blackout toggle |
| `R` | replay current beat |
| `F` | plain mode toggle |
| `G` | focus scene strip |
| `Enter Enter` (within 2 s) | BEGIN REVEAL (from pre-reveal only) |
| `?` | shortcut overlay |

Keys are only live on the console with the lease. The projector page ignores keys except `F11` and `Esc`, so a stray keyboard on the projector can't advance anything.

---

## 13. Rehearsal / demo mode

There are two paths with different purposes.

### A. Synthetic class (fast rehearsal, no phones)

- **Allowed only on `test` sessions.** This is enforced in the command handler **and** by the SQL trigger on `reveal_snapshots`.
- Console: `Rehearse → scenario ▾ · class size ▾ (6 / 20 / 30 / 50 / 100 / 150) · seed` → `pres.demo {scenario, n, seed}` → creates a `source='demo'` snapshot and jumps to `onegame:0`. It creates **no rows in `participants`**, so it can't leak into exports or Part 1 analytics.
- `reveal/demo.ts` is a pure, deterministic `(scenario, n, seed) → SnapshotRow[]`:
  - scores ~ Normal(620, 140) clipped to [200, 1000], rounded to 5 (like real scoring granularity), plus deliberate ties;
  - stratified assignment identical to Part 1 (triplets by score) so the demo triplet exists;
  - peers drawn from the synthetic pool with `bandFor`, with 0–10% marked generated;
  - `r1 = clamp(35 + 0.04·(score−620) + N(0,14))`;
  - `r2 = r1 + effect[world] + N(0, noise)` per scenario, plus missing r2 at `missingRate`.

| Scenario | effect up / neutral / down | noise | other |
|---|---|---|---|
| `expected` | −8 / 0 / +7 | 5 | – |
| `noisy` | −4 / +1 / +3 | 12 | 10% missing r2 |
| `none` | 0 / 0 / 0 | 5 | – |
| `reversed` | +5 / 0 / −5 | 6 | – |
| `small` | −8 / 0 / +7 | 5 | forces n = 6 |
| `ties` | −6 / 0 / +6 | 6 | 60% of scores identical |
| `imbalanced` | −8 / 0 / +7 | 5 | worlds 60/25/15%, one lane nPaired = 1 |
| `lateheavy` | −8 / 0 / +7 | 5 | 40% missing r2, `stillFinishing = 12` |

- The projector watermark says `REHEARSAL · SYNTHETIC DATA · <scenario>` on every frame. It's rendered by `Stage` whenever `source === 'demo'`, and can't be turned off.

### B. Full pipeline (bots through Part 1)

- The existing test session + `bots.spawn` + `bots.advance → done` produces **real stored rows** through real assignment. BEGIN REVEAL then freezes a `source='test'` snapshot with watermark `TEST SESSION`. This is the path E2E tests use, because it exercises eligibility and freeze on actual rows.
- `bots.advance` gains an optional `effect` parameter (`expected | none | reversed`) so the pipeline can be tested with each pattern. The default stays as today.

### Rewind

`pres.rewind` (confirm) → back to `lobby`, snapshot pointer cleared, and the phones' look flag cleared. Snapshots are kept. That lets one rehearsal run the whole show several times, with different scenarios, before class.

---

## 14. Error and fallback states

| Failure | Projector shows | Console shows |
|---|---|---|
| No snapshot yet and a data scene is requested | (not possible: guard) | `NO_SNAPSHOT` toast |
| Snapshot with n = 0 | "No finished games yet." + hold sigil | "RESNAP when people finish" |
| Scene guard fails at runtime | the next valid scene (auto-skip) | "Skipped samescore: no valid triplet" |
| Invalid/missing field in `RevealData` | the scene's `plain()` rendering; if that fails, the hold card | error with the scene id; `F` suggested |
| Render exception (React error boundary per scene) | plain mode for that scene, then auto-retry on the next beat | red badge "projector fell back to plain" (reported by `/s` `status` ping) |
| Canvas unavailable / WebGL irrelevant | plain mode | – |
| Font load slow | system fallback font with `size-adjust` metrics, so there's no layout jump; fonts are preloaded in `screen.html` | – |
| Projector key wrong/rotated | "Projector link expired — open it from the presenter console" | projector count 0 |
| Server unreachable | last frame kept; tiny dim dot after 5 s | "Reconnecting…" banner |
| Presenter command rejected (`STALE`) | – (no change) | silently re-sync; if 3 in a row, a "Another console is controlling" hint |

**Formatting guard:** every visible number goes through `fmt(n: number | null, kind)`. It returns `'—'` for null or non-finite values and never returns `NaN`/`undefined`. A unit test renders every scene × every scenario × every beat to static markup and asserts that the output contains no `NaN`, `undefined`, `null`, `Infinity` or `[object`, and no empty headline. The same assertion runs in E2E on the live DOM.

---

## 15. Changes recommended to the concept (and why)

1. **Put "same score" before the conditions reveal, and use a real stratified triplet.** The brief placed it after the before/after chart. Part 1's stratification already creates three near-identical-score classmates assigned to three different worlds. Showing their three dials is the clearest, truest introduction to the manipulation, so the group charts that follow are understood as "three rooms like these". Example mode covers classes where it isn't valid.
2. **Add the "matched scores" beat (`worlds` beat 1).** Before any rating change is shown, prove that the three groups performed the same. That pre-empts the obvious objection ("the upward group just did worse") and is true by design.
3. **Show individuals before averages** (`movement` before `compare`). Averages alone overstate uniformity. Showing trails going both ways teaches variation and keeps us honest.
4. **Drop the leaderboard scene.** Part 1 didn't collect a leaderboard preference, and showing ranks conflicts with the low-stakes design.
5. **Disclose generated peers, with numbers.** The brief says "no fake scores". Part 1 permits generated peers to fill gaps in small classes. The honest resolution is (a) exclude them from every class visualization, and (b) disclose the exact count in `mechanism`. **Recommendation for the live class:** keep `ghostPolicy: 'fill'` (with 25 players, `off` degrades some sets), but plan the debrief line. If the instructor prefers zero generated peers, switch to `off` in the session config. Part 2 handles both.
6. **Phones do not mirror the reveal.** They say "look up". Mirroring invites looking down, and the brief's own staging (a projector story) is stronger with one focal screen. Phones become interactive in Part 3 (§20).
7. **Plain language for 0–100.** Students never saw numbers on the fader. The projector presents ratings as "points out of 100 on the slider" and shows the fader's own end labels, so the numbers don't feel made up.
8. **A stronger central line:** keep `ONE GAME. THREE SOCIAL REALITIES.` as the `worlds` headline (it's strong and fits). Use `YOU DIDN'T ALL SEE THE SAME CLASSMATES.` as the turn, which is more concrete than "you did not all see the same results" (they did see their own same-rules score).

---

## 16. Testing strategy

### Unit (Vitest + fast-check)

- `eligibility`: kinds, removed, invalid flags, missing score, test vs live bots, and the counts of each exclusion reason.
- `derive`: means, medians, deltas and moved counts against hand-computed fixtures. It is also **cross-checked against Part 1 `hostView.internals.summary`** for the same DB, so the two must agree. It covers ties, extremes (200/1000), all-identical, empty worlds, single-member worlds and missing r2.
- **Property tests** (n ∈ 0..200, random worlds/missing): `derive` never throws, all numbers are finite or null, `paired ≤ assigned ≤ eligible`, and `sum(moved) = nPaired`.
- `copy`: each `pattern` classification at its boundary values, templates never rendered with null, and the "no causal words" lint (the copy strings don't contain "caused", "proves", "because of", "significant").
- `samescore` selection: prefers the smallest range, all-real peers and near-median. It falls back to example, then illustration, then skip.
- `demo`: deterministic for the same seed, scenario properties hold (e.g. `none` → |mean Δ| < 2 at n = 100), and there's never an id or codename.
- Reducer: every command from every state. `STALE`, `NOT_CONTROLLER`, `GUARD`, `NO_SNAPSHOT`. `prev` never crosses into pre-reveal. Auto-skip over failing guards. `begin` twice is idempotent.
- Layout functions (`beeswarm`, `lanes`, `scatter`, `triplet`): all positions stay inside the safe area for n up to 200 at every viewport, with no overlaps above a threshold.
- `fmt` and the static-render sweep (§14): every scene × beat × scenario has no `NaN`/`undefined`.
- `assertPublic`: the whitelist snapshot, and a planted id/codename is stripped.

### Integration (real server on an ephemeral port, as in `tests/integration`)

- Presenter `pres.next` → the projector socket receives `screen` with the new `rev` in < 100 ms. The presenter's own `presenterView` matches.
- The projector disconnects mid-scene, the presenter advances 3 beats, and the projector reconnects → it gets the current scene and beat directly, and `data` only if its hash is missing.
- Presenter reconnect keeps the lease. A second console gets `NOT_CONTROLLER` until `take`, then the first becomes an observer.
- Two `next` with the same `rev` → exactly one advance.
- **Freeze:** begin reveal → a participant submits `rateAfter` → the snapshot hash is unchanged, `stillFinishing` was counted at freeze, and export contains the new rating.
- The immutability trigger rejects `UPDATE`. The demo on a live session is rejected by both the handler and the trigger.
- The `/s` handshake with a wrong key is rejected, and rotation disconnects old screens.
- Privacy: `data_json` contains no pid, codename or token hash. The participant `view` gets only `room.screen`.
- Session reset/delete cascades presentations and snapshots.

### End-to-end (Playwright)

A new project `projector` (desktop Chromium 1920×1080) plus a WebKit variant:
1. Create a test session, spawn 24 bots, advance them to `done` with `effect: expected`, plus **one real mobile participant** through the full Part 1 flow.
2. The console (context A) opens Present. The projector (context B) opens the link from the console.
3. BEGIN REVEAL → the phone shows "Eyes up here". Step through **every beat with the keyboard**, asserting `data-scene`/`data-beat` on the projector, the key text per beat (headline, n, world labels, numbers equal to the derived fixture), and the no-`NaN` sweep.
4. Reload the projector mid-`movement` → the same beat. Reload the console → the lease is kept.
5. Repeat quickly with demo scenarios `noisy`, `none`, `reversed`, `small`, `ties`, asserting the adaptive headline for each.
- **Screenshots:** `?still=1` renders settled frames. There's one `toHaveScreenshot` per scene, at 1920×1080, 1366×768, 1280×800 (16:10) and 1024×768 (4:3), with a small pixel tolerance. The baselines are reviewed by hand once.
- **Browsers:** projector in Chromium + WebKit (Safari on the instructor's Mac). Console in Chromium. Phones stay on the existing mobile projects.

### Performance

- `tests/perf/projector.spec.ts`: demo n = 20 / 50 / 100 / 150. Step through all beats while recording `requestAnimationFrame` deltas via a test hook. Budget: **p95 frame ≤ 20 ms, max ≤ 50 ms** on CI hardware at 1080p; 4K is run locally only.
- `sim --reveal`: 100 socket participants + 3 projectors + 2 consoles, 60 beats at 300 ms intervals. Broadcast p95 ≤ 50 ms locally, no dropped state.

---

## 17. Performance strategy

- **Canvas for marks** (≤ 200 circles/glyphs, plus ≤ 200 trail segments): one clear and one draw pass per frame, well under 2 ms. Glyphs are pre-rendered to offscreen sprites per color/radius. Trails in `movement` are drawn once to a cached layer after their tween ends.
- **DOM for type** (≤ 20 elements per scene). Animate only `transform`, `opacity` and `font-variation-settings` on large headlines (the width axis is animated only on ≤ 2 elements at once).
- Idle projector = **0 frames** (the rAF loop stops). The hold card uses one CSS animation.
- `RevealData` is ≤ 30 KB at n = 150, sent once per hash, and gzip is enabled on Socket.IO. Beat updates are ≈ 150 bytes.
- The screen bundle is lazy per scene group (pre-reveal vs reveal) and preloaded after connect. The target is ≤ 120 KB gz for the first scene.
- Server: presentation commands are a single-row update plus log insert (< 1 ms). The freeze is < 5 ms at 150. There's no per-beat analytics.

---

## 18. Implementation order

Each step ends green (typecheck, test, build, bundle check).

1. **Data layer:** migration 2 (tables and triggers), `shared/reveal.ts` types, `eligibility`, `derive`, `copy`, `demo`, and all unit and property tests. *Nothing visual yet; this is the correctness core.*
2. **State machine:** `registry`, `services/presentation.ts` reducer (lease, rev, guards, begin/resnap/rewind/demo), reducer tests.
3. **Transport:** `/s` namespace, `pres.*` on `/h`, `hub.pushPresentation`, `room.screen` on participant views, `GET /screen/:code`, and integration tests.
4. **Screen shell:** `screen.html` entry, `Stage` (scale, safe area, watermark, hold, plain), connection, clock offset, data cache, scene router with `plain()` for every scene. *At this point the whole show works in plain mode*, which is also the emergency path.
5. **Presenter console:** layout, scene strip, readiness, data health, keyboard, lease UI, projector link/QR, BEGIN pre-flight, phone pad.
6. **Field + motion core:** Canvas `Field`, tween engine, `BeatSpec` timelines, reduced/calm/off, `?still=1`.
7. **Scenes, in story order:** lobby/playing/hold → onegame → selfrating → cut → worlds → movement → compare → samescore → mechanism → concept → end. Each scene gets its layout unit tests plus a screenshot.
8. **Phones:** `Done` look-up state and the banner for late players. Bundle check.
9. **E2E + perf + viewport screenshots**, `sim --reveal`, WebKit.
10. **Rehearsal polish:** scenario picker, `bots.advance effect`, runbook update in README.

---

## 19. Acceptance criteria

1. A presenter can run the full reveal from BEGIN to END with only a keyboard or clicker. Every beat appears on the projector ≤ 150 ms after the key press on the same network.
2. Refreshing the projector at any beat restores the same scene and beat in ≤ 1.5 s with no replay of earlier beats. Refreshing the console doesn't change the projector.
3. Two consoles: only the lease holder can advance. A double key-press advances exactly one beat.
4. After BEGIN, new ratings never change any projector number, and exports still include them.
5. The projector never shows a codename, sigil tied to data, id, an individual's rating, `NaN`, `undefined`, or an empty frame. This is enforced by tests.
6. Every number on the projector equals `derive()` output, which matches the Part 1 `hostView` summary for the same data.
7. The adaptive copy matches the data pattern for all rehearsal scenarios, and no causal or significance language appears.
8. Demo data can't be created on a live session. Rehearsal and test frames always carry a watermark.
9. Participant phones show "look up" after BEGIN, and the participant bundle check stays green.
10. Readable at 1920×1080, 1366×768, 16:10 and 4:3. Text ≥ 32 px at 1080p. p95 frame ≤ 20 ms at 100 marks.
11. Plain mode (`F`) works for every scene and survives refreshes.
12. The `concept` scene shows only instructor-entered quotes, and skips when none are configured.

---

## 20. Major risks and Part 3 extension points

| Risk | Mitigation |
|---|---|
| The live data shows no effect, or the reverse | Adaptive copy (§9.10), presenter notes with talking points for each pattern, and rehearsal of `none` and `reversed` beforehand. A "null" result is framed as a real finding. |
| A tiny or unbalanced class | `thin`/`small` handling, demo example mode, and lane-level "too few" states. |
| A student recognizes their dot, or the triplet | Only scores are shown, never ratings. Example mode is used for small classes, and the presenter can skip. |
| The projector laptop's browser is old, or Safari quirks | WebKit E2E, Canvas 2D only (no WebGL), plain mode as a universal fallback. |
| Classroom Wi-Fi blocks WebSockets | Socket.IO polling fallback, already proven in Part 1. |
| The presenter clicks too fast or gets lost | Next-beat preview, notes, the scene strip, and `prev` within the reveal. |
| Render restarts mid-class | State and snapshot are persisted, and all clients reconnect to the same beat. |
| Deception discomfort | The mechanism scene fully discloses, and the end scene states the data policy. |
| Scope creep into animation polish | The build order puts plain mode first. Every scene is shippable before its motion is. |

### Part 3 seams (not planned in depth)

- **`registry.ts` is open:** new scenes (poll, discussion prompt, scenario) are added as registry entries with guards and beats.
- **`view.prompt`** on participant views (reserved): a scene can declare `phonePrompt: {kind:'poll'|'text', id}`, and phones render it. Responses go through a future `/p` command into a new `responses` table keyed by scene id.
- **`RevealData` is versioned** and can gain sections (e.g. poll aggregates) without breaking stored snapshots.
- A **reflected appraisal** activity can reuse the snapshot rows (score, r1, r2, world) through a new derived section.

---

## THE REVEAL, SECOND BY SECOND

Assumes about 27 participants, pattern `expected`, full motion. t = 0 is the BEGIN REVEAL press. "▶" = a presenter key press. The times after each ▶ are relative to that press. The pauses between presses are for talking and are only suggestions.

| Time | Presenter | Projector | Audience sees / hears |
|---|---|---|---|
| −60 s | Console shows `hold`. Closes joins, checks pre-flight (✔ 25 done · 2 playing · projector ●). | "Hold on to what you felt." with sigil loop, "25 / 27 finished". | Phones: "Look at the main screen." |
| **0.0 s** | **▶ BEGIN REVEAL** (hold 1.2 s) | Snapshot frozen. Hold card fades. | Phones dim to "Eyes up here ↑". |
| 0.0–0.8 | – | Constellation points converge to the center. | Anticipation. |
| 0.8–2.2 | – | Points burst into the beeswarm along the score axis, staggered by rank. | Their own dots landing. |
| 2.2–3.0 | – | `ONE GAME.` slams in (width collapse). | "Everyone played the same game." |
| ~15 s | ▶ | Axis ticks light up. IQR band fades in. "27 of you. Scores from 312 to 941." | The spread. |
| ~25 s | ▶ | The vermilion scan line sweeps left→right (1.2 s), and dots flash as it passes. "Scored the same way — by the server." | Fairness established. |
| ~35 s | ▶ | Dots rise vertically to their first ratings (0.8 s). Fader labels appear on Y. `THEN YOU RATED YOURSELF.` | The scatter. |
| ~50 s | ▶ | Average-rating band fades in. "Room average: 58 / 100." Optional correlation line. | – |
| ~65 s | ▶ | **The cut:** field drains (0.4 s) → black (0.6 s) → typed `ONE THING WAS NOT THE SAME.` (1 s). | Silence. Grain. |
| ~75 s | *(presenter pauses 5–10 s)* ▶ | `YOU DIDN'T ALL SEE THE SAME CLASSMATES.` at 18vh, width collapse, vermilion rule. | The turn. Murmurs. |
| ~90 s | ▶ | One large tuning dial. The needle swings to 742. "Three of you scored about 740: 738 · 742 · 745." | The familiar dial. |
| ~100 s | ▶ | The dial splits into three (0.9 s). The needles settle at 738 / 742 / 745. | – |
| ~108 s | ▶ | Peers slide in: higher on the left, similar in the center, lower on the right. Captions: *saw higher · saw similar · saw lower*. | "That's what I saw!" |
| ~120 s | ▶ | Dials dim. `SAME SCORE.` · `DIFFERENT CONTEXT.` · `DIFFERENT MEANING.` (450 ms apart). | The thesis. |
| ~135 s | ▶ | Full field returns. Dots fly into three lanes (1.6 s total stagger). Glyphs and colors appear. `ONE GAME. THREE SOCIAL REALITIES.` | Everyone was sorted. |
| ~150 s | ▶ | Lane bases count up n = 9 · 9 · 9 and average scores 683 · 679 · 686. "Same kinds of scores in every group." | The groups were matched. |
| ~160 s | ▶ | Split-flap labels: UPWARD · LATERAL · DOWNWARD COMPARISON. | The vocabulary. |
| ~175 s | ▶ | Lanes become BEFORE rails. `AFTER SEEING YOUR CLASSMATES, YOU RATED YOURSELF AGAIN.` | – |
| ~185 s | ▶ | Dots travel to AFTER, lane by lane (3 × 1.2 s), leaving trails. | Individual movement. |
| ~200 s | ▶ | Tallies: ▲ rose · ■ held · ▼ fell per lane. | Variation. |
| ~210 s | ▶ | Trails fade. Average slopes draw. Mean change counts up: −6.8 · +0.4 · +5.1. | The group tendency. |
| ~225 s | ▶ | The three slopes slide together onto a shared zoomed chart, with a thumbnail of the 0–100 scale. | The comparison. |
| ~235 s | ▶ | `SAME GAME. THE JUDGMENTS MOVED APART.` plus the supporting sentence with real numbers. | The result, in words. |
| ~250 s | ▶ | `One class · 24 people · descriptive, not proof`. | Honesty. |
| ~265 s | ▶ | Pipeline stations draw left→right. A pulse travels, and SELECTED CLASSMATES glows vermilion. | How it worked. |
| ~280 s | ▶ | "41 of 45 were real classmates; 4 were generated…" | Full disclosure. |
| ~300 s | ▶ | Concept scene: `SOCIAL COMPARISON THEORY`. The quote fades in at reading speed, with author and page. | The textbook link. |
| ~330 s | ▶ | End: "Thanks for playing." | – |

Total ≈ 5–6 minutes of screen time plus discussion. Reduced-motion or *calm* keeps the same beats with shorter or instant transitions.

---

## PART 2 DEFINITION OF DONE

- [ ] Migration 2 (`presentations`, `reveal_snapshots` with immutability and demo triggers, `presentation_log`) is shipped, and reset/delete cascade to it.
- [ ] `eligibility`, `derive`, `copy` and `demo` are pure, versioned (`reveal@1`) and fully unit- and property-tested. `derive` agrees with the Part 1 host summary.
- [ ] The presentation reducer with `rev` preconditions, the lease, guards, auto-skip, begin/resnap/rewind/demo, hold, plain and replay is complete and tested.
- [ ] The `/s` projector namespace with a per-session rotatable screen key, and `pres.*` commands on `/h`, are working. Phones get only `room.screen = 'look'`.
- [ ] The `screen.html` projector renders all 13 scenes (both animated and plain), with a watermark on test/demo and deterministic settled frames.
- [ ] The presenter console has current/next preview, notes, scene strip, readiness, data health, keyboard/clicker controls, a phone backup pad and the projector link/QR.
- [ ] The BEGIN REVEAL freeze is proven immutable against late ratings (integration test).
- [ ] Privacy: no ids, codenames or individual ratings in projector data. `assertPublic` is enforced, and the participant bundle check is green.
- [ ] Rehearsal: 8 synthetic scenarios, allowed only on test sessions. Full-pipeline rehearsal with bots is supported, including `effect`.
- [ ] No `NaN`/`undefined`/blank frames for any scene × beat × scenario (static sweep and E2E).
- [ ] E2E: the full Part 1 flow (bots plus one phone) → reveal → every beat, with reloads, in Chromium and WebKit. Screenshots at 1920×1080, 1366×768, 1280×800 and 1024×768.
- [ ] Performance: p95 frame ≤ 20 ms at 100 marks, and the `sim --reveal` broadcast budget is met.
- [ ] README runbook: rehearsal steps, the classroom checklist (close joins → connect projector → BEGIN), and emergency keys.
- [ ] Typecheck, unit, integration, E2E, bundle check and CI all pass. Deployed to Render and rehearsed once on the real projector.
