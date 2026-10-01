import type { Db } from '../db/db';
import { clamp, normal, rngFrom } from '../../shared/rng';
import { makeCodename } from '../../shared/identity/codenames';
import { makeSigil } from '../../shared/identity/sigil';
import { getSession, newId, takenCodenames } from '../db/repo';
import { SCORE_HI, SCORE_LO } from '../assign/thresholds';
import { fastForwardBots, makeBotPlan, type BotEffect, type BotTarget } from './autopilot';

export { BOT_EFFECTS } from './autopilot';
export type { BotEffect } from './autopilot';

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
        `INSERT INTO participants (id, session_id, kind, token_hash, codename, sigil_json, stage, joined_at, bot_json)
         VALUES (?, ?, 'bot', NULL, ?, ?, 'joined', ?, ?)`,
        id,
        s.id,
        codename,
        JSON.stringify(makeSigil(rng)),
        now,
        JSON.stringify(makeBotPlan(s.seed, id, score)),
      );
      ids.push(id);
    }
    return ids;
  });
}

export const advanceBots = (db: Db, sessionId: string, to: BotTarget, now: number, effect: BotEffect = 'expected') =>
  fastForwardBots(db, requireTest(db, sessionId), to, now, effect);

export function removeBots(db: Db, sessionId: string) {
  db.tx(() => {
    requireTest(db, sessionId);
    db.run("DELETE FROM participants WHERE session_id = ? AND kind = 'bot'", sessionId);
  });
}
