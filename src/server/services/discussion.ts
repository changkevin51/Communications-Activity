import { createHash } from 'node:crypto';
import type { Db } from '../db/db';
import { assistOn, getParticipant, getSession, logEvent, newId, type ParticipantRow, type SessionRow } from '../db/repo';
import {
  LATE_GRACE_MS, PROMPT_OF, isPart3, roleAt,
  type AnswerValue, type PresenterQuestion, type Profile, type PromptId, type PromptResult, type ScreenQuestion,
} from '../../shared/discussion';
import { PROMPTS, type PromptSpec } from '../../shared/discussionContent';
import type { AnswerReqT, PhonePrompt, RoomScreen } from '../../shared/protocol';
import type { SceneId, Source } from '../../shared/reveal';
import { aggregate, assertPublicPrompt, validAnswer } from '../discussion/aggregate';
import { assistAnswers } from '../discussion/assist';
import { demoAnswer, demoAnswers } from '../discussion/demo';
import { rngFrom } from '../../shared/rng';
import type { CmdResult } from './participant';

export type DemoCfg = { profile: Profile; n: number; seed: string };
/** Everything the discussion layer needs to know about the presentation, resolved by the caller. */
export type QCtx = { s: SessionRow; source: Source; demo: DemoCfg | null };

type RunRow = { session_id: string; prompt: PromptId; run: number; phase: 'open' | 'frozen'; source: Source; opened_at: number; frozen_at: number | null; result_id: string | null };

const kinds = (s: SessionRow) => (s.mode === 'live' ? "('human')" : "('human','bot')");
const stagesFor = (spec: PromptSpec) => (spec.who === 'played' ? "('done')" : "('done','joined')");

export function isEligible(s: SessionRow, p: ParticipantRow, spec: PromptSpec): boolean {
  if (p.removed_at || p.session_id !== s.id) return false;
  if (p.kind !== 'human' && !(s.mode === 'test' && p.kind === 'bot')) return false;
  return p.stage === 'done' || (spec.who === 'anyone' && p.stage === 'joined');
}

