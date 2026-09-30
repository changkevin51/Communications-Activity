import type { Db } from '../db/db';
import { getSession } from '../db/repo';
import { participantRows } from './host';

export function exportJson(db: Db, sessionId: string) {
  const s = getSession(db, sessionId);
  if (!s) return null;
  const rows = participantRows(db, sessionId);
  const attempts = db.all<Record<string, unknown>>('SELECT * FROM attempts WHERE session_id = ?', sessionId);
  const ratings = db.all<Record<string, unknown>>(
    'SELECT r.* FROM ratings r JOIN participants p ON p.id = r.participant_id WHERE p.session_id = ?',
    sessionId,
  );
  const rounds = db.all<Record<string, unknown>>(
    'SELECT r.* FROM rounds r JOIN participants p ON p.id = r.participant_id WHERE p.session_id = ? ORDER BY r.participant_id, r.idx',
    sessionId,
  );
  const assignments = db.all<Record<string, unknown>>('SELECT * FROM assignments WHERE session_id = ?', sessionId);
  const shownPeers = db.all<Record<string, unknown>>(
    'SELECT sp.* FROM shown_peers sp JOIN participants v ON v.id = sp.viewer_id WHERE v.session_id = ? ORDER BY sp.viewer_id, sp.slot',
    sessionId,
  );
  const participants = db.all<Record<string, unknown>>(
    `SELECT id, kind, codename, stage, joined_at, started_at, scored_at, rated_before_at, assigned_at, recap_seen_at, done_at, removed_at, flags_json
     FROM participants WHERE session_id = ?`,
    sessionId,
  );
  const summary = rows
    .filter((r) => r.kind !== 'ghost')
    .map((r) => ({
      participant_id: r.id,
      codename: r.codename,
      kind: r.kind,
      stage: r.stage,
      removed: r.removed_at !== null,
      score: r.score,
      condition: r.condition,
      stratum: r.stratum,
      batch: r.batch,
      rating_before: r.r1,
      rating_after: r.r2,
      rating_delta: r.r1 !== null && r.r2 !== null ? Math.round((r.r2 - r.r1) * 10) / 10 : null,
      dial_dwell_ms: r.dial_dwell_ms,
      flags: [...(JSON.parse(r.flags_json) as string[]), ...(JSON.parse(r.attempt_flags ?? '[]') as string[])].join('|'),
    }));
  const { seed: _seed, ...session } = s;
  return { exportedAt: Date.now(), session, summary, participants, attempts, rounds, ratings, assignments, shownPeers };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(db: Db, sessionId: string): string | null {
  const data = exportJson(db, sessionId);
  if (!data) return null;
  const peers = new Map<string, { slot: number; peer_kind: string; peer_score: number; diff: number }[]>();
  for (const p of data.shownPeers as { viewer_id: string; slot: number; peer_kind: string; peer_score: number; diff: number }[]) {
    peers.set(p.viewer_id, [...(peers.get(p.viewer_id) ?? []), p]);
  }
  const base = Object.keys(data.summary[0] ?? { participant_id: '' });
  const peerCols = [0, 1, 2].flatMap((i) => [`peer${i + 1}_score`, `peer${i + 1}_kind`, `peer${i + 1}_diff`]);
  const header = [...base, ...peerCols];
  const lines = data.summary.map((r) => {
    const ps = peers.get(r.participant_id) ?? [];
    const extra = [0, 1, 2].flatMap((i) => [ps[i]?.peer_score, ps[i]?.peer_kind, ps[i]?.diff]);
    return [...base.map((k) => (r as Record<string, unknown>)[k]), ...extra].map(csvCell).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}
