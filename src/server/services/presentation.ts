import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db';
import { getSession, newId, type SessionRow } from '../db/repo';
import {
  EMPTY_CONCEPT, SCENES, beatsFor, isPreReveal, nextPos, prevPos, sceneSpec, skipReason,
  type Concept, type LiveCounts, type Motion, type NavCtx, type Pos, type PresenterView, type RevealData,
  type SceneId, type ScreenState, type SnapshotCounts, type SnapshotRow, type Source, type WorldKey,
} from '../../shared/reveal';
import { eligibility, type RawRow } from '../reveal/eligibility';
import { derive } from '../reveal/derive';
import { assertPublic } from '../reveal/public';
import { demoRows, type Scenario } from '../reveal/demo';
import { notesFor } from '../reveal/registry';

export type PresRow = {
  session_id: string; scene: SceneId; beat: number; rev: number; nonce: number; hold: number; plain: number;
  motion: Motion; auto: number; snapshot_id: string | null; screen_key: string; controller: string | null;
  controller_at: number | null; concept_json: string; changed_at: number; cmd_at: number;
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
  | { t: 'demo'; rev: number; scenario: Scenario; n: number; seed: string }
  | { t: 'take' };

export type Reason = 'STALE' | 'NOT_CONTROLLER' | 'GUARD' | 'NO_SNAPSHOT' | 'LIVE_SESSION' | 'NO_SESSION';
export type CmdResult = { ok: true; changed: boolean; lookChanged: boolean } | { ok: false; reason: Reason };

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

export function navCtx(db: Db, row: PresRow): NavCtx {
  return { data: snapshotData(db, row.snapshot_id)?.data ?? null, concept: conceptOf(row) };
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
  return insertSnapshot(db, s, s.mode, null, null, e.rows, e.counts, e.stillFinishing, now);
}

export function freezeDemo(db: Db, s: SessionRow, scenario: Scenario, n: number, seed: string, now: number): string {
  const { rows, stillFinishing } = demoRows(scenario, n, seed);
  const zero = { removed: 0, invalid: 0, noScore: 0, stillPlaying: stillFinishing };
  const counts: SnapshotCounts = { joined: rows.length + stillFinishing, started: rows.length + stillFinishing, scored: rows.length, ratedBefore: rows.length, assigned: rows.length, done: rows.filter((r) => r.r2 !== null).length, flagged: 0, excluded: zero };
  return insertSnapshot(db, s, 'demo', scenario, seed, rows, counts, stillFinishing, now);
}

type Patch = Partial<Pick<PresRow, 'scene' | 'beat' | 'nonce' | 'hold' | 'plain' | 'motion' | 'auto' | 'snapshot_id'>>;

function apply(db: Db, row: PresRow, patch: Patch, cmd: string, now: number) {
  const next = { ...row, ...patch };
  const moved = next.scene !== row.scene || next.beat !== row.beat || next.nonce !== row.nonce || next.snapshot_id !== row.snapshot_id;
  db.run(
    `UPDATE presentations SET scene = ?, beat = ?, nonce = ?, hold = ?, plain = ?, motion = ?, auto = ?, snapshot_id = ?,
       rev = rev + 1, changed_at = ?, cmd_at = ? WHERE session_id = ?`,
    next.scene, next.beat, next.nonce, next.hold, next.plain, next.motion, next.auto, next.snapshot_id,
    moved ? now : row.changed_at, cmd === 'auto-follow' ? row.cmd_at : now, row.session_id,
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
    const hadSnap = row.snapshot_id !== null;
    const done = (patch: Patch, name: string): CmdResult => {
      apply(db, row, patch, name, now);
      const hasSnap = (patch.snapshot_id !== undefined ? patch.snapshot_id : row.snapshot_id) !== null;
      return { ok: true, changed: true, lookChanged: hasSnap !== hadSnap };
    };
    switch (cmd.t) {
      case 'next':
      case 'prev': {
        const to = cmd.t === 'next' ? nextPos(pos, ctx, cmd.scene) : prevPos(pos, ctx, cmd.scene);
        if (!to) {
          if (cmd.t === 'next' && isPreReveal(row.scene) && row.scene === 'hold') return { ok: false, reason: 'NO_SNAPSHOT' };
          return { ok: true, changed: false, lookChanged: false };
        }
        logSkips(db, row, pos, to, ctx, now);
        return done({ scene: to.scene, beat: to.beat, hold: 0 }, cmd.t);
      }
      case 'goto': {
        const spec = sceneSpec(cmd.scene);
        if (!spec) return { ok: false, reason: 'GUARD' };
        if (isPreReveal(cmd.scene) !== isPreReveal(row.scene)) return { ok: false, reason: isPreReveal(row.scene) ? 'NO_SNAPSHOT' : 'GUARD' };
        if (skipReason(cmd.scene, ctx)) return { ok: false, reason: 'GUARD' };
        const beat = Math.max(0, Math.min(beatsFor(cmd.scene, ctx) - 1, cmd.beat ?? 0));
        return done({ scene: cmd.scene, beat, hold: 0 }, 'goto');
      }
      case 'begin': {
        if (!isPreReveal(row.scene)) return { ok: true, changed: false, lookChanged: false };
        return done({ scene: 'onegame', beat: 0, hold: 0, snapshot_id: freeze(db, s, now) }, 'begin');
      }
      case 'resnap':
        return done({ scene: 'onegame', beat: 0, hold: 0, snapshot_id: freeze(db, s, now) }, 'resnap');
      case 'demo':
        if (s.mode !== 'test') return { ok: false, reason: 'LIVE_SESSION' };
        return done({ scene: 'onegame', beat: 0, hold: 0, snapshot_id: freezeDemo(db, s, cmd.scenario, cmd.n, cmd.seed, now) }, `demo:${cmd.scenario}`);
      case 'rewind':
        return done({ scene: 'lobby', beat: 0, hold: 0, snapshot_id: null }, 'rewind');
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

export function autoFollow(db: Db, sessionId: string, now: number): boolean {
  return db.tx(() => {
    const row = getPresentation(db, sessionId);
    const s = getSession(db, sessionId);
    if (!row || !s || !row.auto || !isPreReveal(row.scene) || now - row.cmd_at < AUTO_QUIET_MS) return false;
    const c = liveCounts(db, s);
    const want: SceneId = c.started < 1 ? 'lobby' : c.done >= 0.9 * c.started ? 'hold' : 'playing';
    if (want === row.scene) return false;
    apply(db, row, { scene: want, beat: 0 }, 'auto-follow', now);
    return true;
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
  if (row.scene === 'end' && snap && snap.snap.source !== 'demo') {
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
  return {
    ...st,
    sessionId: s.id,
    code: s.code,
    phase: s.phase,
    auto: !!row.auto,
    screenKey: row.screen_key,
    lease: { controller: row.controller },
    readiness: { joined: c.joined, started: c.started, playing: c.playing, rating: c.rating, done: c.done, ...conn },
    health: snap
      ? { counts: JSON.parse(snap.snap.counts_json) as SnapshotCounts, n: snap.data.n, worlds: worlds(snap.data), pattern: snap.data.pattern, warnings: snap.data.warnings }
      : null,
    strip: SCENES.map((x) => ({ scene: x.id, beats: beatsFor(x.id, ctx), skip: skipReason(x.id, ctx) })),
    conceptConfig: ctx.concept,
    notes: notesFor(row.scene, row.beat, snap?.data ?? null),
  };
}

export function isLook(db: Db, sessionId: string): boolean {
  return !!db.get<{ x: number }>('SELECT 1 AS x FROM presentations WHERE session_id = ? AND snapshot_id IS NOT NULL', sessionId);
}