function eligibleCount(db: Db, s: SessionRow, spec: PromptSpec): number {
  return db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM participants WHERE session_id = ? AND kind IN ${kinds(s)} AND removed_at IS NULL AND stage IN ${stagesFor(spec)}`,
    s.id,
  )!.n;
}

export function latestRun(db: Db, sessionId: string, prompt: PromptId): RunRow | undefined {
  return db.get<RunRow>('SELECT * FROM prompt_runs WHERE session_id = ? AND prompt = ? ORDER BY run DESC LIMIT 1', sessionId, prompt);
}

function storedValues(db: Db, r: RunRow): AnswerValue[] {
  return db
    .all<{ value_json: string }>('SELECT value_json FROM responses WHERE session_id = ? AND prompt = ? AND run = ? AND late = 0', r.session_id, r.prompt, r.run)
    .map((x) => JSON.parse(x.value_json) as AnswerValue);
}

function valuesFor(db: Db, q: QCtx, r: RunRow): { values: AnswerValue[]; eligible: number } {
  if (r.source === 'demo' && q.demo) return demoAnswers(r.prompt, q.demo.profile, q.demo.n, `${q.demo.seed}:${r.run}`);
  return { values: storedValues(db, r), eligible: eligibleCount(db, q.s, PROMPTS[r.prompt]) };
}

export function openRun(db: Db, q: QCtx, prompt: PromptId, now: number): number {
  const run = (latestRun(db, q.s.id, prompt)?.run ?? 0) + 1;
  const source: Source = q.source === 'demo' ? 'demo' : q.s.mode;
  db.run('INSERT INTO prompt_runs (session_id, prompt, run, phase, source, opened_at) VALUES (?, ?, ?, ?, ?, ?)', q.s.id, prompt, run, 'open', source, now);
  logEvent(db, q.s.id, null, 'prompt_open', { prompt, run });
  return run;
}

export function answerBots(db: Db, s: SessionRow, prompt: PromptId, run: number, now: number, due?: (id: string) => boolean): string[] {
  const spec = PROMPTS[prompt];
  const bots = db.all<{ id: string }>(
    `SELECT p.id FROM participants p WHERE p.session_id = ? AND p.kind = 'bot' AND p.removed_at IS NULL AND p.stage IN ${stagesFor(spec)}
       AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.session_id = ? AND r.prompt = ? AND r.run = ? AND r.participant_id = p.id)
     ORDER BY p.id`,
    s.id, s.id, prompt, run,
  ).filter(({ id }) => !due || due(id));
  for (const bot of bots) {
    const value = demoAnswer(rngFrom(`${s.seed}:pilot:${bot.id}:answer:${prompt}:${run}`), prompt, 'expected');
    db.run('INSERT INTO responses (session_id, prompt, run, participant_id, rid, value_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)', s.id, prompt, run, bot.id, `bot-${bot.id.slice(0, 12)}`, JSON.stringify(value), now);
  }
  return bots.map((b) => b.id);
}

export function freezeRun(db: Db, q: QCtx, r: RunRow, now: number) {
  if (r.phase !== 'open') return;
  if (r.source === 'test') answerBots(db, q.s, r.prompt, r.run, now);
  let { values, eligible } = valuesFor(db, q, r);
  if (r.source !== 'demo' && assistOn(q.s)) {
    const assisted = assistAnswers(r.prompt, values, eligible, `${q.s.seed}:poll:${r.prompt}:${r.run}`);
    values = assisted.values;
    if (assisted.mode !== 'real') logEvent(db, q.s.id, null, 'assist', { prompt: r.prompt, run: r.run, mode: assisted.mode, added: assisted.added });
  }
  const data = assertPublicPrompt(aggregate(r.prompt, r.run, r.source, values, eligible));
  const json = JSON.stringify(data);
  const id = newId();
  db.run(
    'INSERT INTO prompt_results (id, session_id, prompt, run, version, created_at, data_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, q.s.id, r.prompt, r.run, data.version, now, json, createHash('sha256').update(json).digest('hex'),
  );
  db.run("UPDATE prompt_runs SET phase = 'frozen', frozen_at = ?, result_id = ? WHERE session_id = ? AND prompt = ? AND run = ?", now, id, q.s.id, r.prompt, r.run);
  logEvent(db, q.s.id, null, 'prompt_freeze', { prompt: r.prompt, run: r.run, n: data.n });
}

/** Leaving an ask beat freezes its question; arriving at an ask beat that was never asked opens it. */
export function syncQuestion(db: Db, q: QCtx, from: { scene: SceneId; beat: number }, to: { scene: SceneId; beat: number }, now: number) {
  if (from.scene === to.scene && from.beat === to.beat) return;
  if (roleAt(from.scene, from.beat) === 'ask') {
    const p = PROMPT_OF[from.scene as keyof typeof PROMPT_OF];
    const r = p ? latestRun(db, q.s.id, p) : undefined;
    if (r) freezeRun(db, q, r, now);
  }
  if (roleAt(to.scene, to.beat) === 'ask') {
    const p = PROMPT_OF[to.scene as keyof typeof PROMPT_OF];
    if (p && !latestRun(db, q.s.id, p)) openRun(db, q, p, now);
  }
}

export function freezeOpen(db: Db, q: QCtx, prompt: PromptId, now: number): boolean {
  const r = latestRun(db, q.s.id, prompt);
  if (!r || r.phase !== 'open') return false;
  freezeRun(db, q, r, now);
  return true;
}

export function clearPrompts(db: Db, sessionId: string) {
  db.run('DELETE FROM responses WHERE session_id = ?', sessionId);
  db.run('DELETE FROM prompt_runs WHERE session_id = ?', sessionId);
  db.run('DELETE FROM prompt_results WHERE session_id = ?', sessionId);
}

function resultOf(db: Db, r: RunRow): PromptResult | null {
  if (!r.result_id) return null;
  const row = db.get<{ data_json: string }>('SELECT data_json FROM prompt_results WHERE id = ?', r.result_id);
  return row ? (JSON.parse(row.data_json) as PromptResult) : null;
}

export function screenQuestion(db: Db, q: QCtx, scene: SceneId, beat: number): ScreenQuestion | undefined {
  const prompt = PROMPT_OF[scene as keyof typeof PROMPT_OF];
  if (!prompt) return undefined;
  const r = latestRun(db, q.s.id, prompt);
  const role = roleAt(scene, beat);
  if (!r) return { prompt, run: null, phase: 'none', count: 0, eligible: eligibleCount(db, q.s, PROMPTS[prompt]), result: null };
  const res = r.phase === 'frozen' ? resultOf(db, r) : null;
  const live = r.phase === 'open' ? valuesFor(db, q, r) : null;
  return {
    prompt,
    run: r.run,
    phase: r.phase,
    count: res ? res.n + res.skipped : live!.values.length,
    eligible: res ? res.eligible : live!.eligible,
    result: role === 'reveal' || role === 'discuss' ? res : null,
  };
}

export function presenterQuestion(db: Db, q: QCtx, scene: SceneId, beat: number): PresenterQuestion | null {
  const sq = screenQuestion(db, q, scene, beat);
  if (!sq) return null;
  const r = latestRun(db, q.s.id, sq.prompt);
  const spec = PROMPTS[sq.prompt];
  const values = r ? valuesFor(db, q, r).values : [];
  const late = r ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM responses WHERE session_id = ? AND prompt = ? AND run = ? AND late = 1', q.s.id, r.prompt, r.run)!.n : 0;
  const answered = values.filter((v) => !('skip' in v));
  let split: { id: string; n: number }[];
  if (spec.kind === 'sliders') {
    split = (spec.sliders ?? []).map((sl, i) => {
      const col = answered.map((v) => ('v' in v ? v.v[i] : 0)).sort((a, b) => a - b);
      return { id: sl.id, n: col.length ? col[Math.floor((col.length - 1) / 2)] : 0 };
    });
  } else {
    split = (spec.choices ?? []).map((c) => ({ id: c.id, n: answered.filter((v) => ('c' in v ? v.c === c.id : 'cs' in v && v.cs.includes(c.id))).length }));
  }
  return {
    ...sq,
    result: r?.phase === 'frozen' ? resultOf(db, r) : null,
    skipped: values.length - answered.length,
    late,
    openedAt: r?.opened_at ?? null,
    runs: r?.run ?? 0,
    split,
  };
}

type PhoneRoomRow = { snapshot_id: string | null; scene: SceneId; beat: number; phones: 'auto' | 'passive'; part3_at: number | null };

export function phoneRoom(db: Db, s: SessionRow, p: ParticipantRow, row: PhoneRoomRow | undefined, source: Source | null): { screen?: RoomScreen; prompt?: PhonePrompt } {
  if (!row || !row.snapshot_id) return {};
  const inPart3 = row.part3_at !== null || isPart3(row.scene);
  const screen: RoomScreen = !inPart3 ? 'look' : row.scene === 'end' ? 'end' : 'discuss';
  if (row.phones !== 'auto' || source === 'demo' || roleAt(row.scene, row.beat) !== 'ask') return { screen };
  const promptId = PROMPT_OF[row.scene as keyof typeof PROMPT_OF]!;
  const spec = PROMPTS[promptId];
  const r = latestRun(db, s.id, promptId);
  if (!r || r.phase !== 'open' || !isEligible(s, p, spec)) return { screen };
  const answered = !!db.get('SELECT 1 AS x FROM responses WHERE session_id = ? AND prompt = ? AND run = ? AND participant_id = ?', s.id, promptId, r.run, p.id);
  const prompt: PhonePrompt = {
    id: spec.id, run: r.run, kind: spec.kind, title: spec.title, submitLabel: spec.submitLabel, answered,
    ...(spec.body ? { body: spec.body } : {}),
    ...(spec.choices ? { choices: spec.choices.map((c) => ({ id: c.id, label: c.label })) } : {}),
    ...(spec.exclusive ? { exclusive: spec.exclusive } : {}),
    ...(spec.max ? { max: spec.max } : {}),
    ...(spec.sliders ? { sliders: spec.sliders.map((x) => ({ id: x.id, label: x.label })) } : {}),
    ...(spec.anchors ? { anchors: spec.anchors } : {}),
  };
  return { screen, prompt };
}

export function answer(db: Db, pid: string, req: AnswerReqT, now: number): CmdResult {
  return db.tx((): CmdResult => {
    const p = getParticipant(db, pid);
    const s = p ? getSession(db, p.session_id) : undefined;
    if (!p || !s) return { ok: false, reason: 'NOT_JOINED' };
    if (!(req.prompt in PROMPTS)) return { ok: false, reason: 'BAD_REQUEST' };
    const promptId = req.prompt as PromptId;
    const spec = PROMPTS[promptId];
    const r = db.get<RunRow>('SELECT * FROM prompt_runs WHERE session_id = ? AND prompt = ? AND run = ?', s.id, promptId, req.run);
    if (!r || r.source === 'demo') return { ok: false, reason: 'CLOSED' };
    const prev = db.get<{ rid: string }>('SELECT rid FROM responses WHERE session_id = ? AND prompt = ? AND run = ? AND participant_id = ?', s.id, promptId, r.run, pid);
    if (prev) return { ok: true, pid, sessionId: s.id, changed: false };
    if (!isEligible(s, p, spec)) return { ok: false, reason: 'WRONG_STAGE' };
    if (!validAnswer(spec, req.value as AnswerValue)) return { ok: false, reason: 'BAD_REQUEST' };
    let late = 0;
    if (r.phase === 'frozen') {
      if (r.frozen_at === null || now - r.frozen_at > LATE_GRACE_MS) return { ok: false, reason: 'CLOSED' };
      late = 1;
    }
    db.run(
      'INSERT INTO responses (session_id, prompt, run, participant_id, rid, value_json, at, late) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      s.id, promptId, r.run, pid, req.rid, JSON.stringify(req.value), now, late,
    );
    return { ok: true, pid, sessionId: s.id, changed: true };
  });
}
