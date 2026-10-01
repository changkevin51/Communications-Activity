import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db';
import { assistOn, getSession, newId, type SessionRow } from '../db/repo';
import {
  EMPTY_CONCEPT, SCENES, beatsFor, isPreReveal, nextPos, prevPos, sceneSpec, skipReason,
  type Concept, type LiveCounts, type Motion, type NavCtx, type Pos, type PresenterView, type RevealData,
  type SceneId, type ScreenState, type SnapshotCounts, type SnapshotRow, type Source, type WorldKey,
} from '../../shared/reveal';
import { eligibility, type RawRow } from '../reveal/eligibility';
import { assistRows } from '../reveal/assist';
import { derive } from '../reveal/derive';
import { assertPublic } from '../reveal/public';
import { demoRows, type Scenario } from '../reveal/demo';
import { notesFor } from '../reveal/notes';
import { DEFAULT_FLAGS, PROMPT_OF, askBeat, isPart3, roleAt, type Part3Flags, type Profile, type PromptId } from '../../shared/discussion';
import { slotQuote } from '../../shared/reveal';
import { clearPrompts, freezeOpen, latestRun, openRun, presenterQuestion, screenQuestion, syncQuestion, type DemoCfg, type QCtx } from './discussion';
import { fastForwardBots, releaseSession } from './autopilot';

export type PresRow = {
  session_id: string; scene: SceneId; beat: number; rev: number; nonce: number; hold: number; plain: number;
  motion: Motion; auto: number; snapshot_id: string | null; screen_key: string; controller: string | null;
  controller_at: number | null; concept_json: string; changed_at: number; cmd_at: number;
  phones: 'auto' | 'passive'; hide: number; focus: number | null; flags_json: string; part3_at: number | null;
};
type SnapRow = { id: string; source: Source; scenario: string | null; counts_json: string; data_json: string; hash: string };

export type Cmd =
  | { t: 'next'; rev: number; scene?: boolean }
  | { t: 'prev'; rev: number; scene?: boolean }
  | { t: 'goto'; rev: number; scene: SceneId; beat?: number }
  | { t: 'begin'; rev: number; confirm: 'BEGIN' }
  | { t: 'hold'; rev: number; on: boolean }
  | { t: 'plain'; rev: number; on: boolean }
  | { t: 'motion'; rev: number; motion: Motion }
  | { t: 'auto'; rev: number; on: boolean }
  | { t: 'replay'; rev: number }
  | { t: 'resnap'; rev: number; confirm: 'RESNAP' }
  | { t: 'rewind'; rev: number; confirm: 'REWIND' }
  | { t: 'demo'; rev: number; scenario: Scenario; n: number; seed: string; profile?: Profile }
  | { t: 'close'; rev: number }
  | { t: 'reopen'; rev: number; confirm: 'REOPEN' }
  | { t: 'hide'; rev: number; on: boolean }
  | { t: 'phones'; rev: number; mode: 'auto' | 'passive' }
  | { t: 'focus'; rev: number; i: number | null }
  | { t: 'flag'; rev: number; key: keyof Part3Flags; on: boolean }
  | { t: 'take' };

export type Reason = 'STALE' | 'NOT_CONTROLLER' | 'GUARD' | 'NO_SNAPSHOT' | 'LIVE_SESSION' | 'NO_SESSION' | 'NO_QUESTION' | 'PART3_STARTED';
export type CmdResult = { ok: true; changed: boolean; lookChanged: boolean; refresh?: string[] } | { ok: false; reason: Reason };

export const newScreenKey = () => randomBytes(24).toString('base64url');

export function ensurePresentation(db: Db, sessionId: string, now: number): PresRow | null {
  if (!getSession(db, sessionId)) return null;
  db.run('INSERT OR IGNORE INTO presentations (session_id, screen_key, changed_at) VALUES (?, ?, ?)', sessionId, newScreenKey(), now);
  return getPresentation(db, sessionId)!;
}

export function getPresentation(db: Db, sessionId: string) {
  return db.get<PresRow>('SELECT * FROM presentations WHERE session_id = ?', sessionId);
}

