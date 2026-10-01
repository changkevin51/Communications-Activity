import type { Db } from '../db/db';
import { clamp, normal, rngFrom } from '../../shared/rng';
import { PROMPT_IDS, type PromptId } from '../../shared/discussion';
import type { Condition } from '../assign/thresholds';
import { SCORE_HI, SCORE_LO } from '../assign/thresholds';
import { attemptSeed, getSession, playReleased, sessionConfig, setStage, type SessionRow } from '../db/repo';
import { assignLate, release } from './assignment';
import { answerBots } from './discussion';
import { sampleDelta } from '../reveal/assist';
import type { Hub } from '../hub';

export const BOT_EFFECTS = {
  expected: { up: -8, neutral: 0, down: 8 },
  none: { up: 0, neutral: 0, down: 0 },
  reversed: { up: 5, neutral: 0, down: -5 },
} as const;
export type BotEffect = keyof typeof BOT_EFFECTS;
export type BotTarget = 'rated_before' | 'done';
type BotPlan = { score: number; startMs: number; finishMs: number; rateMs: number; recapMs: number; doneMs: number; dwellMs: number; answers: Record<PromptId, number> };
type BotRow = { id: string; stage: string; joined_at: number; bot_json: string | null; removed_at: number | null; score: number | null; attempt_started: number | null };

export function makeBotPlan(seed: string, botId: string, score: number): BotPlan {
  const rng = rngFrom(`${seed}:pilot:${botId}`);
  const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  return {
    score,
    startMs: between(500, 6000),
    finishMs: between(40_000, 75_000),
    rateMs: between(3000, 9000),
    recapMs: between(4000, 10_000),
    doneMs: between(3000, 7000),
    dwellMs: between(3000, 8000),
    answers: Object.fromEntries(PROMPT_IDS.map((prompt) => [prompt, between(1500, 9000)])) as Record<PromptId, number>,
  };
}

function botRows(db: Db, sessionId: string): BotRow[] {
  return db.all<BotRow>(
    `SELECT p.id, p.stage, p.joined_at, p.bot_json, p.removed_at, a.score, a.started_at AS attempt_started
     FROM participants p LEFT JOIN attempts a ON a.participant_id = p.id
     WHERE p.session_id = ? AND p.kind = 'bot' AND p.removed_at IS NULL`,
    sessionId,
  );
}

function planFor(s: SessionRow, bot: BotRow): BotPlan {
  if (bot.bot_json) {
    try {
      const saved = JSON.parse(bot.bot_json) as BotPlan;
      if (Number.isFinite(saved.startMs) && Number.isFinite(saved.score) && saved.answers) return saved;
    } catch {}
  }
  const rng = rngFrom(`${s.seed}:pilot:${bot.id}`);
  const score = bot.score ?? Math.round(clamp(660 + normal(rng) * 120, SCORE_LO, SCORE_HI));
  return makeBotPlan(s.seed, bot.id, score);
}

function playOpenedAt(db: Db, sessionId: string, joinedAt: number): number {
  const at = db.get<{ at: number | null }>(
    "SELECT MAX(at) AS at FROM presentation_log WHERE session_id = ? AND from_scene = 'lobby' AND to_scene != 'lobby'",
    sessionId,
  )?.at;
  return Math.max(joinedAt, at ?? joinedAt);
}

function startBot(db: Db, s: SessionRow, bot: BotRow, now: number) {
  const cfg = sessionConfig(s);
  db.run(
    `INSERT INTO attempts (participant_id, session_id, game_version, seed, study_scale, status, started_at, stats_json)
     VALUES (?, ?, ?, ?, ?, 'playing', ?, '{}') ON CONFLICT DO NOTHING`,
    bot.id, s.id, cfg.gameVersion, attemptSeed(s.seed, bot.id), cfg.studyScale, now,
  );
  setStage(db, bot.id, 'playing', now);
}

function finishBot(db: Db, bot: BotRow, plan: BotPlan, now: number) {
  db.run("UPDATE attempts SET status = 'complete', completed_at = ?, score = ? WHERE participant_id = ?", now, plan.score, bot.id);
  setStage(db, bot.id, 'scored', now);
}

