import { randomInt } from 'node:crypto';
import type { Db } from '../db/db';
import { CODE_ALPHABET } from '../../shared/code';
import { STAGES, type Stage } from '../../shared/flow';
import { SessionConfigSchema, type SessionConfig } from '../config';
import { bumpRev, getSession, logEvent, newId, newSeed, type SessionRow } from '../db/repo';
import type { Condition, Thresholds } from '../assign/thresholds';

export type SessionSummary = Pick<SessionRow, 'id' | 'code' | 'label' | 'mode' | 'phase' | 'created_at'> & { players: number };

export function listSessions(db: Db): SessionSummary[] {
  return db.all<SessionSummary>(
    `SELECT s.id, s.code, s.label, s.mode, s.phase, s.created_at,
       (SELECT COUNT(*) FROM participants p WHERE p.session_id = s.id AND p.kind != 'ghost' AND p.removed_at IS NULL) AS players
     FROM sessions s ORDER BY s.created_at DESC`,
  );
}

function newCode(db: Db): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!db.get('SELECT 1 FROM sessions WHERE code = ?', code)) return code;
  }
}

export function createSession(db: Db, label: string, mode: 'live' | 'test', config: Partial<SessionConfig> | undefined, now: number): SessionRow {
  return db.tx(() => {
    const cfg = SessionConfigSchema.parse(config ?? {});
    const id = newId();
    db.run(
      'INSERT INTO sessions (id, code, label, mode, config_json, seed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      newCode(db),
      label.slice(0, 80),
      mode,
      JSON.stringify(cfg),
      newSeed(),
      now,
    );
    logEvent(db, id, null, 'create', { mode });
    return getSession(db, id)!;
  });
}

export function closeSession(db: Db, id: string, now: number) {
  db.run("UPDATE sessions SET phase = 'closed', closed_at = ? WHERE id = ?", now, id);
}

export function reopenSession(db: Db, id: string) {
  db.run("UPDATE sessions SET phase = CASE WHEN released_at IS NULL THEN 'open' ELSE 'released' END, closed_at = NULL WHERE id = ?", id);
}

export function resetSession(db: Db, id: string) {
  db.tx(() => {
    db.run('DELETE FROM participants WHERE session_id = ?', id);
    db.run(
      "UPDATE sessions SET phase = 'open', release_json = NULL, released_at = NULL, reveal_at = NULL, closed_at = NULL, seed = ? WHERE id = ?",
      newSeed(),
      id,
    );
    logEvent(db, id, null, 'reset');
  });
}

export function deleteSession(db: Db, id: string) {
  db.tx(() => {
    db.run('DELETE FROM events WHERE session_id = ?', id);
    db.run('DELETE FROM sessions WHERE id = ?', id);
  });
}

export function removeParticipant(db: Db, pid: string, now: number): string | null {
  return db.tx(() => {
    const p = db.get<{ session_id: string }>("SELECT session_id FROM participants WHERE id = ? AND kind != 'ghost'", pid);
    if (!p) return null;
    db.run('UPDATE participants SET removed_at = COALESCE(removed_at, ?) WHERE id = ?', now, pid);
    bumpRev(db, pid);
    return p.session_id;
  });
}

type Row = {
  id: string;
  kind: 'human' | 'bot' | 'ghost';
  codename: string;
  stage: string;
  removed_at: number | null;
  flags_json: string;
  score: number | null;
  attempt_flags: string | null;
  r1: number | null;
  r2: number | null;
  condition: Condition | null;
  stratum: number | null;
  batch: string | null;
  dial_dwell_ms: number | null;
};

