import type { Db } from './db/db';
import type { ParticipantView, OtherPlayer } from '../shared/protocol';
import type { Sigil } from '../shared/identity/sigil';
import type { Stage } from '../shared/flow';
import { atOrPast } from '../shared/flow';
import { attemptSeed, getAssignment, getAttempt, getParticipant, getRatings, getSession, sessionConfig } from './db/repo';
import type { Thresholds } from './assign/thresholds';
import { isLook } from './services/presentation';

export function buildView(db: Db, pid: string, now: number): ParticipantView | null {
  const p = getParticipant(db, pid);
  if (!p || p.stage === 'ghost') return null;
  const s = getSession(db, p.session_id);
  if (!s) return null;
  const cfg = sessionConfig(s);
  const stage = p.stage as Stage;
  const view: ParticipantView = {
    rev: p.rev,
    serverNow: now,
    room: { code: s.code, open: s.phase !== 'closed', ...(isLook(db, s.id) ? { screen: 'look' as const } : {}) },
    me: { codename: p.codename, sigil: JSON.parse(p.sigil_json) as Sigil, stage: p.removed_at ? 'removed' : stage },
  };
  if (p.removed_at) return view;
  view.game = { version: cfg.gameVersion, seed: attemptSeed(s.seed, p.id), studyScale: cfg.studyScale };
  if (atOrPast(stage, 'scored')) {
    const a = getAttempt(db, pid);
    if (a && a.score !== null) {
      const st = JSON.parse(a.stats_json ?? '{}') as { avgLockMs?: number | null; bestStreak?: number; fastestMs?: number | null };
      view.result = { score: a.score, avgLockMs: st.avgLockMs ?? null, bestStreak: st.bestStreak ?? 0, fastestMs: st.fastestMs ?? null };
    }
    const r = getRatings(db, pid);
    view.ratings = { before: r.some((x) => x.phase === 'before'), after: r.some((x) => x.phase === 'after') };
  }
  if (atOrPast(stage, 'assigned')) {
    const asg = getAssignment(db, pid);
    if (asg) {
      const th = JSON.parse(asg.thresholds_json) as Thresholds;
      const others = db.all<{ codename: string; sigil_json: string; score: number }>(
        `SELECT q.codename AS codename, q.sigil_json AS sigil_json, sp.peer_score AS score
         FROM shown_peers sp JOIN participants q ON q.id = sp.peer_id WHERE sp.viewer_id = ? ORDER BY sp.slot`,
        pid,
      );
      view.recap = {
        revealAt: asg.reveal_at,
        dialSpan: th.dialSpan,
        others: others.map<OtherPlayer>((o) => ({ codename: o.codename, sigil: JSON.parse(o.sigil_json) as Sigil, score: o.score })),
      };
    }
  }
  return view;
}