function rateBot(db: Db, s: SessionRow, bot: BotRow, now: number) {
  const score = db.get<{ score: number }>('SELECT score FROM attempts WHERE participant_id = ?', bot.id)?.score ?? 660;
  const value = Math.round(clamp(((score - 200) / 800) * 100 + normal(rngFrom(`${s.seed}:pilot:${bot.id}:before`)) * 10, 0, 100) * 10) / 10;
  db.run("INSERT OR IGNORE INTO ratings (participant_id, phase, value, created_at) VALUES (?, 'before', ?, ?)", bot.id, value, now);
  setStage(db, bot.id, 'rated_before', now);
  const fresh = getSession(db, s.id)!;
  if (fresh.released_at !== null || sessionConfig(fresh).assignMode === 'instant') assignLate(db, fresh, bot.id, now);
}

function completeToRated(db: Db, s: SessionRow, bot: BotRow, plan: BotPlan, now: number, force: boolean): boolean {
  let changed = false;
  let stage = bot.stage;
  const playAt = playOpenedAt(db, s.id, bot.joined_at) + plan.startMs;
  const finishAt = playAt + plan.finishMs;
  if (stage === 'joined' && (force || (playReleased(db, s.id) && now >= playAt))) {
    startBot(db, s, bot, now);
    stage = 'playing';
    changed = true;
  }
  if (stage === 'playing' && (force || now >= finishAt)) {
    finishBot(db, bot, plan, now);
    stage = 'scored';
    changed = true;
  }
  if (stage === 'scored' && (force || now >= finishAt + plan.rateMs)) {
    rateBot(db, s, bot, now);
    changed = true;
  }
  return changed;
}

function assignUnassignedBots(db: Db, s: SessionRow, now: number): string[] {
  const refresh: string[] = [];
  for (const bot of botRows(db, s.id)) {
    if (!['rated_before', 'assigned'].includes(bot.stage)) continue;
    if (assignLate(db, s, bot.id, now)) refresh.push(bot.id);
  }
  return refresh;
}

function finishBotNow(db: Db, s: SessionRow, bot: BotRow, plan: BotPlan, now: number, effect: BotEffect) {
  const assigned = db.get<{ condition: Condition; assigned_at: number; reveal_at: number; dial_dwell_ms: number | null }>(
    `SELECT x.condition, x.assigned_at, x.reveal_at, x.dial_dwell_ms FROM assignments x WHERE x.participant_id = ?`, bot.id,
  );
  if (!assigned) return false;
  let changed = false;
  if (bot.stage === 'assigned') {
    db.run('UPDATE assignments SET dial_dwell_ms = COALESCE(dial_dwell_ms, ?) WHERE participant_id = ?', plan.dwellMs, bot.id);
    setStage(db, bot.id, 'recap_seen', now);
    changed = true;
  }
  const r1 = db.get<{ value: number }>("SELECT value FROM ratings WHERE participant_id = ? AND phase = 'before'", bot.id)?.value;
  if (r1 !== undefined) {
    const value = Math.round(clamp(r1 + sampleDelta(rngFrom(`${s.seed}:pilot:${bot.id}:after`), BOT_EFFECTS[effect][assigned.condition]), 0, 100) * 10) / 10;
    db.run("INSERT OR IGNORE INTO ratings (participant_id, phase, value, created_at) VALUES (?, 'after', ?, ?)", bot.id, value, now);
    setStage(db, bot.id, 'done', now);
    changed = true;
  }
  return changed;
}

