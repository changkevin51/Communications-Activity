# Signal Shift — Part 3 Implementation Plan (Discussion: the class reasons with its own experience)

Part 1 made the class *feel* social comparison without knowing it. Part 2 showed them what happened, on the projector, from a frozen snapshot. Part 3 is the discussion lead's roughly 15 minutes that turn "huh, that happened to me" into reasoning about **social comparison, reference groups, reflected appraisal, and the systems that choose our comparisons**.

The build extends the same Fastify + Socket.IO + `node:sqlite` service, the same `presentations` state machine, the same presenter console, the same projector `Stage`, and the same "Night Broadcast" visual language. It adds exactly one new capability: **the presenter can briefly turn phones into a private input device, freeze what comes back, and reveal it on the projector as discussion material.***

> Status: plan only. Nothing here is implemented yet. This plan was written after reading the code on `main` at `1216670` (PR #3 merged) and running the full check suite, not just after reading `plan2.md`.

The standard this plan holds itself to:

> "I would rather have 4 exceptional interactive moments than 10 mediocre polls."

So the plan has **three core phone interactions, one optional one, and two projector-only moments**. Every interaction below has to justify why software beats a show of hands, and several ideas from the brief are cut or folded together (see WHAT I WOULD CUT).

---

## 0. Decisions this plan makes

| Topic | Part 1/2 reality (inspected) | Part 3 decision |
|---|---|---|
| Where Part 3 lives | `SCENES` in `src/shared/reveal.ts` is one ordered list: pre-reveal (`lobby/playing/hold`), then reveal scenes ending in `mechanism → concept → end`. Navigation, skip guards, the scene strip and the log all work off that list. | **Part 3 scenes are new registry entries inserted between `mechanism` and `end`** (`concept` is replaced by per-concept quote slots). No second state machine, no second presenter app. One clicker drives the whole 20 minutes. |
| Phone input | Phones only get `view.room.screen = 'look'`. `plan2.md §20` reserved `view.prompt`, but it was never built. `Done.tsx` is terminal. | Add **`view.room.prompt`** (the open question, if any, and whether *this* phone already answered). `Done.tsx` becomes the passive "Discussion in progress. Look up." screen, and a new `Prompt` screen mounts over it only while a question is open. |
| Where prompt copy lives | `tests/bundle/forbidden-words.ts` fails the build if participant chunks contain `upward`, `downward`, `reference group`, `social comparison`, `experiment`, `condition`, etc. | **All Part 3 copy lives server-side** (`src/server/discussion/content.ts`) and goes over the wire only when a prompt opens. The participant bundle contains *renderers* (choice list, slider), never question text. The bundle check stays green with no allow-list changes. Phone copy avoids theory vocabulary anyway: the projector names the concept, and phones stay plain. |
| Freezing | Part 2 freezes a `reveal_snapshots` row at BEGIN (immutable trigger, hash, demo guard). | Same pattern per question: **closing a question freezes an immutable `prompt_results` row** (aggregates only, hashed). The projector only ever renders frozen results. Late answers are stored but never move a chart. |
| Privacy | Projector payloads pass `assertPublic()` (strict zod). No names, no codenames. | Part 3 payloads get their own strict schema (`assertPublicPrompt`). Aggregates only, **small-cell suppression** (§11), no free text anywhere, and "Prefer not to say" on the one question that touches real life. No new deception, no fabricated peer judgments. |
| Rehearsal | 8 deterministic synthetic reveal scenarios, test sessions only, guarded in SQL. | Extend the same `demo` command with deterministic **Part 3 response profiles** (`expected`, `onesided`, `split`, `low`, `unexpected`, `optionalzero`; §16) and class sizes 12/30/60. Same trigger-style guard. |
| Realtime | Full-state pushes (`pushPresentation`, `pushSessionViews`), `rev` preconditions, lease, persisted state. | **Reuse it as is.** Opening or closing a question is just another presenter command that changes persisted state and triggers `pushSessionViews`. Answers are a new `/p` command with an idempotency key. No polling, no event queue. |
| Content | `concept_json` holds one title and ≤ 3 quotes, edited in the console. | A **typed TypeScript config** for scenes, prompts, choices, notes and timing, plus **quote slots** per concept that stay *empty placeholders* until the author fills them (in the file or in the console). No quotes are invented. No CMS. |

---

## 1. Assessment: was Part 2 implemented successfully?

**Verdict: yes. The Part 2 core is implemented, tested and working.** Validated on `1216670` with Node 24: `typecheck` clean, **74/74** Vitest tests, `build`, `check:bundle`, and **10/10** Playwright tests (projector walkthrough, adaptive scenarios and presenter keyboard in Chromium **and** WebKit; participant happy path on mobile Chromium and WebKit). I also looked at the E2E projector frames for every beat of the `expected` rehearsal.

### 1.1 Implemented as planned

| plan2.md item | Where it is | Status |
|---|---|---|
| Migration 2: `reveal_snapshots` (immutable trigger, demo-on-live trigger), `presentations`, `presentation_log`, cascade on reset/delete | `src/server/db/schema.ts`; test `reset clears presentation and snapshots` | Done |
| Pure `eligibility` / `derive` / copy / `demo`, versioned (`REVEAL_VERSION`); derive agrees with the Part 1 host summary | `src/server/reveal/*`, `src/shared/revealCopy.ts`; `tests/unit/reveal.test.ts`; integration `derive agrees…` | Done |
| Reducer with `rev` preconditions, lease, guards, auto-skip, begin/resnap/rewind/demo, hold, plain, replay, motion, auto-follow | `src/server/services/presentation.ts` `command()` | Done |
| `/s` read-only namespace, per-session rotatable screen key, key stripped from the URL, `pres.*` on `/h` | `src/server/sockets/screen.ts`, `presenter.ts`, `src/screen/ScreenApp.tsx` | Done |
| Phones get only `room.screen = 'look'`; "Eyes up here" and the late banner | `src/server/views.ts`, `Done.tsx`, `App.tsx` | Done |
| 13 scenes, animated and plain, watermark on test/demo, hold blackout | `src/screen/Stage.tsx`, `targets.ts`, `Decor.tsx`, `plain.ts` | Done |
| Presenter console: current + next preview, notes, scene strip with skip reasons, readiness, data health and warnings, keyboard/clicker map, lease UI, projector link, phone QR, BEGIN/RESNAP/REWIND hold buttons, rehearsal, concept editor | `src/host/presenter/*` | Done |
| Freeze proven immutable against late ratings | integration `late ratings do not change the frozen data; UPDATE is rejected` | Done |
| Privacy: no ids/codenames/individual ratings in projector data, `assertPublic`, bundle check | `src/server/reveal/public.ts`, `tests/bundle` | Done |
| 8 rehearsal scenarios, test-only; `bots.advance` with `effect` | `demo.ts`, `services/bots.ts` | Done |
| No `NaN`/`undefined`/blank frames (every scenario × size × scene × beat) | `tests/unit/screen.test.ts`, E2E `sane()` | Done |
| README runbook: rehearsal, classroom checklist | `README.md` "Projector reveal (Part 2)" | Done |
| `sim --reveal` | `tests/sim/sim.ts` | Done |

### 1.2 Implemented differently or simplified (acceptable, but worth knowing)

| plan2.md said | What the code does | Impact on Part 3 |
|---|---|---|
| `cut` beats: "ONE THING WAS NOT THE SAME." → "YOU DIDN'T ALL SEE THE SAME CLASSMATES." | "THEN YOU SAW OTHER PLAYERS." → "WHO LOOKED AT THE OTHER SCORES? Be honest." The actual disclosure lands two scenes later in `worlds` ("YOU WERE SORTED INTO THREE ROOMS."). | Works narratively. But Part 3's first question ("did it work on you?") depends on everyone understanding the manipulation, so **`mechanism` must stay core**, and the Part 3 `bridge` notes restate it in one sentence. |
| `samescore` as three tuning dials that split apart | Three bordered boxes with big score numbers and the peer scores listed | Legible. Part 3's `switch` deliberately reuses this **three-column "same number, different room"** composition as a visual rhyme. |
| `mechanism` as an animated pipeline of stations | A text headline, one line of disclosure and a faint field | Legible. Part 3's `chooser` moment (§7.5) is the right place to finally draw the pipeline, because that's where the class reasons about it. |
| `onegame` scan line and IQR band; `lobby` constellation | Axis and average marker only; lobby is QR + code | Cosmetic. Not needed for Part 3. |
| `movement` beat 2 tallies ("▲ rose · ■ held · ▼ fell") | Tallies appear only in **plain** mode; animated beat 2 is the headline and dots | Minor, but Part 3's felt-vs-measured beat refers back to these numbers. Pre-Part-3 fix #4. |
| `hold` scene "Hold on to what you felt." with finished count | "EYES UP HERE / Stand by." | Cosmetic. |
| Phone backup layout (< 700 px NEXT/BACK pad) | Console collapses to one column under 900 px; no dedicated pad | Part 3 adds more buttons, so this matters more now (§6.4). |

### 1.3 Planned but not implemented

| plan2.md item | Status |
|---|---|
| `toHaveScreenshot` baselines at 1920×1080, 1366×768, 1280×800, 1024×768 | **Missing.** The E2E test only writes PNGs for manual inspection, at 1920×1080. No visual regression, no other viewports. |
| `tests/perf/projector.spec.ts` (p95 ≤ 20 ms at n = 20/50/100/150) | **Missing.** The walkthrough records rAF deltas and only asserts p95 < 100 ms, in Chromium. |
| `?still=1` projector query for settled frames | **Missing** on `/screen`. `still` exists only as a `Stage` prop used by the console previews. |
| E2E with **one real phone** through Part 1 that then sees "Eyes up here" during the reveal | **Partial.** Covered at integration level (`get a neutral look flag after BEGIN…`). E2E covers the phone flow and the projector separately, never together. |
| Live-data-aware notes for every scene | Only `movement`, `compare`, `samescore`, `onegame`. Enough. |
| Readiness checklist (close joins · projector · quote · motion) | Only the "Close joins before BEGIN." warning and the projector indicator. Enough. |

None of these block Part 3. The first three become part of Part 3's testing work (§17), because Part 3 adds more projector frames that need the same coverage.

### 1.4 Architectural constraints and pre-Part-3 fixes

These come from reading the code, and each one shapes the Part 3 design:

1. **`resnap` teleports to `onegame:0`.** `command()` sets `scene: 'onegame'` on `resnap`. Harmless in Part 2, dangerous in Part 3: a mis-held RESNAP during discussion would throw the projector back ten minutes. **Fix:** hide RESNAP once a Part 3 scene has been reached (`presentations.part3_at` is set), and reject it server-side with `GUARD`.
2. **`rewind` clears the snapshot but knows nothing about questions.** `rewind` must also bump the session's `run` counter so a rehearsal can be re-run cleanly without deleting evidence (§12).
3. **`pres.concept` and `pres.rotateKey` don't check the lease.** Any authenticated console can edit the quote or rotate the key while another console drives. Low risk with one presenter, but Part 3 adds more config editing. **Fix:** require the lease for writes, like `pres.cmd`.
4. **Animated `movement` beat 2 has no numbers.** Add the tally line as a caption (it already exists in `plainFrame`).
5. **`goto` refuses to cross pre-reveal ↔ reveal, and `end` is terminal.** Good. Part 3 scenes are all `needsSnapshot: true`, so they inherit "BEGIN REVEAL first" for free, and the strip shows the whole show.
6. **Beats are static per scene (`beatsFor`) with data guards.** Part 3 needs beats that depend on the *question's* state (open → frozen → revealed). §4 keeps beats static and makes the question's phase a function of the beat, so `nextPos/prevPos` stay pure and the clicker keeps working.
7. **Session-wide phone pushes already exist** (`hub.pushSessionViews`, triggered by `lookChanged`). Part 3 generalizes `lookChanged` into `phonesChanged`. At 60 phones that's 60 `buildView` calls per open/close, well within budget.
8. **The participant outbox retries without an idempotency key** (`src/client/net/connection.ts`). Fine for stage transitions (idempotent by stage), not for answers. Part 3 answers carry a client-generated `rid` and are unique per `(prompt, run, participant)`.
9. **Some phones are still mid-game.** `App.tsx` routes by `stage`. A Part 3 prompt must never interrupt someone who is still playing or rating in Part 1; they keep the late banner. Only `done` phones (and, for prompts that don't need Part 1, `joined` phones that never played) see prompts.
10. **The concept slide is a single slot.** Part 3 needs one quote slot per concept. `concept_json` grows into `{ slots: Record<SlotId, Quote> }`, and the old `{title, quotes}` shape is still read.

---

## 2. Part 3 architecture

```
Presenter console (/host#present=<id>)      Projector (/screen/<CODE>)            Phones (/<CODE>)
  Question panel: state, count,               Stage: existing scenes +              Done -> "Discussion in progress. Look up."
  CLOSE / REVEAL / HIDE / PASSIVE / SKIP      discussion renderers                  Prompt (only while a question is open)
        | pres.cmd {t:'q', ...}                      ^ screen state + result hash          ^ view.room.prompt
        v                                            | (fetched by hash, like RevealData)  | answer {rid, ...}
+----------------------- one Node 24 process, one SQLite file -----------------------------------+
| services/presentation.ts  reducer: + Part 3 scenes; question phase derived from (scene, beat)  |
| services/discussion.ts    open / close / freeze / answer / liveCount / phonePrompt             |
| discussion/content.ts     typed show config (scenes, prompts, choices, notes, timing, slots)   |
| discussion/aggregate.ts   pure: responses -> PromptResult (suppression, rounding)              |
| discussion/public.ts      assertPublicPrompt (strict zod)                                      |
| tables: prompt_runs . responses . prompt_results (immutable)                                   |
+------------------------------------------------------------------------------------------------+
```

| File | Change |
|---|---|
| `src/shared/discussion.ts` | Types only: `PhonePrompt` (what a phone sees), `PromptResult` (what the projector sees), `QuestionPhase`. No copy. |
| `src/server/discussion/content.ts` | The show, as typed config (§5). Server-only, so theory words are allowed. |
| `src/server/discussion/aggregate.ts` | Pure aggregation and suppression. Unit and property tested. |
| `src/server/discussion/demo.ts` | Deterministic response profiles. |
| `src/server/discussion/public.ts` | `assertPublicPrompt`. |
| `src/server/services/discussion.ts` | `openQuestion`, `answer`, `freezeQuestion`, `liveCount`, `phonePrompt(db, pid)`. |
| `src/shared/reveal.ts` | New `SceneId`s and `SCENES` entries; `part: 2 \| 3` and `q?: PromptId` on `SceneSpec`. |
| `src/server/services/presentation.ts` | New commands, question side effects on `next/prev/goto`, resnap guard, `phonesChanged`. |
| `src/server/views.ts` | `room.prompt`; `room.screen: 'look' \| 'discuss'`. |
| `src/server/sockets/participant.ts`, `src/shared/protocol.ts` | `answer` command and its `AnswerReq` schema. |
| `src/client/screens/Prompt.tsx`, `src/client/ui/Choice.tsx`, reuse `ui/Fader.tsx` | Phone input. |
| `src/client/screens/Done.tsx` | Passive discussion state. |
| `src/screen/discussion/*` | Projector renderers per result kind. |
| `src/host/presenter/Question.tsx` | Console question panel. |
| `src/server/db/schema.ts` | Migration 3 (§12). |

---

## 3. The discussion arc

The brief's seven-step progression, tightened into five moves of reasoning plus a synthesis. Each uses the class's own Part 1/2 experience as the anchor, and each gives the presenter a *surprising or contestable* image to ask "why?" about.

| # | What the class reasons about | Anchor | Phone? | Scene |
|---|---|---|---|---|
| 1 | **Did the comparison actually affect *me*?** (felt vs measured) | Their own recap and the Part 2 movement chart | Yes (core) | `felt` |
| 2 | **Does the same result mean something different when the comparison group changes?** (reference groups) | One fixed result rated in three rooms | Yes (core) | `switch` |
| 3 | **Which comparisons run my real life?** | Low-risk categories | Yes (optional) | `landscape` |
| 4 | **Is "how I compare with them" the same as "how I think they see me"?** (social comparison vs reflected appraisal) | A fictional student, Alex | Yes (core) | `mirrors` |
| 5 | **Who chose your comparison today, and who chooses it online?** | The app's own mechanism | No | `chooser` |
| 6 | **Synthesis.** | Their own score beeswarm, returned | No | `circle` → `end` |

Why this order: it starts with the most personal and immediate thing (how they felt five minutes ago), moves to a controlled hypothetical (the switch), optionally to real life, then introduces the *second* concept (reflected appraisal) by contrast with the first, and ends by zooming out to systems. Each step answers the previous step's "so what?".

Mapping to the brief's progression: "Did it affect you?" → `felt`. "Who becomes a reference group?" and "What happens when it changes?" → `switch` (merged). "Which groups matter in real life?" → `landscape` (optional) plus the `switch` discussion. "Social comparison vs reflected appraisal" → `mirrors`. "How digital systems shape comparison" → `chooser`. "Final synthesis" → `circle`.

---

## 4. Discussion state machine

Part 3 does **not** add a second state machine. It adds scenes to the existing registry, and a question's phase is a **pure function of `(scene, beat)`** plus persisted question state. That keeps `nextPos/prevPos` pure, keeps the clicker working, and makes refresh recovery trivial.

### 4.1 Registry additions

```ts
// src/shared/reveal.ts (additions)
export type SceneId = /* existing */ | 'bridge' | 'felt' | 'switch' | 'landscape' | 'mirrors' | 'chooser' | 'circle';

// inserted after 'mechanism'; 'concept' is retired in favour of per-concept quote beats
{ id: 'bridge',    beats: 1, needsSnapshot: true, optional: false, part: 3, title: 'Now you' },
{ id: 'felt',      beats: 4, needsSnapshot: true, optional: false, part: 3, title: 'Did it work?', q: 'felt' },
{ id: 'switch',    beats: 5, needsSnapshot: true, optional: false, part: 3, title: 'Same result',  q: 'switch' },
{ id: 'landscape', beats: 3, needsSnapshot: true, optional: true,  part: 3, title: 'Real life',    q: 'landscape' },
{ id: 'mirrors',   beats: 5, needsSnapshot: true, optional: false, part: 3, title: 'Two mirrors',  q: 'mirrors' },
{ id: 'chooser',   beats: 3, needsSnapshot: true, optional: false, part: 3, title: 'Who chose?' },
{ id: 'circle',    beats: 3, needsSnapshot: true, optional: false, part: 3, title: 'Full circle' },
{ id: 'end', ... }
```

Optional scenes are toggled per session in the console (stored in `presentations.flags_json`; `landscape` defaults **off**, Part 2's `samescore` defaults on). `skipReason` returns `'optional (off)'` and the strip greys them out, the same way it already does for `samescore`/`concept`.

### 4.2 Beat roles

Each beat of a Part 3 scene declares a role in `content.ts`:

| Role | Phones | Projector | Question phase |
|---|---|---|---|
| `show` | Passive | Setup card or a projector-only frame | – |
| `ask` | Prompt open, accepting answers | The question and a live **count only** ("23 answered") | `open` |
| `reveal` | Passive ("Look up") | The frozen result | `frozen`, visible |
| `discuss` | Passive | Result stays; the discussion headline appears; optional highlight | `frozen` |
| `concept` | Passive | Concept name + author-supplied quote slot (skipped if the slot is empty) | `frozen` |

Entering an `ask` beat **opens** the question (unless already frozen). Leaving it **forward** **closes and freezes** it in the same SQLite transaction. Going **back** onto an `ask` beat after a freeze does **not** reopen it: it shows the question as "Closed". Reopening is an explicit, confirmed console action. So a clicker press is always safe:

```
        open (phones active)                  frozen (immutable result)
 --> [ask] ------- Next -------> [reveal] --> [discuss] --> [concept?] --> next scene
       ^      (close + freeze)       |
       +-- Prev: shown CLOSED <------+     REOPEN (hold-confirm) = new run; old result kept
```

Two more flags live on `presentations`:

- `phones: 'auto' | 'passive'`. PASSIVE forces every phone to the look-up screen immediately, even while a question is open (panic button). Answers get `CLOSED`.
- `hide: 0 | 1` hides the result layer on the projector (the headline stays). It's separate from Part 2's `hold` (full blackout), which still works.

### 4.3 Persisted state (the source of truth)

| State | Stored in |
|---|---|
| scene/beat, hold, plain, motion, phones, hide, focus, optional toggles | `presentations` (existing row + new columns) |
| each question's current run, phase, open/freeze times | `prompt_runs` |
| every answer | `responses` |
| the frozen aggregate the projector renders | `prompt_results` (immutable) |

Any phone, projector or console can reload at any moment and rebuild its whole state from these rows. Nothing depends on having received a particular websocket event.

### 4.4 The states the brief asks for

| Brief state | Here |
|---|---|
| active interaction | `prompt_runs.phase = 'open'` and the current beat's role is `ask` |
| accepting responses | open **and** `phones = 'auto'` |
| response submitted | a `responses` row exists for this phone and the current run |
| responses frozen | `prompt_runs.phase = 'frozen'` and a `prompt_results` row exists |
| results hidden | `hide = 1`, or the role is `ask` |
| results revealed | frozen, role ∈ {reveal, discuss, concept}, `hide = 0` |
| discussion mode | role `discuss` |
| participant passive | anything other than "open + auto + not yet answered + eligible" |

---

## 5. Interaction configuration system

A typed TypeScript file, not a CMS. It's version-controlled, reviewed in PRs and type-checked, and the author can edit copy without touching logic. The things an author plausibly changes *in the room* (quotes, optional toggles) are also editable in the console and persisted per session.

```ts
// src/server/discussion/content.ts (shape; copy abbreviated)
export type Choice = { id: string; label: string; exclusive?: boolean };
export type Eligible = 'played' | 'anyone';       // 'played' = stage done; 'anyone' = done or never started
export type PromptSpec =
  | { kind: 'single';  id: PromptId; phone: string; choices: Choice[]; eligible: Eligible }
  | { kind: 'multi';   id: PromptId; phone: string; choices: Choice[]; max: number; eligible: Eligible }
  | { kind: 'sliders'; id: PromptId; fixed: string; steps: { context: string; phone: string }[]; lo: string; hi: string; eligible: Eligible };
// three kinds only; 'sliders' with n steps is the repeated rating

export type BeatSpec = { role: 'show' | 'ask' | 'reveal' | 'discuss' | 'concept'; say?: string; ask?: string; slot?: SlotId; seconds?: [number, number] };
export type SlotId = 'socialComparison' | 'referenceGroup' | 'reflectedAppraisal' | 'lookingGlass';
export type QuoteSlot = { concept: string; text: string; source: string; page: string };  // text '' = beat skipped

export const SLOTS: Record<SlotId, QuoteSlot> = {
  socialComparison:   { concept: 'Social comparison',   text: '', source: '', page: '' }, // AUTHOR: textbook quote + page
  referenceGroup:     { concept: 'Reference groups',    text: '', source: '', page: '' }, // AUTHOR
  reflectedAppraisal: { concept: 'Reflected appraisal', text: '', source: '', page: '' }, // AUTHOR
  lookingGlass:       { concept: 'Looking-glass self',  text: '', source: '', page: '' }, // AUTHOR (optional)
};
export const SHOW: { prompts: Record<PromptId, PromptSpec>; scenes: Partial<Record<SceneId, { beats: BeatSpec[]; minutes: [number, number]; verbal: string }>> };
```

`say` is one line the presenter can glance at (e.g. `SAY: "Nobody sees your answer."`); `ask` is the follow-up (`ASK: "What would make you ignore a comparison?"`); a scene may add a `DON'T SAY YET` line. `verbal` is the no-tech fallback for the whole scene ("Hands up if…"). No scripts.

A unit test over `SHOW` enforces:

- every `ask` beat's scene has a prompt, and every prompt is used by exactly one scene;
- phone copy is ≤ 140 characters and contains none of the bundle-forbidden words (phones stay plain even though the bundle check wouldn't see wire copy);
- every `multi` prompt has an exclusive "None of these" and an exclusive "Prefer not to say";
- the core scenes' `minutes` fit the run of show;
- `concept` beats whose slot has empty `text` are skipped (the same rule as today's `concept` scene).

Console overrides: the existing Concept panel becomes **Quotes**, one row per slot, prefilled from `SLOTS` and saved into `presentations.concept_json = { slots }`. The old `{title, quotes}` shape is read as `slots.socialComparison`.

Why not the database for everything: prompts and choices are part of the lesson design and the aggregation logic depends on their ids, so they belong in code and review. Quotes and toggles are per-delivery, so they get a small per-session override. Nothing else is editable at runtime.

---

## 6. Presenter control extensions

### 6.1 Principle

The clicker (`→`) is still enough to run the whole show. Everything else is a safety net. The console adds **one panel** ("Question"), shown only on question scenes, next to the existing Current/Next previews.

### 6.2 Question panel

```
+ QUESTION . Did it work? ------------------------------- run 1 . OPEN 0:14 +
|  23 / 27 answered   [####################....]   (27 phones eligible)       |
|  live split (console only): yes 9 . a little 8 . not really 4 . didn't look 2 |
|  [ CLOSE & REVEAL > ]  [ HIDE RESULT ]  [ PHONES -> LOOK UP ]  [ SKIP ]      |
|  hold: [ REOPEN ]                                                            |
|  SAY:  "Be honest. Nobody sees your answer."                                 |
|  ASK:  "Who said 'not really'... and what did the chart say?"                |
|  READY (70% or 25 s). Don't wait for everyone.                               |
+------------------------------------------------------------------------------+
```

- **Count and live split** are for the presenter only; while a question is open the projector shows just the count. This lets the presenter read the room and pick the discussion angle before revealing.
- **Ready meter:** turns green at `max(5, 70% of eligible)` answers **or** 25 s after opening, whichever comes first. It's advice, not a gate: Next always works. With 0 answers, Next skips that scene's `reveal`/`discuss` beats (§14).
- **CLOSE & REVEAL** is the same as pressing Next on an `ask` beat.
- **HIDE RESULT** (`H`) toggles `hide`.
- **PHONES → LOOK UP** (`P`) toggles `phones = passive`.
- **SKIP** (`S`) jumps to the next scene, freezing the current question silently (never revealed).
- **REOPEN** (hold 1.2 s) starts a new run: phones reopen; the old result is kept for the log but no longer shown.
- **Highlight** (`1`–`9` on `discuss` beats) emphasizes one category or context on the projector; the rest dim to 30%. Stored as `presentations.focus`. This is the brief's "presenter selects a category and asks who the reference group is" move.
- **SAY / ASK / DON'T SAY YET** come from `content.ts`, one line each, short enough to glance at.
- **Optional scene toggles** (`samescore`, `landscape`, quote beats) as checkboxes in the strip header, marked `OPTIONAL`.

### 6.3 Keyboard additions

| Key | Action |
|---|---|
| `→` on an `ask` beat | close + freeze + reveal |
| `H` | hide/show the result layer |
| `P` | phones passive toggle |
| `S` | skip scene (freezes the open question) |
| `1`–`9`, `0` | highlight a category/context; `0` clears |
| `E` `E` (within 2 s) | jump to `circle` (final synthesis); also a hold button |

Existing keys (`B` hold, `F` plain, `R` replay, `G` strip, `?` help, `Shift+→/←`) are unchanged and work on every Part 3 beat.

### 6.4 Phone backup pad

Under 700 px the console shows a fixed pad: big `◀ BACK` / `NEXT ▶`, the answer count, `LOOK UP` and `HOLD`. This finally implements plan2's phone pad, and matters more now.

### 6.5 Strip and pacing

The scene strip gets a divider between Part 2 and Part 3. Each Part 3 scene shows its suggested minutes (`2–3 min`) and an `OPTIONAL` tag where relevant. A small elapsed timer starts at BEGIN REVEAL and turns amber when the run of show is behind by > 2 minutes, with a hint ("Consider skipping landscape").

---

## 7. The interactions (exact)

Copy below is draft copy for the discussion lead to edit. Phone copy is deliberately plain; the projector carries the concept words.

### 7.0 `bridge`: Now you (projector only, 1 beat)

Projector: the Part 2 field dims, and `NOW YOU TELL US.` appears with one line: "Your phones will light up a few times. Answers are anonymous and only ever shown as class totals." Phones go from "Eyes up here" to "Discussion in progress. Look up." The presenter restates the mechanism in one sentence ("You each saw three players we picked, higher, similar or lower than you").

Why it exists: it makes the privacy promise once, out loud and on screen, before the first question. After a deception, that makes honest answers more likely.

---

### 7.1 `felt`: Did it work on you? (CORE)

Beats: `ask` → `reveal` → `discuss` (felt vs measured) → `concept` (socialComparison slot, skipped if empty).

**STUDENT SEES:**
"When you saw the other three players' scores, did it change how you felt about your own?"
*Yes, noticeably* · *A little* · *Not really* · *I didn't really look at them*.

**STUDENT DOES:**
One tap and Send, about 8 seconds. The phone says "Got it. Look up." and goes passive.

**PROJECTOR SHOWS:**
While open: the question and a live count ("23 answered"). No distribution.
Reveal: one full-width bar splits into four segments that slide in from the left, with percentages.
Discuss: the bar moves to the top third, and **the Part 2 `compare` bars reappear underneath**, small, with one adaptive line: *"You said: 38% 'not really'. Your ratings moved −6.8 / +0.4 / +5.1."* If the Part 2 pattern was `flat` or `thin`, the line says instead *"And on average, the ratings barely moved."* (same rules as `compareCopy`, never causal).
Optional sub-state (only if every Part 1 world has ≥ 5 answers): the same bar split by *what you saw* (higher / similar / lower).

**PRESENTER ASKS:**
"Most of you said it didn't change much. The chart says the group that saw higher scores rated themselves lower. Can both be true? Why might we not notice comparison while it's happening?"
DON'T SAY YET: "reference group".

**CONCEPT:**
Social comparison: we evaluate ourselves relative to others, often quickly and without deciding to. The gap between what the class reports and what the class's ratings did *is* the teaching point.

**WHY THE APP ADDS VALUE:**
A show of hands on "did it affect you?" is socially loaded: nobody wants to admit a video game made them feel worse. Private answers are more honest, and **only the software can put the class's self-report next to the class's measured shift from five minutes earlier.** That juxtaposition is the strongest moment in Part 3, and it's impossible without the data.

---

### 7.2 `switch`: Same result, three rooms (CORE; reference groups)

This merges the brief's "Who gets to be your reference group?" and "Reference-group switch" into one interaction: the switch *shows* the first idea instead of asking about it.

Beats: `show` (the fixed result) → `ask` (three sliders) → `reveal` (the morph) → `discuss` → `concept` (referenceGroup slot).

**STUDENT SEES:**
A fixed card that stays on screen for all three steps: **"You got 78% on a midterm."** Then, one step at a time:
1. "Most people in your program got around 90%."
2. "The class average was 78%."
3. "Most people in your program got around 60%."

Under each, the same vertical fader as Part 1: "How good would you feel about your 78%?" (bottom: *terrible*, top: *great*). A small "2 of 3" in the top line.

**STUDENT DOES:**
Three fader moves, about 20 seconds in total. After the third: "Got it. Look up."

**PROJECTOR SHOWS:**
While open: the fixed **78%** huge in the center, and the count.
Reveal (the signature visual): **78%** stays pinned at the top in paper white and never moves. Below it, every respondent is one anonymous dot. The dots first form a beeswarm along a 0–100 "how good" axis for room 1 (tinted with the Part 1 blue "saw higher" color). Then **the same dots travel** to their room-2 positions (neutral), then room 3 (amber, "saw lower"), with faint trails, about 0.9 s per room. A median marker slides with them. The number at the top never changes. The reveal settles on the three distributions side by side with their medians, e.g. *34 → 61 → 83*. `R` replays the travel.
Discuss: headline `SAME 78%. DIFFERENT ROOM.` Keys `1/2/3` highlight one room.

**PRESENTER ASKS:**
"The 78% never moved. What moved? In real life, who is your '90% room', and did you choose it?"
Follow-ups if time: "Would you rather know your closest friend's mark or the top student's? Why?" (the brief's "choose your mirror" question, asked verbally). "Is the 60% room actually good for you, or just comfortable?"

**CONCEPT:**
Reference groups: the group we compare against determines what a result *means*. Comparing upward can deflate or motivate; comparing downward can reassure. Here the comparison group, not the achievement, drove the change.

**WHY THE APP ADDS VALUE:**
Out loud, students will *say* "context matters" and move on. Here **the same dots physically move while the number stays still**, so the class watches its own judgments shift when only the room changes. It's the Part 2 `samescore` idea turned into something every student personally just did, and the blue/amber colors mean the same thing they meant in Part 1.

Design notes: the rooms are always shown in the same order (higher → same → lower) so the morph reads as one direction. That order introduces carryover, but this is a discussion prompt, not a measurement, and the notes say so. The copy says "people in your program", not "your friends", so nobody pictures specific people. 78% (not the Part 1 score) keeps it a hypothetical and avoids re-exposing anyone's real result.

---

### 7.3 `landscape`: Where comparison happens for you (OPTIONAL IF TIME)

Beats: `ask` → `reveal` → `discuss` (presenter highlights one category).

**STUDENT SEES:**
"Where do you most often find yourself comparing with other people? Pick up to 3."
*Grades & school* · *Co-op & jobs* · *Sports & fitness* · *Social media* · *Friends' plans & milestones* · *Gaming* · *Creative work* · *None of these* · *Prefer not to say*.

**STUDENT DOES:**
Taps up to three and Send, about 12 seconds.

**PROJECTOR SHOWS:**
Dots flow into labelled clusters; cluster area is proportional to the count, and each cluster shows its percentage. Categories under the suppression threshold merge into "Other". No trajectories and **no cross-tab with anything else, ever** (not with Part 1 worlds, not with `felt`). Discuss: the presenter presses a number to highlight one cluster, and the headline becomes *"For the 60% here: who's on the other side of that comparison?"*

**PRESENTER ASKS:**
(Highlight the biggest cluster, usually Grades or Co-op.) "When you compare on co-op, who's your reference group: everyone in your program, your friends, or one person on a professional network? Why that person?"

**CONCEPT:**
Reference groups in real life are plural and domain-specific. We use (or are handed) different comparison groups for different parts of the self.

**WHY THE APP ADDS VALUE:**
Moderate. The categories are mildly personal; a private multi-select shows the *shape* of the room's comparisons in a way hands can't (people raise a hand once, not three times, and rarely for "social media" in front of peers). It's optional because it's the one interaction that isn't built on the class's Part 1 experience.

Category choices: the brief's list minus **money, appearance, relationships, lifestyle/travel and "something else"**. Money, appearance and relationships press on exactly the sensitive areas the brief lists; "lifestyle/travel" is a proxy for money; "something else" invites a free-text follow-up we don't want. "Followers" is folded into *Social media*; "skills/talent" into *Gaming* and *Creative work*.

---

### 7.4 `mirrors`: Two mirrors, Alex (CORE; social comparison vs reflected appraisal)

Beats: `show` (Alex's result) → `ask` (two sliders) → `reveal` → `discuss` → `concept` (reflectedAppraisal slot; lookingGlass optional).

This keeps the brief's Alex idea but cuts it to **two** steps. It's better than a plain A/B choice ("which would affect you more?") because students *rate* both situations, so the projector can show the size of the difference, and the class sees its own judgments move; an A/B vote only produces an opinion split.

**STUDENT SEES:**
A fixed card: **"Alex (made up) gave a group presentation. Grade: B+."** Then:
1. "Everyone else in Alex's group got an A." — "How good does Alex feel about the presentation?"
2. "Same B+. Same group. After class, a friend tells Alex: 'Honestly, your part was the clearest in the whole project.'" — the same question.

**STUDENT DOES:**
Two fader moves, about 15 seconds.

**PROJECTOR SHOWS:**
While open: the B+ card and the count.
Reveal: two columns with question headings: **HOW DO I COMPARE WITH THEM?** (left, blue) and **HOW DO I THINK THEY SEE ME?** (right, phosphor). One anonymous dot per respondent sits in the left column, then moves to the right. Medians shown (e.g. 31 → 72). The B+ stays pinned at the top, unchanged.
Discuss: `SAME B+. TWO DIFFERENT MIRRORS.` The two column questions stay on screen as the anchor.

**PRESENTER ASKS:**
"The grade didn't change. The group didn't change. What changed? Step 1 is Alex looking *at* others. Step 2 is Alex imagining how someone *sees* them. Which one would stick with you longer? What if the friend had said something negative?"
(The negative version is **only asked verbally**. No criticism appears on any screen.)

**CONCEPT:**
Reflected appraisal: the self-concept is shaped by how we believe others see us (the looking-glass self). That's distinct from social comparison, where we evaluate ourselves against others. Same person, same result, two sources of self-evaluation.

**WHY THE APP ADDS VALUE:**
The difference between these two concepts is exactly what students blur on exams. Defining it is a vocabulary exercise. Here **the class sees its own judgments move when only the *kind* of social information changes**, with the result held fixed, which is the same logic they just lived through in Part 1. The two column headings are the definition, made visible.

Why fictional: real peer appraisal would mean students judging each other (unsafe) or the app inventing feedback about them (a second deception). Alex gives the same logic with none of that risk.

---

### 7.5 `chooser`: Who chose your comparison? (projector only; digital systems)

Beats: `show` (the pipeline) → `show` (the swap) → `discuss`.

**STUDENT SEES:**
"Discussion in progress. Look up." (no input).

**STUDENT DOES:**
Listens, then answers the presenter out loud.

**PROJECTOR SHOWS:**
Beat 1 is the Part 2 mechanism, finally drawn as the pipeline plan2 described: `YOUR SCORE` → `THE APP PICKED 3 PLAYERS` → `YOU SAW THEM` → `YOU RATED YOURSELF`, each station a labelled box, with a small dot stream flowing through it (the real counts from the snapshot: "27 of you · 81 comparisons shown · 41 of them generated").
Beat 2: the second station's label swaps to **`A FEED PICKED WHAT YOU SAW`**, and the dot stream changes to a generic "posts" stream (no students). The rest of the pipeline is unchanged. Headline: `TODAY IT WAS US. ONLINE IT'S A RANKING SYSTEM.`
Beat 3 (discuss): three short neutral interface labels appear under the pipeline as examples of **systems that pick your comparison**: *Leaderboards*, *"People you may know"*, *Like and view counts*. That's text only: no logos, no screenshots of real products, no invented statistics.

**PRESENTER ASKS:**
"In Part 1, we chose who you compared with, and you didn't know. Where else does something choose that for you? Is the feed's version the 90% room or the 60% room? Why would a system pick that?"

**CONCEPT:**
Algorithmically curated comparison: reference groups can be *selected for* us, which is the same mechanism as Part 1, at scale, without disclosure.

**WHY THE APP ADDS VALUE:**
It turns the class's own experiment into the metaphor. The pipeline uses the real counts from their session, so "someone chose your comparison" isn't a claim about the internet; it's a description of what happened to them twenty minutes ago.

Why projector-only: a phone poll here ("Which platform makes you compare most?") would be a generic audience-response question, and it would invite product bashing. The strongest version of this moment is the swap, not a vote.

The brief's "real interface examples" are covered by beat 3's three labels. A separate "interface gallery" scene is cut (§21).

---

### 7.6 `circle`: Full circle (projector only; final synthesis)

Beats: `show` (your scores) → `show` (three rooms) → `show` (the line).

**STUDENT SEES:**
"Thanks. That's the end of the activity." with a small "You can close this page."

**STUDENT DOES:**
Nothing. Listens.

**PROJECTOR SHOWS:**
See §9 (FINAL VISUAL MOMENT).

**PRESENTER ASKS:**
Nothing new. The presenter reads the final line, pauses, and hands over to the next part of the class. Optional closing question if there are 60 seconds left: "Who are you going to compare yourself with this week, and did you choose them?"

**CONCEPT:**
Social comparison, reference groups and reflected appraisal as one idea: the self is evaluated in relation to others we often don't choose.

**WHY THE APP ADDS VALUE:**
It returns the class to the first image of Part 2 (their own real scores), so the whole activity closes on something they made. No new data is collected; the payoff is the callback.

---

## 8. Exact discussion flow

The complete Part 3 flow, as the presenter experiences it with a clicker. `→` is always safe.

| # | Scene:beat | Role | Phones | Projector | Presenter | Time |
|---|---|---|---|---|---|---|
| 1 | `bridge:0` | show | look up | NOW YOU TELL US + privacy line | 1-sentence mechanism recap | 0:30 |
| 2 | `felt:0` | ask | **prompt** | question + count | "Be honest. Nobody sees your answer." | 0:20 |
| 3 | `felt:1` | reveal | look up | split bar | pause | 0:15 |
| 4 | `felt:2` | discuss | look up | bar + Part 2 compare bars + adaptive line | ask why | 1:30–2:30 |
| 5 | `felt:3` | concept | – | social comparison quote (if set) | read it | 0:20 |
| 6 | `switch:0` | show | look up | "You got 78%." | set up the hypothetical | 0:15 |
| 7 | `switch:1` | ask | **3 sliders** | 78% + count | "Three rooms. Same mark." | 0:30 |
| 8 | `switch:2` | reveal | look up | dots travel room 1 → 2 → 3 | `R` to replay | 0:20 |
| 9 | `switch:3` | discuss | look up | SAME 78%. DIFFERENT ROOM. | ask who your 90% room is | 2:00–3:00 |
| 10 | `switch:4` | concept | – | reference groups quote | read it | 0:20 |
| 11 | `landscape:*` | optional | multi-select | clusters | highlight one; ask | 2:00–3:00 |
| 12 | `mirrors:0` | show | look up | "Alex (made up)… B+" | set up | 0:15 |
| 13 | `mirrors:1` | ask | **2 sliders** | B+ + count | "Two situations. Same grade." | 0:25 |
| 14 | `mirrors:2` | reveal | look up | two columns, dots move | pause | 0:20 |
| 15 | `mirrors:3` | discuss | look up | SAME B+. TWO DIFFERENT MIRRORS. | ask what changed | 2:00–3:00 |
| 16 | `mirrors:4` | concept | – | reflected appraisal quote | read it | 0:20 |
| 17 | `chooser:0–2` | show/discuss | look up | pipeline → swap → labels | ask who chooses online | 2:00–3:00 |
| 18 | `circle:0–2` | show | thanks | final visual moment | read the last line | 0:45 |
| 19 | `end` | – | thanks | Thanks + data stays anonymous | hand over | – |

Behind at step 11? The strip timer says so; press `S` or leave `landscape` off. Behind at step 17? `E E` goes straight to `circle`.

---

## 9. FINAL VISUAL MOMENT

The ending is a **callback**, not a summary slide.

- **Beat 1 (`circle:0`):** the projector returns to the very first reveal image: the class's real Part 1 scores as a beeswarm on the score axis (the `onegame` layout, from the same frozen snapshot, same positions). No text except a small `YOUR SCORES` label. The room recognizes it immediately.
- **Beat 2 (`circle:1`):** the dots take their Part 1 room colors (blue "saw higher", neutral "similar", amber "saw lower") **without moving**. Nobody's score changes. One line: `SAME SCORES. THREE DIFFERENT ROOMS.`
- **Beat 3 (`circle:2`):** the colors fade back to one color, the dots dim to about 20%, and one line appears in large type:

  > **You didn't choose who you compared yourself with today.**
  > *Most days, you don't either.*

  Then nothing else. Hold for a few seconds. The presenter hands over.

Why this works: it's built from the class's own data, it restates the whole unit (same result, different comparison context) without a lecture, and it isn't preachy. It doesn't tell students to stop comparing, delete apps or feel a certain way; it just names who picked the comparison. If the author prefers a different line, it's one string in `content.ts`.

Privacy: this frame uses only `RevealData` (already public-filtered, no identities); world colors only appear if every world is ≥ 5 (the `worlds` rule). Otherwise beat 2 is skipped and beat 3 still works.

Plain mode: beat 3 is the line on a black background; beats 1–2 are the static beeswarm image with the label.

---

## 10. Participant phone experience

The phone stays a quiet instrument. It lights up only when there is something to answer, and otherwise tells the student to look up.

| Phone state | When | Shows |
|---|---|---|
| Part 1 stages | still playing or rating | unchanged; late banner "The main screen has started. Finish when you're ready." Never interrupted by a Part 3 prompt. |
| `look` (Part 2) | done, reveal running | "Eyes up here." (existing `Done`) |
| `discuss` | done, Part 3 scene, no open prompt (or already answered, or PASSIVE) | "Discussion in progress. Look up." Small line: "Your phone will light up when there's a question." If answered: "Answer received." |
| `prompt` | done (or eligible `anyone`), prompt open, `phones = auto`, not yet answered | `Prompt.tsx` (below) |
| `closed` | tapped Send after the freeze | "That question just closed. Look up." (no error styling) |
| `end` | `circle`/`end` | "Thanks. That's the end of the activity. You can close this page." |

`Prompt.tsx`:

- One question per screen, in the Part 1 visual language (`display` heading, `mono` meta line, phosphor accent, 44 px+ targets).
- `single`: stacked full-width `Choice` buttons (radio semantics, `role="radiogroup"`), Send enabled after a choice.
- `multi`: checkbox semantics with a "Pick up to 3" counter; exclusive options clear the others.
- `sliders`: the fixed card stays pinned; one `Fader` per step with "Next" between steps and "Send" on the last. Steps are local until Send, then sent as **one** answer, so a half-finished set is never stored.
- No timers or countdowns on the phone (they make people rush and signal a quiz). The presenter controls timing.
- "Skip" is always available as a small text button on `single`/`sliders` prompts (it sends nothing; the phone just goes passive). `multi` prompts use the explicit "Prefer not to say" choice.
- Haptic tick (`navigator.vibrate(10)` where supported) when a new prompt appears, since the phone might be face-down.
- After Send: instant local "Got it. Look up." (optimistic), then confirmed by the server view. If the ack fails after retries: "Couldn't send. Tap to retry." with the answer preserved.
- Refresh mid-prompt: the server view says the prompt is open and unanswered, so it reappears (local slider positions are lost, which is acceptable). Refresh after Send: "Answer received."

Joined but never finished Part 1 (e.g. arrived late): `felt` is `eligible: 'played'` and they don't see it; `switch`, `landscape`, `mirrors` are `eligible: 'anyone'`, so a latecomer can still take part in discussion.

---

## 11. Privacy and sensitive-topic safeguards

Part 3 happens right after students learn they were deceived. Its privacy posture has to be visibly stricter than Part 1's, not merely equal.

1. **No new deception.** Every Part 3 prompt is what it says. No fake feedback, no generated peers, no hidden conditions. Alex is labelled "(made up)".
2. **No peer judgment.** Students never rate, rank or describe a real classmate. Nothing in Part 3 references another participant.
3. **No sensitive categories.** No questions on income, mental health, romantic experiences, body image, family circumstances or identity characteristics. `landscape` dropped money, appearance and relationships (§7.3). A content test (§5) keeps it that way.
4. **Opt-out everywhere.** "Skip" on every single/slider prompt; "Prefer not to say" on multi-select. Opt-outs are counted separately and shown only as "n skipped" in the console, never on the projector.
5. **No open text.** Part 3 has no free-text input at all. The "why" happens out loud, which is the point of a discussion lead. If a future version adds open text, it must go to a presenter-only moderation queue and is never shown automatically; that's out of scope here.
6. **Aggregate only.** The projector receives a `PromptResult`: counts, percentages, medians and **anonymous, shuffled dot positions** for slider prompts. No participant ids, codenames, timestamps or per-person links between prompts.
7. **No cross-prompt linking on screen.** Two prompts are never joined per person on the projector, except `felt` × Part 1 world, which is shown **only** when every world has ≥ 5 answers, and only as three bars.
8. **Small-cell suppression.** Any category or split with 1–4 answers shows as "<5" (bars) or merges into "Other" (clusters). Any prompt with < 5 total answers shows "Too few answers to show", and the presenter discusses verbally.
9. **Dots can't be traced.** Slider dots are sorted by value and re-jittered deterministically from the result hash; order and position carry no identity. With `n < 8`, slider reveals switch to median + range only.
10. **Minimal storage.** `responses` stores the answer and a participant id (needed for one-answer-per-person and reconnect). **Reset and "delete session" remove them**, same as Part 1 data. The CSV export gets a separate Part 3 sheet with per-prompt aggregates only; no per-participant Part 3 rows.
11. **Public payload filter.** `assertPublicPrompt` (strict zod, unknown keys rejected) runs on every result before it leaves `/s`, mirroring `assertPublic`. The participant view carries only the current phone prompt, never results.
12. **Bundle hygiene still holds.** Phone prompt copy lives in `content.ts` (server) and arrives over the wire, so it doesn't enter the participant bundle; `check:bundle` keeps passing. The forbidden-word test in §5 also runs over phone copy.
13. **Say it on screen.** `bridge` states the rules ("anonymous, only ever shown as class totals") before the first prompt.

---

## 12. Data model (migration 3)

What goes where:

| Thing | TypeScript config | Database |
|---|---|---|
| Scenes, beats, roles, prompts, choices, phone copy, notes, timing | yes (`content.ts`) | no |
| Quote slots | defaults in config | per-session override in `presentations.concept_json` |
| Optional-scene toggles | defaults in config | `presentations.flags_json` |
| Which question is open, its run and phase | no | `prompt_runs` |
| Answers | no | `responses` |
| Frozen aggregates | no | `prompt_results` (immutable) |

```sql
-- migration 3 (additive)
ALTER TABLE presentations ADD COLUMN phones TEXT NOT NULL DEFAULT 'auto' CHECK (phones IN ('auto','passive'));
ALTER TABLE presentations ADD COLUMN hide INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presentations ADD COLUMN focus INTEGER;                       -- highlighted category/context, or NULL
ALTER TABLE presentations ADD COLUMN flags_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE presentations ADD COLUMN part3_at INTEGER;                    -- first time a Part 3 scene was entered
ALTER TABLE presentations ADD COLUMN run INTEGER NOT NULL DEFAULT 1;      -- bumped by REWIND and demo resets

CREATE TABLE prompt_runs (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,                    -- PromptId from content.ts
  run INTEGER NOT NULL,                    -- 1, 2 after REOPEN, ...
  phase TEXT NOT NULL CHECK (phase IN ('open','frozen')),
  source TEXT NOT NULL CHECK (source IN ('live','test','demo')),
  opened_at INTEGER NOT NULL,
  frozen_at INTEGER,
  result_id TEXT REFERENCES prompt_results(id),
  PRIMARY KEY (session_id, prompt, run)
);

CREATE TABLE responses (
  session_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  run INTEGER NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  rid TEXT NOT NULL,                       -- client idempotency key
  value_json TEXT NOT NULL,                -- validated against the PromptSpec: {c:'yes'} | {cs:['grades']} | {v:[34,61,83]} | {skip:true}
  at INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,         -- arrived within the 1.5 s grace window after freeze
  PRIMARY KEY (session_id, prompt, run, participant_id),
  FOREIGN KEY (session_id, prompt, run) REFERENCES prompt_runs(session_id, prompt, run) ON DELETE CASCADE
);

CREATE TABLE prompt_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  run INTEGER NOT NULL,
  version TEXT NOT NULL,                   -- aggregate + content version
  created_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,                 -- PromptResult, already public
  hash TEXT NOT NULL
);
CREATE TRIGGER prompt_results_immutable BEFORE UPDATE ON prompt_results
BEGIN SELECT RAISE(ABORT, 'prompt_results are immutable'); END;
```

Notes:

- `PRIMARY KEY (session, prompt, run, participant)` makes "one answer per person per run" a database guarantee. A repeated `rid` returns the original ack; a different `rid` for the same person is `ALREADY` (we don't allow changing an answer; it keeps the freeze semantics simple and matches "private, quick").
- Demo responses are inserted with bot participants on **test** sessions only; the Part 2 demo-on-live trigger is extended to `prompt_runs.source = 'demo'`.
- `RESET` and `delete session` cascade through all three tables. The `Part 1 → Part 3` path never needs Part 3 rows to render Part 1/2.
- `presentation_log` gets new `cmd` values (`q.open`, `q.freeze`, `q.reopen`, `phones`, `hide`, `skip`), so a post-class debrief can reconstruct the timeline.

---

## 13. Realtime synchronization and response freezing

### 13.1 Protocol additions

Participant (`/p`):

```ts
// src/shared/protocol.ts
export const AnswerReq = z.object({
  prompt: z.string().max(24), run: z.number().int().min(1),
  rid: z.string().min(8).max(40),
  value: z.union([
    z.object({ c: z.string().max(24) }),
    z.object({ cs: z.array(z.string().max(24)).max(3) }),
    z.object({ v: z.array(z.number().int().min(0).max(100)).min(2).max(3) }),
    z.object({ skip: z.literal(true) }),
  ]),
});
// ack: { ok: true, view } | { ok: false, reason: 'CLOSED' | 'ALREADY' | 'INVALID' | 'NOT_ELIGIBLE' }
```

`ParticipantView.room` gains `screen?: 'look' | 'discuss' | 'end'` and `prompt?: PhonePrompt`, where `PhonePrompt = { id, run, kind, phone copy, choices/steps, answered: boolean }`. The phone is told **what** to ask, never the result.

Presenter (`/h`): `pres.cmd` gains `{t:'q', op:'close'|'reopen'|'skip', rev}`, `{t:'phones', on, rev}`, `{t:'hide', on, rev}`, `{t:'focus', i: number|null, rev}`, `{t:'flags', flags, rev}`, `{t:'final', rev}`. Same lease, same `rev` precondition, same `STALE` handling. The presenter view gains `question: { prompt, run, phase, eligible, answered, skipped, split, openedAt, readyAt } | null`.

Projector (`/s`): `ScreenState` gains `q?: { prompt, run, phase, count, resultHash: string | null }`, `hide`, `focus`. Results are fetched by hash through the existing `need` path (`{ need: 'prompt', hash }`) and cached in memory by hash, exactly like `RevealData`.

### 13.2 Push policy

- Answer → the presenter gets a debounced (250 ms) view with the new count; projectors get a `ScreenState` with the new `count` (debounced 500 ms, only while open). **No** session-wide phone push for an answer: only the answering phone gets its view back.
- Open/freeze/reopen/phones/end → one `pushSessionViews` (every phone), one `pushPresentation`.
- Everything is a **full state** push; clients drop anything with an older `rev`. Reconnect = `join` → full view.

### 13.3 Freezing

The freeze runs in one transaction inside the presenter command:

```
command(next) on an 'ask' beat:
  tx:
    run = prompt_runs(open)
    rows = responses(run)             -- everything committed so far
    result = aggregate(spec, rows)    -- pure; suppression applied
    assertPublicPrompt(result)
    insert prompt_results(result, hash)
    update prompt_runs set phase='frozen', frozen_at=now, result_id
    move to the reveal beat; rev++
  push all
```

- **Late submissions:** an `answer` arriving after the freeze is accepted into `responses` with `late = 1` only if it's within 1.5 s (in-flight taps), and **never** changes the frozen result. Anything later gets `CLOSED`. The console shows "+2 late" next to the count. That's predictable: what the class sees is exactly what was frozen.
- **Reopen** creates run `n+1` and reopens phones. Phones that answered run `n` see the prompt again, because it is a new question as far as the data is concerned. The console asks to confirm ("Reopen? Everyone answers again.").
- **Prev over a frozen question** shows the frozen result again, never reopens.
- **Rewind / reset** bump `presentations.run` so nothing from a rehearsal survives into the live run; old rows are deleted with the session reset, not updated.

---

## 14. Thresholds, failure recovery and panic buttons

### 14.1 Response thresholds

- **Ready** = `answered ≥ max(5, ceil(0.7 × eligible))` or 25 s since open (40 s for `switch`). It's advice shown in the console; Next is never blocked.
- **Too few** (< 5 answers at freeze): the result is frozen with `suppressed: true`; the reveal beat shows `TOO FEW ANSWERS TO SHOW`, and the `discuss` beat falls back to the scene's `verbal` line ("Hands up if it changed how you felt."). The presenter can keep going.
- **Zero answers:** the reveal and discuss beats are auto-skipped (the same `skipReason` mechanism as Part 2), and the strip shows "no answers" on that scene.

### 14.2 Panic buttons

| Need | Control | Effect |
|---|---|---|
| Skip current interaction | `S` / SKIP | freeze silently, go to the next scene's first beat |
| Force-close responses | `→` on `ask`, or CLOSE & REVEAL | freeze now; late answers get `CLOSED` |
| Jump to discussion | `→` twice, or click `discuss` in the strip | freeze, skip the reveal animation |
| Advance with insufficient responses | always allowed | suppressed result, verbal fallback line |
| Hide broken visualization | `H` (result layer) or `F` (plain mode) | headline stays; data disappears or becomes a static table |
| Return phones to passive | `P` | every phone shows "Look up" immediately |
| Jump to final synthesis | `E E` or hold button | freeze any open question, go to `circle:0` |
| Recover after refresh | reload the console | lease restored from `sessionStorage`; state rebuilt from the DB |
| Everything is on fire | `B` hold | projector black; talk |

### 14.3 Failure cases

| Failure | Behavior |
|---|---|
| Phone refreshes mid-question | view says open + unanswered → prompt reappears |
| Phone refreshes after answering | "Answer received." |
| Phone offline when Send is tapped | outbox retries with the same `rid` (≤ 5 tries); duplicates resolve to the original ack |
| Phone reconnects after the freeze | view says frozen → "That question just closed. Look up." |
| Projector refresh | rejoin `/s`, receive `ScreenState`, fetch the result by hash, render the settled frame (no replay of the animation) |
| Projector disconnect | keeps its last valid frame; small corner dot after 5 s, as in Part 2 |
| Console refresh | reopens with the same lease; the question panel is rebuilt from `prompt_runs` |
| Console loses connection | red "Disconnected, reconnecting" banner; commands disabled, not queued (avoids double-advances) |
| Two consoles | Part 2 lease rules; only the controller can open/close |
| Server restart mid-question | all state is in SQLite; the question is still open after restart; clients reconnect |
| DB write fails on answer | ack `{ok:false, reason:'RETRY'}`; phone retries; console shows a warning after 3 failures |
| Realtime fails entirely | every scene has a `verbal` line in the console notes and a plain frame on the projector. The show can continue as a hands-up discussion |
| Static emergency fallback | `npm run export:slides` writes the plain frames of a rehearsal run (with the latest live Part 2 snapshot if one exists) to a folder of PNGs. Optional, P2 priority |

---

## 15. Projector visualization system

Part 3 reuses the Part 2 stage (1920×1080 logical, `SAFE` area, Canvas 2D `Field` for dots, DOM for type) and adds three renderers in `src/screen/discussion/`. No new rendering technology; **no Three.js**.

| Renderer | Used by | Frames |
|---|---|---|
| `SplitBar` | `felt` | one 100%-wide bar, 4 segments; optional three-bar split by Part 1 world; reuses `compare` bars in discuss |
| `Rooms` | `switch`, `mirrors` | fixed anchor at the top (78% / B+); anonymous dots in a beeswarm per step on a 0–100 axis; dots travel between steps with trails; medians slide |
| `Clusters` | `landscape` | packed circles per category, area ∝ count, merge small ones into "Other" |
| `Pipeline` | `chooser` | four stations and a dot stream; label swap on beat 2 |
| `Callback` | `circle` | `onegame` target map from the Part 2 snapshot, recoloured by world, then dimmed |

Rules carried over from Part 2:

- **Deterministic targets.** Every frame is a pure function of `(result, beat, focus)`; `targets.ts` gains `roomsTargets`, `clusterTargets`, `pipelineTargets`. Refresh renders the same picture.
- **Readable from the back row.** Headlines ≥ 96 px, labels ≥ 36 px, no more than one sentence of body text per frame, contrast ≥ 7:1 on the dark stage.
- **Plain mode for everything.** `plainFrame` gets a case per new scene/beat: a static table or a single line. `F` always works.
- **Motion modes.** `full` (travel + trails), `calm` (shorter fades, no trails), `off` (settled frame). `prefers-reduced-motion` defaults to `calm`.
- **While open, show only the count.** A distribution that fills in live changes answers (people wait and follow the crowd). The count is a big numeral that ticks up.
- **The anchor never moves.** In `Rooms`, the fixed result (78%, B+) is pinned and deliberately static; the movement is in the dots.
- **Colors mean the same thing as Part 1.** Blue = higher comparison, neutral = similar, amber = lower. Phosphor = "you / the class". Reflected appraisal gets phosphor, not a new color.
- **Highlight** dims non-focused elements to 30% and enlarges the focused label; the presenter can clear it with `0`.
- **Test/demo watermark and hold blackout** apply to every Part 3 frame (existing `Stage` behavior).

Performance target: 60 fps (p95 frame ≤ 20 ms) with 150 dots and trails in Chromium on a mid-range laptop, the same budget plan2 set. This time it is enforced by `tests/perf/projector.spec.ts` (§17).

---

## 16. Rehearsal and demo mode

Extends Part 2's deterministic demo (`src/server/reveal/demo.ts`, `cmd demo`) instead of adding a second system.

- **`src/server/discussion/demo.ts`** generates responses from `(profile, n, seed)` with the same seeded PRNG. Bots answer after a deterministic delay (0.5–15 s), so the live count visibly ticks up in rehearsal.
- **Profiles** (selectable in the Rehearsal panel next to the Part 2 scenario):

| Profile | What it produces |
|---|---|
| `expected` | `felt` mostly "a little/not really"; `switch` medians about 35 → 60 → 80; `mirrors` about 30 → 70 |
| `onesided` | 90% one choice; sliders tightly clustered |
| `split` | even split across all choices; wide slider spread |
| `low` | 25% participation, several prompts under the suppression threshold |
| `unexpected` | `switch` reversed (60% room feels worse), `mirrors` flat. Notes must still read sensibly |
| `optionalzero` | zero answers to `landscape` |

- **Sizes:** 12, 30, 60 (plus 150 for the perf test).
- **Bots respect eligibility**: bots still "playing" in Part 1 never answer.
- **Full run:** `sim --full --n 30 --profile expected` drives JOIN → GAME → rating → recap → second rating → BEGIN REVEAL → every Part 2 scene → every Part 3 scene → `circle` → `end` against a local server, and prints the timeline and any warnings. It's the command to run the night before class.
- **Separation:** demo responses only exist on **test** sessions (DB trigger, as in Part 2); the projector watermark says `REHEARSAL` on every frame; demo results are never exported.
- **Reset between rehearsals:** `REWIND` bumps `run` and clears Part 3 rows for the test session, so the same session can be rehearsed repeatedly.

---

## 17. Testing strategy

### 17.1 Unit (Vitest, `tests/unit/discussion.test.ts`)

- `AnswerReq` validation: every kind, out-of-range values, too many choices, unknown choice ids, exclusive choices combined with others → `INVALID`.
- Phase derivation: `(scene, beat, prompt_runs)` → phase / phone state / projector layer, for every Part 3 beat.
- `aggregate`: counts, percentages summing to 100 (largest-remainder rounding), medians, skips excluded, suppression under 5, "Other" merging, `n < 8` median-only mode. `fast-check` property: output never contains participant ids; any permutation of input rows gives the same `hash`.
- Repeated-rating prompts: all steps required; one row per participant; step order preserved.
- Freezing: the result from `aggregate(rows at freeze)` equals the stored result; late rows never change it.
- Opt-out: `skip` and "Prefer not to say" counted separately and never shown on the projector.
- Optional skipping: `landscape` off, zero answers, suppressed results → `nextPos` skips exactly the right beats; Next from `mirrors` with `landscape` off goes straight on.
- `content.ts` checks (§5).
- Every profile × size × Part 3 scene × beat: plain copy and targets contain no `NaN`/`undefined`/`null`/`Infinity` (extending the existing `screen.test.ts` loop).

### 17.2 Integration (`tests/integration/discussion.test.ts`, real Fastify + socket.io clients)

- presenter opens `felt` → eligible phones get `room.prompt`; still-playing phones don't;
- phone answers → ack; presenter count increments; projector `q.count` increments; no other phone receives a push;
- presenter closes → one `prompt_results` row; phones → `discuss`; projector gets a hash and fetches a result that passes `assertPublicPrompt`;
- answer 200 ms after the freeze → stored `late`, result unchanged; 3 s after → `CLOSED`;
- REOPEN → run 2, phones reopen, old result kept;
- PASSIVE → all phones passive while open; answers → `CLOSED`;
- non-controller console → `NOT_CONTROLLER`; stale `rev` → `STALE`;
- demo profile on a live session → rejected;
- RESNAP after `part3_at` → `GUARD`;
- reset → Part 3 rows gone.

### 17.3 Reconnect and idempotency

- phone refresh mid-question → prompt shown again, `answered: false`;
- phone refresh after submission → `answered: true`, passive;
- the same `rid` sent 3 times (simulated dropped acks) → exactly one row, three identical acks;
- a different `rid` from the same phone → `ALREADY`;
- projector refresh on `switch:2` → same settled frame (targets equal), result fetched from cache or `need`;
- console refresh mid-question → same lease, question panel identical;
- server restart between open and close → question still open, answers still accepted.

### 17.4 E2E (Playwright)

- **`tests/e2e/fullrun.spec.ts`** (new; closes the plan2 gap): one real mobile page and 11 bots join a test session; the real phone plays Part 1, rates, sees the recap and re-rates; the console BEGINs the reveal; a projector page walks every Part 2 scene while the phone shows "Eyes up here"; then every Part 3 scene: the phone answers `felt`, `switch` (3 faders via keyboard) and `mirrors`, sees "Got it. Look up." each time; the projector shows each result; `E E` → `circle`; phone shows the end screen. Runs on mobile WebKit + projector Chromium, and on mobile Chromium + projector WebKit.
- Part 3 keyboard controls: `H`, `P`, `S`, `1`–`3`, `E E`.
- Panic paths: skip with the question open; PASSIVE while a phone has an answer half-done; zero-answer `landscape`.
- Accessibility: axe checks on `Prompt`, `Done`/`discuss` and the Question panel.
- The existing `BAD` value regex runs on every Part 3 frame.

### 17.5 Visual and performance

- `toHaveScreenshot` baselines (closes the plan2 gap) for every Part 3 beat in the `expected` profile at n = 30, at **1920×1080 and 1366×768**, with `motion: off` so frames are stable; plus plain mode at 1920×1080.
- Projector `?still=1` (implemented now; closes the plan2 gap) forces `motion: off` for screenshots.
- Phone screenshots of `Prompt` (each kind) and `discuss` at 360×640, 390×844, 430×932 and an 820×1180 tablet, in Chromium and WebKit, with reduced motion.
- `tests/perf/projector.spec.ts`: `switch` reveal and `circle` at n = 20/50/100/150, p95 frame ≤ 20 ms in Chromium (reported, not asserted, in WebKit).

---

## 18. Production polish

| Area | Work |
|---|---|
| Mobile | Prompt fits 360×640 without scrolling for `single`; `sliders` fits one step per screen; safe-area insets; no zoom on focus (16 px inputs) |
| Projector | the readability rules in §15; one idea per frame |
| Transitions | scene changes cross-fade 300 ms; phone prompt slides up 200 ms; everything respects motion modes |
| Loading | projector keeps the previous frame until the new result arrives (never a spinner on the big screen); phone shows a skeleton for < 300 ms |
| Reconnects / errors | reuse the existing `Problem` screen for fatal errors; soft errors inline; no dead ends: every phone state has a way back to "Look up" |
| Stale sessions | closed or deleted session → the phone shows "This session has ended"; the projector shows the end frame |
| Host auth | lease required for every write (fixes §1.4 #3); screen key rotation unchanged |
| Accessibility | radio/checkbox semantics, visible focus, `aria-live` for "Got it", 44 px targets, contrast ≥ 4.5:1 on phones, ≥ 7:1 on the projector |
| Keyboard | full console control without a mouse; `?` overlay lists the new keys |
| QR / short URL | unchanged (`/<CODE>`); the `bridge` frame shows the code again in the corner so latecomers can join for the discussion |
| Safari + Chrome | E2E on both engines (§17.4); `navigator.vibrate` feature-detected |
| Database errors | wrapped in `RETRY` acks; console warning; nothing crashes the process |
| Deployment | Render single instance unchanged; migration 3 is additive; README gains a Part 3 runbook section and the `sim --full` command |
| Data integrity | export gets a Part 3 aggregate sheet; the presenter log records every question event |
| Debug cleanup | no `console.log` in client bundles (lint rule); test hooks (`__screen`) only in dev/test builds |
| Console noise | E2E fails on any `console.error` or React warning on all three surfaces |

---

## 19. Implementation order

Each step ends green on `npm run typecheck && npm test && npm run build && npm run check:bundle` and is independently reviewable.

1. **Pre-Part-3 fixes** (§1.4): RESNAP guard, lease on `pres.concept`/`pres.rotateKey`, movement beat-2 tallies, projector `?still=1`.
2. **Types and content:** `src/shared/discussion.ts`, `src/server/discussion/content.ts` with the four prompts and draft copy, content unit tests. Nothing wired yet.
3. **Migration 3 and the aggregate:** tables, trigger, `aggregate.ts`, `public.ts`, unit and property tests.
4. **Service and reducer:** `services/discussion.ts`; registry scenes; beat roles; open/freeze side effects in `command()`; new commands; `phonesChanged`; integration tests (§17.2, §17.3).
5. **Phone:** `room.prompt`/`room.screen` in `views.ts`, `answer` handler with `rid`, `Prompt.tsx`, `Choice.tsx`, the passive `Done` states.
6. **Console:** Question panel, keys, optional toggles, Quotes panel with slots, pacing timer, phone pad.
7. **Projector:** `SplitBar` → `Rooms` → `Pipeline` → `Callback` → `Clusters` (optional last), with plain frames for each.
8. **Rehearsal:** discussion demo profiles, Rehearsal panel, `sim --full`.
9. **E2E, visual baselines, perf test** (§17.4, §17.5).
10. **Polish pass and README runbook** (§18); rehearse the full run on a real projector and two real phones (iPhone Safari, Android Chrome).

If time runs out, stop after step 7 without `Clusters`: the core show (`felt`, `switch`, `mirrors`, `chooser`, `circle`) is complete without `landscape`.

---

## 20. Risks

| Risk | Mitigation |
|---|---|
| It turns into a poll deck | only three core phone prompts; two projector-only moments; the phone is passive most of the time; every reveal leads to an "ASK" |
| Students feel manipulated again | `bridge` states the rules; nothing hidden; Alex labelled fictional; no feedback about them |
| Discussion doesn't start | each discuss beat has a specific, slightly provocative ASK and an adaptive line built from their data; the presenter can highlight one category to point at |
| Unexpected results (e.g. `switch` reversed) | notes and headlines are descriptive, never "as predicted"; the `unexpected` profile is rehearsed so the presenter has a line ready ("Interesting. Why might that be?") |
| Too few answers | suppression + verbal fallback; never blocks |
| Timing overrun | 15-minute core; optional scene off by default; pacing timer; `E E` to the ending |
| Phones mid-game during Part 3 | eligibility rules; Part 1 flow is never interrupted |
| Real-time failure in class | verbal lines, plain mode, hold; state survives a server restart |
| Slider carryover in `switch` | acknowledged; it's a discussion device, not a measurement |
| Sensitive disclosure | no sensitive categories, no open text, aggregate only, opt-outs everywhere |
| Quote accuracy | quote slots are empty by default; the app never shows an unfilled quote; the author fills them from the textbook with page numbers |

---

## 21. WHAT I WOULD CUT

From the brief's ten ideas:

| Idea | Decision | Why |
|---|---|---|
| 1. "Did it work on you?" | **Keep (core)**, as `felt` | the most personal link to Part 1, and the only one that can juxtapose self-report with measured data |
| 2. "Who gets to be your reference group?" (pick 3 people) | **Merged into `switch`** and a verbal follow-up | picking three real people is personal and hard to aggregate meaningfully; the switch *shows* the idea instead |
| 3. Reference-group switch | **Keep (core)**, as `switch` | the strongest visual in Part 3 |
| 4. "Choose your mirror" (friend vs top student) | **Cut as a prompt; kept as an ASK** in `switch` | a two-way vote gives a split, not an insight; it's a better spoken question |
| 5. Real-life comparison landscape | **Optional**, as `landscape`, with a safer category list | useful, but not built on Part 1; the first thing to drop when short on time |
| 6. Social comparison vs reflected appraisal | **Keep (core)**, merged with 7 into `mirrors` | the distinction students confuse most |
| 7. Alex hypothetical | **Merged into `mirrors`**, cut to two steps | four steps is too long; the two-step contrast is the concept |
| 8. "The algorithm chooses your mirror" | **Keep, projector-only**, as `chooser` | the class's own mechanism is the metaphor; a vote would be generic |
| 9. Real interface examples | **Reduced** to three text labels in `chooser` beat 3 | a gallery of product screenshots is branding and legal risk, and a lecture |
| 10. Final synthesis | **Keep**, as `circle` | the callback ending (§9) |

Also cut: any open-text input; any countdown on phones; any leaderboard or "correct answer"; any concept-definition quiz; any per-student history; any new peer data.

---

## 22. RECOMMENDED FINAL 15-20 MINUTE RUN OF SHOW

Timing starts at BEGIN REVEAL. CORE total about 15 minutes; with the optional parts about 20.

| Clock | Segment | Scene(s) | Phone | Type |
|---|---|---|---|---|
| 0:00–4:30 | Reveal (Part 2) | `onegame` → `selfrating` → `cut` → (`samescore`) → `worlds` → `movement` → `compare` → `mechanism` | Eyes up here | CORE (`samescore` OPTIONAL IF TIME) |
| 4:30–5:00 | Bridge | `bridge` | Look up | CORE |
| 5:00–8:00 | Did it work on you? | `felt` (20 s answer, 15 s reveal, ~2 min discussion) | 1 tap | CORE |
| 8:00–11:30 | Same result, three rooms | `switch` (30 s answer, 20 s reveal, ~2.5 min discussion) | 3 sliders | CORE |
| (+2:30) | Where comparison happens | `landscape` | multi-select | OPTIONAL IF TIME, skippable |
| 11:30–14:30 | Two mirrors | `mirrors` (25 s answer, 20 s reveal, ~2.5 min discussion) | 2 sliders | CORE |
| 14:30–16:30 | Who chose? | `chooser` | Look up | CORE (beat 3 examples OPTIONAL IF TIME) |
| 16:30–17:15 | Full circle | `circle` → `end` | Thanks | CORE |
| (+0–3:00) | Quote beats, closing question | concept beats, `circle` closing ASK | – | OPTIONAL IF TIME |

Shortening rules, in order:

1. Leave `landscape` off (default).
2. Leave quote slots empty or skip them (`→` past them).
3. Skip `samescore` in Part 2.
4. Cut `chooser` to beat 2 (the swap) and one question.
5. At 3 minutes left, `E E` to `circle`. The ending works from any point.

Running the core only, nothing feels missing: the arc is feel → context → mirrors → systems → callback.

---

## 23. Acceptance criteria

1. With `landscape` off and no quotes, a presenter can run BEGIN REVEAL → `end` with only `→`, in about 15 minutes, with a real class.
2. Every Part 3 phone prompt appears on eligible phones within 1 s of the beat and disappears within 1 s of the freeze; still-playing phones are never interrupted.
3. A phone that refreshes at any point returns to the correct state (prompt, answered, passive or end) without losing an answer.
4. Duplicate submissions (retries, double taps, reconnects) never create a second row.
5. The frozen result shown on the projector equals the aggregate of the responses committed at freeze; late answers never change it.
6. No projector payload contains participant ids, codenames, per-person values or cross-prompt links; categories under 5 are suppressed.
7. Every panic button in §14.2 works mid-question and is covered by a test.
8. Every Part 3 scene has a plain frame and a verbal fallback; `F`, `B`, `H`, `P` work on every beat.
9. Rehearsal: every profile × {12, 30, 60} runs the full click-through with no broken values; `unexpected` and `low` read sensibly.
10. Visual baselines pass at 1920×1080 and 1366×768; phone screenshots pass at the listed sizes in Chromium and WebKit; perf p95 ≤ 20 ms at n = 150 in Chromium.
11. `npm run typecheck && npm test && npm run build && npm run check:bundle && npm run test:e2e` green, and no console errors on any surface during E2E.
12. No textbook quote is shown unless the author entered it, with its page reference.

---

## 24. PART 3 DEFINITION OF DONE

Part 3 is done when:

- the discussion lead has rehearsed the full show (Part 1 → Part 2 → Part 3 → `circle`) on the classroom projector with `sim --full` and at least two real phones (iOS Safari and Android Chrome), and changed any copy they wanted in `content.ts`;
- the quote slots they intend to use are filled from the textbook with page numbers;
- all acceptance criteria in §23 are met and CI is green;
- the README runbook covers Part 3: order, keys, panic buttons, shortening rules and the verbal fallbacks;
- a live test session has been reset and the class session created fresh, with `landscape` set the way the presenter wants;
- and, most importantly, in rehearsal, someone who hadn't seen the plan watched the `switch` reveal and the `circle` ending and said some version of: *"Oh. I actually felt the thing we're talking about."*
