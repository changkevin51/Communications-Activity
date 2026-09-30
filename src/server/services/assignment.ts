import type { Db } from '../db/db';
import { rngFrom } from '../../shared/rng';
import { makeCodename } from '../../shared/identity/codenames';
import { makeSigil } from '../../shared/identity/sigil';
import { assignBatch, assignOne, type AssignInput, type AssignOutput } from '../assign/assign';
import type { PoolMember } from '../assign/peers';
import { computeThresholds, type Condition, type Thresholds } from '../assign/thresholds';
import { LATE_REVEAL_MS } from '../config';
import {
  addFlag,
  getParticipant,
  logEvent,
  newId,
  sessionConfig,
  setStage,
  takenCodenames,
  type SessionRow,
} from '../db/repo';

export function realPool(db: Db, sessionId: string): PoolMember[] {
  return db.all<PoolMember>(
    `SELECT p.id AS id, a.score AS score, p.kind AS kind FROM participants p JOIN attempts a ON a.participant_id = p.id
     WHERE p.session_id = ? AND p.kind IN ('human','bot') AND a.status = 'complete' AND p.removed_at IS NULL
       AND a.flags_json = '[]' AND a.score IS NOT NULL`,
    sessionId,
  );
}

export function ghostPool(db: Db, sessionId: string): PoolMember[] {
  return db.all<PoolMember>(
    `SELECT p.id AS id, a.score AS score, p.kind AS kind FROM participants p JOIN attempts a ON a.participant_id = p.id
     WHERE p.session_id = ? AND p.kind = 'ghost'`,
    sessionId,
  );
}

export function exposureMap(db: Db, sessionId: string): Map<string, number> {
  const rows = db.all<{ peer_id: string; n: number }>(
    `SELECT sp.peer_id AS peer_id, COUNT(*) AS n FROM shown_peers sp JOIN participants v ON v.id = sp.viewer_id
     WHERE v.session_id = ? GROUP BY sp.peer_id`,
    sessionId,
  );
  return new Map(rows.map((r) => [r.peer_id, Number(r.n)]));
}

function buildInput(db: Db, session: SessionRow, th: Thresholds, rngSeed: string): AssignInput {
  const cfg = sessionConfig(session);
  return {
    real: realPool(db, session.id),
    ghosts: ghostPool(db, session.id),
    exposure: exposureMap(db, session.id),
    th,
    rng: rngFrom(rngSeed),
    makeGhost: (score) => ({ id: newId(), score }),
    policy: cfg.ghostPolicy,
  };
}

function persist(db: Db, session: SessionRow, out: AssignOutput, batch: 'release' | 'late' | 'instant', th: Thresholds, revealAt: number, now: number) {
  const taken = takenCodenames(db, session.id);
  for (const g of out.newGhosts) {
    const rng = rngFrom(`${session.seed}:ghost:${g.id}`);
    const codename = makeCodename(rng, taken);
    taken.add(codename);
    db.run(
      `INSERT INTO participants (id, session_id, kind, token_hash, codename, sigil_json, stage, joined_at, flags_json)
       VALUES (?, ?, 'ghost', NULL, ?, ?, 'ghost', ?, '["generated"]')`,
      g.id,
      session.id,
      codename,
      JSON.stringify(makeSigil(rng)),
      now,
    );
    db.run(
      `INSERT INTO attempts (participant_id, session_id, game_version, seed, study_scale, status, started_at, completed_at, score)
       VALUES (?, ?, 'ghost', '', 1, 'complete', ?, ?, ?)`,
      g.id,
      session.id,
      now,
      now,
      g.score,
    );
  }
  const thJson = JSON.stringify(th);
  for (const a of out.assignments) {
    db.run(
      `INSERT INTO assignments (participant_id, session_id, condition, batch, stratum, viewer_score, thresholds_json, algo_version, assigned_at, reveal_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.viewerId,
      session.id,
      a.condition,
      batch,
      a.stratum,
      a.viewerScore,
      thJson,
      th.algoVersion,
      now,
      revealAt,
    );
    for (const p of a.peers) {
      db.run(
        'INSERT INTO shown_peers (viewer_id, slot, peer_id, peer_kind, peer_score, diff) VALUES (?, ?, ?, ?, ?, ?)',
        a.viewerId,
        p.slot,
        p.id,
        p.kind,
        p.score,
        p.diff,
      );
    }
    if (a.degraded) addFlag(db, a.viewerId, 'degraded');
    setStage(db, a.viewerId, 'assigned', now);
  }
}

function waitingViewers(db: Db, sessionId: string) {
  return db.all<{ id: string; score: number }>(
    `SELECT p.id AS id, a.score AS score FROM participants p JOIN attempts a ON a.participant_id = p.id
     WHERE p.session_id = ? AND p.stage = 'rated_before' AND p.removed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM assignments x WHERE x.participant_id = p.id)`,
    sessionId,
  );
}

export function release(db: Db, session: SessionRow, now: number): string[] {
  if (session.phase !== 'open') return [];
  const cfg = sessionConfig(session);
  const real = realPool(db, session.id);
  const th = computeThresholds(real.map((r) => r.score), cfg.peers);
  const viewers = waitingViewers(db, session.id);
  const input = buildInput(db, session, th, `${session.seed}:release`);
  const out = assignBatch(viewers, input);
  const revealAt = now + cfg.countdownMs;
  persist(db, session, out, 'release', th, revealAt, now);
  const counts: Record<Condition, number> = { up: 0, neutral: 0, down: 0 };
  for (const a of out.assignments) counts[a.condition]++;
  const releaseJson = { thresholds: th, counts, viewers: viewers.length, pool: real.length, newGhosts: out.newGhosts.length };
  db.run(
    "UPDATE sessions SET phase = 'released', released_at = ?, reveal_at = ?, release_json = ? WHERE id = ? AND phase = 'open'",
    now,
    revealAt,
    JSON.stringify(releaseJson),
    session.id,
  );
  logEvent(db, session.id, null, 'release', { viewers: viewers.length, newGhosts: out.newGhosts.length });
  return out.assignments.map((a) => a.viewerId);
}

export function assignLate(db: Db, session: SessionRow, pid: string, now: number): boolean {
  const p = getParticipant(db, pid);
  if (!p || p.stage !== 'rated_before' || p.removed_at) return false;
  if (db.get('SELECT 1 FROM assignments WHERE participant_id = ?', pid)) return false;
  const score = db.get<{ score: number }>('SELECT score FROM attempts WHERE participant_id = ?', pid)?.score;
  if (score === undefined || score === null) return false;
  const cfg = sessionConfig(session);
  const instant = session.phase === 'open' && cfg.assignMode === 'instant';
  const frozen = session.release_json ? (JSON.parse(session.release_json) as { thresholds: Thresholds }).thresholds : null;
  const th = !instant && frozen ? frozen : computeThresholds(realPool(db, session.id).map((r) => r.score), cfg.peers);
  const prior = db.all<{ condition: Condition; viewerScore: number }>(
    'SELECT condition, viewer_score AS viewerScore FROM assignments WHERE session_id = ?',
    session.id,
  );
  const input = buildInput(db, session, th, `${session.seed}:late:${pid}`);
  const out = assignOne({ id: pid, score }, prior, input);
  persist(db, session, out, instant ? 'instant' : 'late', th, now + LATE_REVEAL_MS, now);
  return true;
}
