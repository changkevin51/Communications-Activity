import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db';
import type { Stage, Phase } from '../../shared/flow';
import type { SessionConfig } from '../config';
import { sha256 } from '../auth';

export type SessionRow = {
  id: string;
  code: string;
  label: string;
  mode: 'live' | 'test';
  phase: Phase;
  config_json: string;
  seed: string;
  release_json: string | null;
  created_at: number;
  released_at: number | null;
  reveal_at: number | null;
  closed_at: number | null;
};

export type ParticipantRow = {
  id: string;
  session_id: string;
  kind: 'human' | 'bot' | 'ghost';
  token_hash: string | null;
  codename: string;
  sigil_json: string;
  stage: Stage | 'ghost';
  rev: number;
  joined_at: number;
  started_at: number | null;
  scored_at: number | null;
  rated_before_at: number | null;
  assigned_at: number | null;
  recap_seen_at: number | null;
  done_at: number | null;
  last_seen_at: number | null;
  removed_at: number | null;
  flags_json: string;
  bot_json: string | null;
};

export type AttemptRow = {
  participant_id: string;
  session_id: string;
  game_version: string;
  seed: string;
  study_scale: number;
  status: 'playing' | 'complete';
  started_at: number;
  completed_at: number | null;
  score: number | null;
  stats_json: string | null;
  flags_json: string;
};

export type AssignmentRow = {
  participant_id: string;
  session_id: string;
  condition: 'up' | 'neutral' | 'down';
  batch: 'release' | 'late' | 'instant';
  stratum: number | null;
  viewer_score: number;
  thresholds_json: string;
  algo_version: string;
  assigned_at: number;
  reveal_at: number;
  dial_dwell_ms: number | null;
};

export type RatingRow = {
  participant_id: string;
  phase: 'before' | 'after';
  value: number;
  response_ms: number | null;
  adjustments: number | null;
  created_at: number;
};

export const newId = () => randomUUID();
export const newSeed = () => randomBytes(12).toString('base64url');

export function attemptSeed(sessionSeed: string, participantId: string): string {
  return sha256(`${sessionSeed}:${participantId}`).slice(0, 16);
}

export function sessionConfig(s: SessionRow): SessionConfig {
  return JSON.parse(s.config_json) as SessionConfig;
}

export const assistOn = (s: SessionRow) => sessionConfig(s).assist !== false;

export function playReleased(db: Db, sessionId: string): boolean {
  const scene = db.get<{ scene: string }>('SELECT scene FROM presentations WHERE session_id = ?', sessionId)?.scene;
  return !!scene && scene !== 'lobby';
}

export function getSession(db: Db, id: string) {
  return db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
}

export function getSessionByCode(db: Db, code: string) {
  return db.get<SessionRow>('SELECT * FROM sessions WHERE code = ?', code);
}

export function getParticipant(db: Db, id: string) {
  return db.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id);
}

export function getAttempt(db: Db, pid: string) {
  return db.get<AttemptRow>('SELECT * FROM attempts WHERE participant_id = ?', pid);
}

export function getAssignment(db: Db, pid: string) {
  return db.get<AssignmentRow>('SELECT * FROM assignments WHERE participant_id = ?', pid);
}

export function getRatings(db: Db, pid: string) {
  return db.all<RatingRow>('SELECT * FROM ratings WHERE participant_id = ?', pid);
}

const STAGE_TS: Partial<Record<Stage, keyof ParticipantRow>> = {
  playing: 'started_at',
  scored: 'scored_at',
  rated_before: 'rated_before_at',
  assigned: 'assigned_at',
  recap_seen: 'recap_seen_at',
  done: 'done_at',
};

export function setStage(db: Db, pid: string, stage: Stage, now: number) {
  const col = STAGE_TS[stage];
  if (col) db.run(`UPDATE participants SET stage = ?, ${col} = COALESCE(${col}, ?), rev = rev + 1 WHERE id = ?`, stage, now, pid);
  else db.run('UPDATE participants SET stage = ?, rev = rev + 1 WHERE id = ?', stage, pid);
}

export function bumpRev(db: Db, pid: string) {
  db.run('UPDATE participants SET rev = rev + 1 WHERE id = ?', pid);
}

export function addFlag(db: Db, pid: string, flag: string) {
  const p = getParticipant(db, pid);
  if (!p) return;
  const flags = new Set(JSON.parse(p.flags_json) as string[]);
  flags.add(flag);
  db.run('UPDATE participants SET flags_json = ? WHERE id = ?', JSON.stringify([...flags]), pid);
}

export function logEvent(db: Db, sessionId: string | null, pid: string | null, type: string, data?: unknown) {
  db.run(
    'INSERT INTO events (session_id, participant_id, type, at, data_json) VALUES (?, ?, ?, ?, ?)',
    sessionId,
    pid,
    type,
    Date.now(),
    data === undefined ? null : JSON.stringify(data),
  );
}

export function takenCodenames(db: Db, sessionId: string): Set<string> {
  return new Set(db.all<{ codename: string }>('SELECT codename FROM participants WHERE session_id = ?', sessionId).map((r) => r.codename));
}
