import type { Db } from '../db/db';
import { rngFrom } from '../../shared/rng';
import { makeCodename } from '../../shared/identity/codenames';
import { makeSigil } from '../../shared/identity/sigil';
import { atOrPast } from '../../shared/flow';
import { scoreAttempt } from '../../shared/game/scoring';
import type { FinishReqT, RateReqT, SeenReqT, StartReqT } from '../../shared/protocol';
import { sha256 } from '../auth';
import { assignLate } from './assignment';
import { playReleased } from '../db/repo';
import {
  addFlag,
  attemptSeed,
  getAttempt,
  getParticipant,
  getSession,
  getSessionByCode,
  logEvent,
  newId,
  sessionConfig,
  setStage,
  takenCodenames,
  type ParticipantRow,
} from '../db/repo';

export type CmdResult =
  | { ok: true; pid: string; sessionId: string; changed: boolean }
  | { ok: false; reason: 'NO_ROOM' | 'CLOSED' | 'NOT_JOINED' | 'WRONG_STAGE' | 'WAIT' | 'BAD_REQUEST' };

export const MIN_PLAY_MS = 25_000;
export const MIN_MEDIAN_RT = 250;

export function join(db: Db, code: string, token: string, now: number): CmdResult {
  return db.tx(() => {
    const s = getSessionByCode(db, code);
    if (!s) return { ok: false, reason: 'NO_ROOM' };
    const hash = sha256(token);
    const existing = db.get<ParticipantRow>('SELECT * FROM participants WHERE session_id = ? AND token_hash = ?', s.id, hash);
    if (existing) {
      db.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, existing.id);
      return { ok: true, pid: existing.id, sessionId: s.id, changed: false };
    }
    if (s.phase === 'closed') return { ok: false, reason: 'CLOSED' };
    const id = newId();
    const rng = rngFrom(`${s.seed}:id:${id}`);
    const codename = makeCodename(rng, takenCodenames(db, s.id));
    db.run(
      `INSERT INTO participants (id, session_id, kind, token_hash, codename, sigil_json, stage, joined_at, last_seen_at)
       VALUES (?, ?, 'human', ?, ?, ?, 'joined', ?, ?)`,
      id,
      s.id,
      hash,
      codename,
      JSON.stringify(makeSigil(rng)),
      now,
      now,
    );
    logEvent(db, s.id, id, 'join');
    return { ok: true, pid: id, sessionId: s.id, changed: true };
  });
}

function load(db: Db, pid: string) {
  const p = getParticipant(db, pid);
  if (!p || p.stage === 'ghost') return null;
  const s = getSession(db, p.session_id)!;
  return { p, s };
}

export function start(db: Db, pid: string, req: StartReqT, now: number): CmdResult {
  return db.tx(() => {
    const ctx = load(db, pid);
    if (!ctx) return { ok: false, reason: 'NOT_JOINED' };
    const { p, s } = ctx;
    if (p.removed_at || p.stage !== 'joined') return { ok: true, pid, sessionId: s.id, changed: false };
    if (!playReleased(db, s.id)) return { ok: false, reason: 'WAIT' };
    const cfg = sessionConfig(s);
    db.run(
      `INSERT INTO attempts (participant_id, session_id, game_version, seed, study_scale, status, started_at, stats_json)
       VALUES (?, ?, ?, ?, ?, 'playing', ?, ?) ON CONFLICT DO NOTHING`,
      pid,
      s.id,
      cfg.gameVersion,
      attemptSeed(s.seed, pid),
      cfg.studyScale,
      now,
      JSON.stringify({ practice: req.practice }),
    );
    setStage(db, pid, 'playing', now);
    return { ok: true, pid, sessionId: s.id, changed: true };
  });
}

