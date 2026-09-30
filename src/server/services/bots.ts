import type { Db } from '../db/db';
import { clamp, normal, rngFrom } from '../../shared/rng';
import { makeCodename } from '../../shared/identity/codenames';
import { makeSigil } from '../../shared/identity/sigil';
import { attemptSeed, getSession, newId, sessionConfig, setStage, takenCodenames } from '../db/repo';
import { assignLate } from './assignment';
import { SCORE_HI, SCORE_LO } from '../assign/thresholds';

export class BotError extends Error {}

function requireTest(db: Db, sessionId: string) {
  const s = getSession(db, sessionId);
  if (!s) throw new BotError('NO_SESSION');
  if (s.mode !== 'test') throw new BotError('LIVE_SESSION');
  return s;
}

export function spawnBots(db: Db, sessionId: string, n: number, meanScore: number, sd: number, now: number): string[] {
  return db.tx(() => {
    const s = requireTest(db, sessionId);
    const rng = rngFrom(`${s.seed}:bots:${now}`);
    const taken = takenCodenames(db, s.id);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = newId();
      const codename = makeCodename(rng, taken);
      taken.add(codename);
      const score = Math.round(clamp(meanScore + normal(rng) * sd, SCORE_LO, SCORE_HI));
      db.run(
        `INSERT INTO participants (id, session_id, kind, token_hash, codename, sigil_json, stage, joined_at, started_at, scored_at)
         VALUES (?, ?, 'bot', NULL, ?, ?, 'scored', ?, ?, ?)`,
        id,
        s.id,
        codename,
        JSON.stringify(makeSigil(rng)),
        now,
        now,
        now,
      );
      db.run(
        `INSERT INTO attempts (participant_id, session_id, game_version, seed, study_scale, status, started_at, completed_at, score, stats_json)
         VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, '{}')`,
        id,
        s.id,
        sessionConfig(s).gameVersion,
        attemptSeed(s.seed, id),
        sessionConfig(s).studyScale,
        now,
        now,
        score,
      );
      ids.push(id);
    }
    return ids;
  });
}

export const BOT_EFFECTS = {
  expected: { up: -8, neutral: 0, down: 8 },
  none: { up: 0, neutral: 0, down: 0 },
  reversed: { up: 5, neutral: 0, down: -5 },
} as const;
export type BotEffect = keyof typeof BOT_EFFECTS;

export function advanceBots(db: Db, sessionId: string, to: 'rated_before' | 'done', now: number, effect: BotEffect = 'expected'): string[] {
  return db.tx(() => {
    const s = requireTest(db, sessionId);
    const rng = rngFrom(`${s.seed}:advance:${to}:${now}`);
    const touched: string[] = [];
    if (to === 'rated_before') {
      const bots = db.all<{ id: string; score: number }>(
        `SELECT p.id, a.score FROM participants p JOIN attempts a ON a.participant_id = p.id
         WHERE p.session_id = ? AND p.kind = 'bot' AND p.stage = 'scored' AND p.removed_at IS NULL`,
        s.id,
      );
      for (const b of bots) {
        const value = Math.round(clamp(((b.score - 200) / 800) * 100 + normal(rng) * 10, 0, 100) * 10) / 10;
        db.run("INSERT INTO ratings (participant_id, phase, value, created_at) VALUES (?, 'before', ?, ?)", b.id, value, now);
        setStage(db, b.id, 'rated_before', now);
        const fresh = getSession(db, s.id)!;
        if (fresh.phase === 'released' || sessionConfig(fresh).assignMode === 'instant') assignLate(db, fresh, b.id, now);
        touched.push(b.id);
      }
    } else {
      const bots = db.all<{ id: string; stage: string; condition: 'up' | 'neutral' | 'down'; r1: number }>(
        `SELECT p.id, p.stage, x.condition, r.value AS r1 FROM participants p
         JOIN assignments x ON x.participant_id = p.id JOIN ratings r ON r.participant_id = p.id AND r.phase = 'before'
         WHERE p.session_id = ? AND p.kind = 'bot' AND p.stage IN ('assigned','recap_seen') AND p.removed_at IS NULL`,
        s.id,
      );
      for (const b of bots) {
        const value = Math.round(clamp(b.r1 + BOT_EFFECTS[effect][b.condition] + normal(rng) * 4, 0, 100) * 10) / 10;
        db.run("INSERT INTO ratings (participant_id, phase, value, created_at) VALUES (?, 'after', ?, ?)", b.id, value, now);
        db.run('UPDATE participants SET recap_seen_at = COALESCE(recap_seen_at, ?) WHERE id = ?', now, b.id);
        setStage(db, b.id, 'done', now);
        touched.push(b.id);
      }
    }
    return touched;
  });
}

export function removeBots(db: Db, sessionId: string) {
  db.tx(() => {
    requireTest(db, sessionId);
    db.run("DELETE FROM participants WHERE session_id = ? AND kind = 'bot'", sessionId);
  });
}