export function participantRows(db: Db, sessionId: string): Row[] {
  return db.all<Row>(
    `SELECT p.id, p.kind, p.codename, p.stage, p.removed_at, p.flags_json, a.score, a.flags_json AS attempt_flags,
       rb.value AS r1, ra.value AS r2, x.condition, x.stratum, x.batch, x.dial_dwell_ms
     FROM participants p
     LEFT JOIN attempts a ON a.participant_id = p.id
     LEFT JOIN ratings rb ON rb.participant_id = p.id AND rb.phase = 'before'
     LEFT JOIN ratings ra ON ra.participant_id = p.id AND ra.phase = 'after'
     LEFT JOIN assignments x ON x.participant_id = p.id
     WHERE p.session_id = ? ORDER BY p.joined_at`,
    sessionId,
  );
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function hostView(db: Db, sessionId: string, connected: Set<string>) {
  const s = getSession(db, sessionId);
  if (!s) return null;
  const rows = participantRows(db, sessionId);
  const players = rows.filter((r) => r.kind !== 'ghost' && !r.removed_at);
  const ghosts = rows.filter((r) => r.kind === 'ghost');
  const funnel = Object.fromEntries(STAGES.map((st) => [st, players.filter((p) => p.stage === st).length])) as Record<Stage, number>;
  const finished = players.filter((p) => p.score !== null).length;
  const peers = db.all<{ viewer_id: string; slot: number; peer_kind: string; peer_score: number; diff: number; codename: string }>(
    `SELECT sp.viewer_id, sp.slot, sp.peer_kind, sp.peer_score, sp.diff, q.codename FROM shown_peers sp
     JOIN participants v ON v.id = sp.viewer_id JOIN participants q ON q.id = sp.peer_id
     WHERE v.session_id = ? ORDER BY sp.viewer_id, sp.slot`,
    sessionId,
  );
  const peersBy = new Map<string, typeof peers>();
  for (const p of peers) peersBy.set(p.viewer_id, [...(peersBy.get(p.viewer_id) ?? []), p]);
  const summary = (['up', 'neutral', 'down'] as Condition[]).map((condition) => {
    const g = players.filter((p) => p.condition === condition);
    const deltas = g.filter((p) => p.r1 !== null && p.r2 !== null).map((p) => (p.r2 as number) - (p.r1 as number));
    return {
      condition,
      n: g.length,
      meanScore: mean(g.map((p) => p.score ?? 0)),
      meanR1: mean(g.filter((p) => p.r1 !== null).map((p) => p.r1 as number)),
      meanR2: mean(g.filter((p) => p.r2 !== null).map((p) => p.r2 as number)),
      meanDelta: mean(deltas),
      done: g.filter((p) => p.stage === 'done').length,
    };
  });
  const ghostExposures = peers.filter((p) => p.peer_kind === 'ghost').length;
  const release = s.release_json ? (JSON.parse(s.release_json) as { thresholds: Thresholds }) : null;
  return {
    session: { id: s.id, code: s.code, label: s.label, mode: s.mode, phase: s.phase, config: JSON.parse(s.config_json), releasedAt: s.released_at, revealAt: s.reveal_at },
    funnel,
    connected: players.filter((p) => connected.has(p.id)).length,
    total: players.length,
    finished,
    waiting: funnel.rated_before,
    internals: {
      summary,
      ghosts: { count: ghosts.length, exposures: ghostExposures, realExposures: peers.length - ghostExposures },
      thresholds: release?.thresholds ?? null,
      participants: rows
        .filter((r) => r.kind !== 'ghost')
        .map((r) => ({
          id: r.id,
          codename: r.codename,
          kind: r.kind,
          stage: r.removed_at ? 'removed' : r.stage,
          score: r.score,
          r1: r.r1,
          r2: r.r2,
          delta: r.r1 !== null && r.r2 !== null ? Math.round((r.r2 - r.r1) * 10) / 10 : null,
          condition: r.condition,
          stratum: r.stratum,
          batch: r.batch,
          peers: (peersBy.get(r.id) ?? []).map((p) => ({ codename: p.codename, score: p.peer_score, kind: p.peer_kind, diff: p.diff })),
          flags: [...(JSON.parse(r.flags_json) as string[]), ...(JSON.parse(r.attempt_flags ?? '[]') as string[])],
        })),
    },
  };
}

export type HostView = NonNullable<ReturnType<typeof hostView>>;