export function stepBots(db: Db, sessionId: string, now: number): string[] {
  return db.tx(() => {
    const s = getSession(db, sessionId);
    if (!s) return [];
    const touched = new Set<string>();
    const exitedAt = playOpenedAt(db, s.id, s.created_at);
    for (const initial of botRows(db, s.id)) {
      const plan = planFor(s, initial);
      let bot = initial;
      let again = true;
      while (again) {
        again = false;
        if (bot.stage === 'joined' && playReleased(db, s.id) && now >= Math.max(bot.joined_at, exitedAt) + plan.startMs) {
          startBot(db, s, bot, now);
          bot = { ...bot, stage: 'playing' };
          touched.add(bot.id);
          again = true;
        } else if (bot.stage === 'playing' && now >= Math.max(bot.joined_at, exitedAt) + plan.startMs + plan.finishMs) {
          finishBot(db, bot, plan, now);
          bot = { ...bot, stage: 'scored' };
          touched.add(bot.id);
          again = true;
        } else if (bot.stage === 'scored' && now >= Math.max(bot.joined_at, exitedAt) + plan.startMs + plan.finishMs + plan.rateMs) {
          rateBot(db, s, bot, now);
          bot = { ...bot, stage: 'rated_before' };
          touched.add(bot.id);
          again = true;
        } else if (bot.stage === 'assigned' || bot.stage === 'recap_seen') {
          const assignment = db.get<{ assigned_at: number; reveal_at: number }>('SELECT assigned_at, reveal_at FROM assignments WHERE participant_id = ?', bot.id);
          if (assignment) {
            const recapAt = Math.max(assignment.assigned_at, assignment.reveal_at) + plan.recapMs;
            if (bot.stage === 'assigned' && now >= recapAt) {
              db.run('UPDATE assignments SET dial_dwell_ms = COALESCE(dial_dwell_ms, ?) WHERE participant_id = ?', plan.dwellMs, bot.id);
              setStage(db, bot.id, 'recap_seen', now);
              bot = { ...bot, stage: 'recap_seen' };
              touched.add(bot.id);
              again = true;
            } else if (bot.stage === 'recap_seen' && now >= recapAt + plan.doneMs) {
              finishBotNow(db, s, bot, plan, now, 'expected');
              bot = { ...bot, stage: 'done' };
              touched.add(bot.id);
              again = true;
            }
          }
        }
      }
    }
    const plans = new Map(botRows(db, s.id).map((bot) => [bot.id, planFor(s, bot)]));
    for (const run of db.all<{ prompt: PromptId; run: number; opened_at: number }>(
      "SELECT prompt, run, opened_at FROM prompt_runs WHERE session_id = ? AND source = 'test' AND phase = 'open'",
      s.id,
    )) {
      const answered = answerBots(db, s, run.prompt, run.run, now, (id) => {
        const plan = plans.get(id);
        return !!plan && now >= run.opened_at + plan.answers[run.prompt];
      });
      for (const id of answered) touched.add(id);
    }
    return [...touched];
  });
}

export function fastForwardBots(db: Db, s: SessionRow, to: BotTarget, now: number, effect: BotEffect = 'expected'): { touched: string[]; refresh: string[] } {
  return db.tx(() => {
    const touched = new Set<string>();
    for (const bot of botRows(db, s.id)) {
      const plan = planFor(s, bot);
      if (completeToRated(db, s, bot, plan, now, true)) touched.add(bot.id);
    }
    let refresh: string[] = [];
    let fresh = getSession(db, s.id)!;
    if (to === 'done') {
      if (fresh.released_at === null) refresh = release(db, fresh, now);
      fresh = getSession(db, s.id)!;
      refresh.push(...assignUnassignedBots(db, fresh, now));
      for (const bot of botRows(db, fresh.id)) {
        const plan = planFor(fresh, bot);
        if (finishBotNow(db, fresh, bot, plan, now, effect)) touched.add(bot.id);
      }
    }
    return { touched: [...touched], refresh: [...new Set(refresh)] };
  });
}

export function releaseSession(db: Db, s: SessionRow, now: number): string[] {
  return db.tx(() => {
    if (s.mode === 'test') fastForwardBots(db, s, 'rated_before', now);
    const fresh = getSession(db, s.id);
    return fresh ? release(db, fresh, now) : [];
  });
}

export function pilotTick(db: Db, hub: Hub, now: number) {
  const sessions = db.all<{ id: string }>(
    `SELECT s.id FROM sessions s WHERE s.mode = 'test' AND (
       EXISTS (SELECT 1 FROM participants p WHERE p.session_id = s.id AND p.kind = 'bot' AND p.removed_at IS NULL AND p.stage != 'done')
       OR EXISTS (SELECT 1 FROM prompt_runs r WHERE r.session_id = s.id AND r.source = 'test' AND r.phase = 'open')
     )`,
  );
  for (const { id } of sessions) {
    try {
      if (stepBots(db, id, now).length) hub.pushHost(id);
    } catch (err) {
      console.error('bot autopilot', id, err);
    }
  }
}