export function finish(db: Db, pid: string, req: FinishReqT, now: number): CmdResult {
  return db.tx(() => {
    const ctx = load(db, pid);
    if (!ctx) return { ok: false, reason: 'NOT_JOINED' };
    const { p, s } = ctx;
    if (p.removed_at) return { ok: true, pid, sessionId: s.id, changed: false };
    if (p.stage === 'joined') return { ok: false, reason: 'WRONG_STAGE' };
    const attempt = getAttempt(db, pid);
    if (!attempt || attempt.status === 'complete' || p.stage !== 'playing') return { ok: true, pid, sessionId: s.id, changed: false };
    const { score, stats, rounds } = scoreAttempt(attempt.seed, req.rounds);
    const flags: string[] = [];
    if (stats.medianLockMs !== null && stats.medianLockMs < MIN_MEDIAN_RT) flags.push('too_fast');
    if (now - attempt.started_at < MIN_PLAY_MS) flags.push('too_quick');
    if (req.interruptions > 2) flags.push('interrupted');
    if (req.restarted) flags.push('restarted');
    for (const r of rounds) {
      db.run(
        `INSERT INTO rounds (participant_id, idx, variant, target, tapped, correct, rt_ms, study_ms, mask_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pid,
        r.idx,
        r.variant,
        r.target,
        r.tapped,
        r.correct ? 1 : 0,
        r.rtMs,
        r.studyMs,
        r.maskMs,
      );
    }
    const prev = attempt.stats_json ? (JSON.parse(attempt.stats_json) as object) : {};
    db.run(
      `UPDATE attempts SET status = 'complete', completed_at = ?, score = ?, stats_json = ?, flags_json = ? WHERE participant_id = ?`,
      now,
      score,
      JSON.stringify({ ...prev, ...stats, interruptions: req.interruptions }),
      JSON.stringify(flags),
      pid,
    );
    setStage(db, pid, 'scored', now);
    return { ok: true, pid, sessionId: s.id, changed: true };
  });
}

export function rate(db: Db, pid: string, req: RateReqT, now: number): CmdResult {
  return db.tx(() => {
    const ctx = load(db, pid);
    if (!ctx) return { ok: false, reason: 'NOT_JOINED' };
    const { p, s } = ctx;
    const stage = p.stage as Exclude<ParticipantRow['stage'], 'ghost'>;
    const exists = db.get('SELECT 1 FROM ratings WHERE participant_id = ? AND phase = ?', pid, req.phase);
    if (p.removed_at || exists) return { ok: true, pid, sessionId: s.id, changed: false };
    const value = Math.round(req.value * 10) / 10;
    const insert = () =>
      db.run(
        'INSERT INTO ratings (participant_id, phase, value, response_ms, adjustments, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        pid,
        req.phase,
        value,
        req.responseMs,
        req.adjustments,
        now,
      );
    if (req.phase === 'before') {
      if (!atOrPast(stage, 'scored')) return { ok: false, reason: 'WRONG_STAGE' };
      if (stage !== 'scored') return { ok: true, pid, sessionId: s.id, changed: false };
      insert();
      setStage(db, pid, 'rated_before', now);
      if (s.released_at !== null || sessionConfig(s).assignMode === 'instant') assignLate(db, s, pid, now);
      return { ok: true, pid, sessionId: s.id, changed: true };
    }
    if (!atOrPast(stage, 'assigned')) return { ok: false, reason: 'WRONG_STAGE' };
    if (stage === 'done') return { ok: true, pid, sessionId: s.id, changed: false };
    insert();
    if (stage === 'assigned') {
      db.run('UPDATE participants SET recap_seen_at = COALESCE(recap_seen_at, ?) WHERE id = ?', now, pid);
      addFlag(db, pid, 'implicit_seen');
    }
    setStage(db, pid, 'done', now);
    return { ok: true, pid, sessionId: s.id, changed: true };
  });
}

export function seen(db: Db, pid: string, req: SeenReqT, now: number): CmdResult {
  return db.tx(() => {
    const ctx = load(db, pid);
    if (!ctx) return { ok: false, reason: 'NOT_JOINED' };
    const { p, s } = ctx;
    if (p.removed_at || p.stage !== 'assigned') {
      const stage = p.stage as Exclude<ParticipantRow['stage'], 'ghost'>;
      if (!p.removed_at && !atOrPast(stage, 'assigned')) return { ok: false, reason: 'WRONG_STAGE' };
      return { ok: true, pid, sessionId: s.id, changed: false };
    }
    db.run('UPDATE assignments SET dial_dwell_ms = COALESCE(dial_dwell_ms, ?) WHERE participant_id = ?', req.dialDwellMs, pid);
    setStage(db, pid, 'recap_seen', now);
    return { ok: true, pid, sessionId: s.id, changed: true };
  });
}

export function touch(db: Db, pid: string, now: number) {
  db.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, pid);
}