const dataCache = new Map<string, RevealData>();
export function snapshotData(db: Db, id: string | null): { snap: SnapRow; data: RevealData } | null {
  if (!id) return null;
  const snap = db.get<SnapRow>('SELECT id, source, scenario, counts_json, data_json, hash FROM reveal_snapshots WHERE id = ?', id);
  if (!snap) return null;
  let data = dataCache.get(snap.hash);
  if (!data) {
    data = JSON.parse(snap.data_json) as RevealData;
    if (dataCache.size > 50) dataCache.clear();
    dataCache.set(snap.hash, data);
  }
  return { snap, data };
}

export function conceptOf(row: PresRow): Concept {
  try {
    return { ...EMPTY_CONCEPT, ...(JSON.parse(row.concept_json) as Concept) };
  } catch {
    return EMPTY_CONCEPT;
  }
}

type Flags = Part3Flags & { demo?: DemoCfg };
export function flagsOf(row: PresRow): Flags {
  try {
    return { ...DEFAULT_FLAGS, ...(JSON.parse(row.flags_json) as Partial<Flags>) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export function navCtx(db: Db, row: PresRow): NavCtx {
  const f = flagsOf(row);
  return { data: snapshotData(db, row.snapshot_id)?.data ?? null, concept: conceptOf(row), flags: { landscape: f.landscape } };
}

export function qctx(db: Db, s: SessionRow, row: PresRow): QCtx {
  const snap = snapshotData(db, row.snapshot_id);
  const source: Source = snap?.snap.source ?? s.mode;
  const f = flagsOf(row);
  const demo = source === 'demo' ? f.demo ?? { profile: 'expected' as Profile, n: snap?.data.n.eligible ?? 30, seed: snap?.snap.scenario ?? 'demo' } : null;
  return { s, source, demo };
}

/** Anything a phone can see changes this string. */
export function phoneSig(db: Db, sessionId: string): string {
  const row = getPresentation(db, sessionId);
  if (!row) return '';
  let ask = '';
  if (roleAt(row.scene, row.beat) === 'ask') {
    const p = PROMPT_OF[row.scene as keyof typeof PROMPT_OF]!;
    const r = latestRun(db, sessionId, p);
    ask = r ? `${p}:${r.run}:${r.phase}` : p;
  }
  const play = row.scene === 'lobby' ? 0 : 1;
  return [row.snapshot_id, row.part3_at ? 1 : 0, row.phones, row.scene === 'end' ? 1 : 0, play, ask].join('|');
}

export function loadRaw(db: Db, sessionId: string): RawRow[] {
  const rows = db.all<Omit<RawRow, 'peers'>>(
    `SELECT p.id, p.kind, p.stage, p.removed_at, p.started_at, a.score, a.status AS attempt_status, a.flags_json AS attempt_flags,
       rb.value AS r1, ra.value AS r2, x.condition AS world, x.stratum, x.dial_dwell_ms AS dwell_ms
     FROM participants p
     LEFT JOIN attempts a ON a.participant_id = p.id
     LEFT JOIN ratings rb ON rb.participant_id = p.id AND rb.phase = 'before'
     LEFT JOIN ratings ra ON ra.participant_id = p.id AND ra.phase = 'after'
     LEFT JOIN assignments x ON x.participant_id = p.id
     WHERE p.session_id = ? AND p.kind != 'ghost'`,
    sessionId,
  );
  const peers = db.all<{ viewer_id: string; peer_score: number; peer_kind: string }>(
    `SELECT sp.viewer_id, sp.peer_score, sp.peer_kind FROM shown_peers sp JOIN participants v ON v.id = sp.viewer_id
     WHERE v.session_id = ? ORDER BY sp.viewer_id, sp.slot`,
    sessionId,
  );
  const by = new Map<string, { score: number; real: boolean }[]>();
  for (const p of peers) by.set(p.viewer_id, [...(by.get(p.viewer_id) ?? []), { score: p.peer_score, real: p.peer_kind !== 'ghost' }]);
  return rows.map((r) => ({ ...r, peers: by.get(r.id) ?? [] }));
}

function insertSnapshot(db: Db, s: SessionRow, source: Source, scenario: string | null, seed: string | null, rows: SnapshotRow[], counts: SnapshotCounts, stillFinishing: number, now: number): string {
  const data = assertPublic(derive(rows, { source, scenario, stillFinishing }));
  const json = JSON.stringify(data);
  const id = newId();
  db.run(
    `INSERT INTO reveal_snapshots (id, session_id, source, scenario, seed, version, created_at, counts_json, rows_json, data_json, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, s.id, source, scenario, seed, data.version, now, JSON.stringify(counts), JSON.stringify(rows), json,
    createHash('sha256').update(json).digest('hex'),
  );
  return id;
}

export function freeze(db: Db, s: SessionRow, now: number): string {
  const e = eligibility(loadRaw(db, s.id), s.mode, s.seed);
  const assisted = assistOn(s) ? assistRows(e.rows, s.seed) : { rows: e.rows, info: null };
  const counts: SnapshotCounts = { ...e.counts, assist: assisted.info };
  return insertSnapshot(db, s, s.mode, null, null, assisted.rows, counts, e.stillFinishing, now);
}

export function freezeDemo(db: Db, s: SessionRow, scenario: Scenario, n: number, seed: string, now: number): string {
  const { rows, stillFinishing } = demoRows(scenario, n, seed);
  const zero = { removed: 0, invalid: 0, noScore: 0, stillPlaying: stillFinishing };
  const counts: SnapshotCounts = { joined: rows.length + stillFinishing, started: rows.length + stillFinishing, scored: rows.length, ratedBefore: rows.length, assigned: rows.length, done: rows.filter((r) => r.r2 !== null).length, flagged: 0, excluded: zero };
  return insertSnapshot(db, s, 'demo', scenario, seed, rows, counts, stillFinishing, now);
}

type Patch = Partial<Pick<PresRow, 'scene' | 'beat' | 'nonce' | 'hold' | 'plain' | 'motion' | 'auto' | 'snapshot_id' | 'phones' | 'hide' | 'focus' | 'flags_json' | 'part3_at'>>;

function apply(db: Db, row: PresRow, patch: Patch, cmd: string, now: number) {
  const next = { ...row, ...patch };
  const moved = next.scene !== row.scene || next.beat !== row.beat || next.nonce !== row.nonce || next.snapshot_id !== row.snapshot_id;
  db.run(
    `UPDATE presentations SET scene = ?, beat = ?, nonce = ?, hold = ?, plain = ?, motion = ?, auto = ?, snapshot_id = ?,
       phones = ?, hide = ?, focus = ?, flags_json = ?, part3_at = ?, rev = rev + 1, changed_at = ?, cmd_at = ? WHERE session_id = ?`,
    next.scene, next.beat, next.nonce, next.hold, next.plain, next.motion, next.auto, next.snapshot_id,
    next.phones, next.hide, next.focus, next.flags_json, next.part3_at,
    moved || next.hide !== row.hide ? now : row.changed_at, cmd === 'auto-follow' ? row.cmd_at : now, row.session_id,
  );
  db.run(
    'INSERT INTO presentation_log (session_id, at, cmd, from_scene, from_beat, to_scene, to_beat, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    row.session_id, now, cmd, row.scene, row.beat, next.scene, next.beat, row.rev + 1,
  );
}

function logSkips(db: Db, row: PresRow, from: Pos, to: Pos, ctx: NavCtx, now: number) {
  const a = SCENES.findIndex((s) => s.id === from.scene);
  const b = SCENES.findIndex((s) => s.id === to.scene);
  for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) {
    if (skipReason(SCENES[i].id, ctx))
      db.run(
        'INSERT INTO presentation_log (session_id, at, cmd, from_scene, from_beat, to_scene, to_beat, rev) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)',
        row.session_id, now, 'skip', SCENES[i].id, row.rev,
      );
  }
}

export function command(db: Db, sessionId: string, leaseId: string, cmd: Cmd, now: number): CmdResult {
  return db.tx((): CmdResult => {
    const s = getSession(db, sessionId);
    if (!s) return { ok: false, reason: 'NO_SESSION' };
    const row = ensurePresentation(db, sessionId, now)!;
    if (cmd.t === 'take') {
      if (row.controller !== leaseId) db.run('UPDATE presentations SET controller = ?, controller_at = ?, rev = rev + 1 WHERE session_id = ?', leaseId, now, sessionId);
      return { ok: true, changed: row.controller !== leaseId, lookChanged: false };
    }
    if (row.controller && row.controller !== leaseId) return { ok: false, reason: 'NOT_CONTROLLER' };
    if (cmd.rev !== row.rev) return { ok: false, reason: 'STALE' };
    if (!row.controller) {
      db.run('UPDATE presentations SET controller = ?, controller_at = ? WHERE session_id = ?', leaseId, now, sessionId);
      row.controller = leaseId;
    }
    const ctx = navCtx(db, row);
    const pos: Pos = { scene: row.scene, beat: row.beat };
    const sig = phoneSig(db, sessionId);
    const done = (patch: Patch, name: string): CmdResult => {
      const to = { scene: patch.scene ?? row.scene, beat: patch.beat ?? row.beat };
      const moved = to.scene !== row.scene || to.beat !== row.beat;
      if (moved) {
        patch = { hide: 0, focus: null, ...patch };
        if (isPart3(to.scene) && row.part3_at === null && patch.part3_at === undefined) patch.part3_at = now;
      }
      apply(db, row, patch, name, now);
      if (moved && patch.snapshot_id === undefined) syncQuestion(db, qctx(db, s, { ...row, ...patch }), pos, to, now);
      return { ok: true, changed: true, lookChanged: phoneSig(db, sessionId) !== sig };
    };
    /** Arriving at stand-by is the cue to send waiting phones their three scores. */
    const arrive = (to: Pos, result: CmdResult): CmdResult => {
      if (!result.ok || to.scene !== 'hold' || row.scene === 'hold') return result;
      const refresh = releaseSession(db, s, now);
      return refresh.length ? { ...result, refresh } : result;
    };
    const reset: Patch = { phones: 'auto', hide: 0, focus: null, part3_at: null };
    const prompt = PROMPT_OF[row.scene as keyof typeof PROMPT_OF] as PromptId | undefined;
    switch (cmd.t) {
      case 'next':
      case 'prev': {
        const to = cmd.t === 'next' ? nextPos(pos, ctx, cmd.scene) : prevPos(pos, ctx, cmd.scene);
        if (!to) {
          if (cmd.t === 'next' && isPreReveal(row.scene) && row.scene === 'hold') return { ok: false, reason: 'NO_SNAPSHOT' };
          return { ok: true, changed: false, lookChanged: false };
        }
        logSkips(db, row, pos, to, ctx, now);
        return arrive(to, done({ scene: to.scene, beat: to.beat, hold: 0 }, cmd.t));
      }
      case 'goto': {
        const spec = sceneSpec(cmd.scene);
        if (!spec) return { ok: false, reason: 'GUARD' };
        if (isPreReveal(cmd.scene) !== isPreReveal(row.scene)) return { ok: false, reason: isPreReveal(row.scene) ? 'NO_SNAPSHOT' : 'GUARD' };
        if (skipReason(cmd.scene, ctx)) return { ok: false, reason: 'GUARD' };
        const beat = Math.max(0, Math.min(beatsFor(cmd.scene, ctx) - 1, cmd.beat ?? 0));
        return arrive({ scene: cmd.scene, beat }, done({ scene: cmd.scene, beat, hold: 0 }, 'goto'));
      }
      case 'begin': {
        if (!isPreReveal(row.scene)) return { ok: true, changed: false, lookChanged: false };
        const fast = s.mode === 'test' ? fastForwardBots(db, s, 'done', now) : null;
        const result = done({ scene: 'onegame', beat: 0, hold: 0, snapshot_id: freeze(db, s, now) }, 'begin');
        return result.ok && fast?.refresh.length ? { ...result, refresh: fast.refresh } : result;
      }
      case 'resnap': {
        if (row.part3_at !== null) return { ok: false, reason: 'PART3_STARTED' };
        const fast = s.mode === 'test' ? fastForwardBots(db, s, 'done', now) : null;
        const result = done({ scene: 'onegame', beat: 0, hold: 0, snapshot_id: freeze(db, s, now) }, 'resnap');
        return result.ok && fast?.refresh.length ? { ...result, refresh: fast.refresh } : result;
      }
      case 'demo': {
        if (s.mode !== 'test') return { ok: false, reason: 'LIVE_SESSION' };
        clearPrompts(db, sessionId);
        const flags = { ...flagsOf(row), demo: { profile: cmd.profile ?? 'expected', n: cmd.n, seed: cmd.seed } };
        return done({ ...reset, scene: 'onegame', beat: 0, hold: 0, flags_json: JSON.stringify(flags), snapshot_id: freezeDemo(db, s, cmd.scenario, cmd.n, cmd.seed, now) }, `demo:${cmd.scenario}`);
      }
      case 'rewind': {
        clearPrompts(db, sessionId);
        const { demo: _demo, ...flags } = flagsOf(row);
        return done({ ...reset, scene: 'lobby', beat: 0, hold: 0, snapshot_id: null, flags_json: JSON.stringify(flags) }, 'rewind');
      }
      case 'close':
        if (!prompt || !freezeOpen(db, qctx(db, s, row), prompt, now)) return { ok: false, reason: 'NO_QUESTION' };
        return done({}, `close:${prompt}`);
      case 'reopen': {
        if (!prompt || !latestRun(db, sessionId, prompt)) return { ok: false, reason: 'NO_QUESTION' };
        const q = qctx(db, s, row);
        freezeOpen(db, q, prompt, now);
        const run = openRun(db, q, prompt, now);
        const ask = ROLES_ASK(row.scene);
        return done({ beat: ask, hide: 0, focus: null, phones: 'auto' }, `reopen:${prompt}:${run}`);
      }
      case 'hide':
        return done({ hide: cmd.on ? 1 : 0 }, cmd.on ? 'hide' : 'unhide');
      case 'phones':
        return done({ phones: cmd.mode }, `phones:${cmd.mode}`);
      case 'focus':
        return done({ focus: cmd.i }, cmd.i === null ? 'unfocus' : `focus:${cmd.i}`);
      case 'flag': {
        const { demo, ...rest } = flagsOf(row);
        const flags = { ...rest, [cmd.key]: cmd.on, ...(demo ? { demo } : {}) };
        return done({ flags_json: JSON.stringify(flags) }, `flag:${cmd.key}:${cmd.on ? 'on' : 'off'}`);
      }
      case 'hold':
        return done({ hold: cmd.on ? 1 : 0 }, cmd.on ? 'hold' : 'unhold');
      case 'plain':
        return done({ plain: cmd.on ? 1 : 0 }, cmd.on ? 'plain' : 'unplain');
      case 'motion':
        return done({ motion: cmd.motion }, `motion:${cmd.motion}`);
      case 'auto':
        return done({ auto: cmd.on ? 1 : 0 }, cmd.on ? 'auto' : 'manual');
      case 'replay':
        return done({ nonce: row.nonce + 1 }, 'replay');
    }
  });
}

const ROLES_ASK = (scene: SceneId) => (isPart3(scene) ? Math.max(0, askBeat(scene)) : 0);

export function releaseLease(db: Db, sessionId: string, leaseId: string) {
  db.run('UPDATE presentations SET controller = NULL, rev = rev + 1 WHERE session_id = ? AND controller = ?', sessionId, leaseId);
}

export function setConcept(db: Db, sessionId: string, concept: Concept, now: number) {
  ensurePresentation(db, sessionId, now);
  db.run('UPDATE presentations SET concept_json = ?, rev = rev + 1 WHERE session_id = ?', JSON.stringify(concept), sessionId);
}

export function rotateScreenKey(db: Db, sessionId: string, now: number): string {
  ensurePresentation(db, sessionId, now);
  const key = newScreenKey();
  db.run('UPDATE presentations SET screen_key = ?, rev = rev + 1 WHERE session_id = ?', key, sessionId);
  return key;
}

export function liveCounts(db: Db, s: SessionRow): LiveCounts {
  const kinds = s.mode === 'live' ? "('human')" : "('human','bot')";
  const r = db.get<{ joined: number; started: number; playing: number; rating: number; done: number }>(
    `SELECT COUNT(*) AS joined,
       COALESCE(SUM(CASE WHEN stage != 'joined' THEN 1 ELSE 0 END), 0) AS started,
       COALESCE(SUM(CASE WHEN stage = 'playing' THEN 1 ELSE 0 END), 0) AS playing,
       COALESCE(SUM(CASE WHEN stage IN ('scored','rated_before','assigned','recap_seen') THEN 1 ELSE 0 END), 0) AS rating,
       COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done
     FROM participants WHERE session_id = ? AND kind IN ${kinds} AND removed_at IS NULL`,
    s.id,
  )!;
  return { ...r, code: s.code };
}

export const AUTO_QUIET_MS = 10_000;

export function autoFollow(db: Db, sessionId: string, now: number): { changed: boolean; refresh: string[] } {
  return db.tx(() => {
    const row = getPresentation(db, sessionId);
    const s = getSession(db, sessionId);
    if (!row || !s || !row.auto || row.scene === 'lobby' || !isPreReveal(row.scene) || now - row.cmd_at < AUTO_QUIET_MS) return { changed: false, refresh: [] };
    const c = liveCounts(db, s);
    const want: SceneId = c.started >= 1 && c.done >= 0.9 * c.started ? 'hold' : 'playing';
    if (want === row.scene) return { changed: false, refresh: [] };
    apply(db, row, { scene: want, beat: 0 }, 'auto-follow', now);
    return { changed: true, refresh: want === 'hold' ? releaseSession(db, s, now) : [] };
  });
}

export function screenState(db: Db, sessionId: string, now: number): ScreenState | null {
  const s = getSession(db, sessionId);
  const row = s ? ensurePresentation(db, sessionId, now) : null;
  if (!s || !row) return null;
  const ctx = navCtx(db, row);
  const snap = snapshotData(db, row.snapshot_id);
  const st: ScreenState = {
    rev: row.rev,
    mode: s.mode,
    serverNow: now,
    changedAt: row.changed_at,
    scene: row.scene,
    beat: row.beat,
    beats: beatsFor(row.scene, ctx),
    nonce: row.nonce,
    hold: !!row.hold,
    plain: !!row.plain,
    motion: row.motion,
    source: snap?.snap.source ?? null,
    scenario: snap?.snap.scenario ?? null,
    dataHash: snap?.snap.hash ?? null,
  };
  if (isPreReveal(row.scene)) st.live = liveCounts(db, s);
  if (row.scene === 'concept') st.concept = ctx.concept;
  if (isPart3(row.scene)) {
    const q = screenQuestion(db, qctx(db, s, row), row.scene, row.beat);
    if (q) st.q = q;
    st.hide = !!row.hide;
    st.focus = row.focus;
    if (roleAt(row.scene, row.beat) === 'concept') st.slot = slotQuote(ctx.concept, row.scene);
  }
  if (!isPreReveal(row.scene) && snap && snap.snap.source !== 'demo') {
    const counts = JSON.parse(snap.snap.counts_json) as SnapshotCounts;
    st.late = Math.max(0, liveCounts(db, s).done - counts.done);
  }
  return st;
}

export function presenterView(db: Db, sessionId: string, now: number, conn: { phones: number; projectors: number }): PresenterView | null {
  const s = getSession(db, sessionId);
  const st = screenState(db, sessionId, now);
  const row = getPresentation(db, sessionId);
  if (!s || !st || !row) return null;
  const ctx = navCtx(db, row);
  const snap = snapshotData(db, row.snapshot_id);
  const c = liveCounts(db, s);
  const worlds = (d: RevealData) =>
    Object.fromEntries((['up', 'neutral', 'down'] as WorldKey[]).map((w) => [w, { n: d.worlds[w].n, nPaired: d.worlds[w].nPaired }])) as Record<WorldKey, { n: number; nPaired: number }>;
  const counts = snap ? (JSON.parse(snap.snap.counts_json) as SnapshotCounts) : null;
  const question = presenterQuestion(db, qctx(db, s, row), row.scene, row.beat);
  return {
    ...st,
    sessionId: s.id,
    code: s.code,
    phase: s.phase,
    released: s.released_at !== null,
    assist: assistOn(s),
    auto: !!row.auto,
    screenKey: row.screen_key,
    lease: { controller: row.controller },
    readiness: { joined: c.joined, started: c.started, playing: c.playing, rating: c.rating, done: c.done, ...conn },
    health: snap && counts
      ? { counts, n: snap.data.n, worlds: worlds(snap.data), pattern: snap.data.pattern, warnings: snap.data.warnings }
      : null,
    strip: SCENES.map((x) => ({ scene: x.id, beats: beatsFor(x.id, ctx), skip: skipReason(x.id, ctx) })),
    conceptConfig: ctx.concept,
    notes: notesFor(row.scene, row.beat, snap?.data ?? null, {
      assist: counts?.assist ?? null,
      slotText: isPart3(row.scene) ? slotQuote(ctx.concept, row.scene)?.text ?? null : null,
      questionSplit: question?.split ?? null,
    }),
    question,
    flags: { landscape: flagsOf(row).landscape },
    phones: row.phones,
    part3At: row.part3_at,
  };
}

export function isLook(db: Db, sessionId: string): boolean {
  return !!db.get<{ x: number }>('SELECT 1 AS x FROM presentations WHERE session_id = ? AND snapshot_id IS NOT NULL', sessionId);
}
