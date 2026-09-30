import { createHash } from 'node:crypto';
import type { SnapshotCounts, SnapshotRow, WorldKey } from '../../shared/reveal';

export type RawRow = {
  id: string;
  kind: 'human' | 'bot' | 'ghost';
  stage: string;
  removed_at: number | null;
  started_at: number | null;
  score: number | null;
  attempt_status: 'playing' | 'complete' | null;
  attempt_flags: string | null;
  r1: number | null;
  r2: number | null;
  world: WorldKey | null;
  stratum: number | null;
  dwell_ms: number | null;
  peers: { score: number; real: boolean }[];
};

export type Eligibility = { rows: SnapshotRow[]; counts: SnapshotCounts; stillFinishing: number };

const STAGE_ORDER = ['joined', 'playing', 'scored', 'rated_before', 'assigned', 'recap_seen', 'done'];
const past = (stage: string, target: string) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);

function flagsOf(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function eligibility(raw: RawRow[], mode: 'live' | 'test', sessionSeed: string): Eligibility {
  const kinds = mode === 'live' ? ['human'] : ['human', 'bot'];
  const players = raw.filter((r) => kinds.includes(r.kind));
  const excluded = { removed: 0, invalid: 0, noScore: 0, stillPlaying: 0 };
  let flagged = 0;
  const kept: { hash: string; row: Omit<SnapshotRow, 'k'> }[] = [];
  for (const r of players) {
    if (r.removed_at !== null) {
      excluded.removed++;
      continue;
    }
    const flags = flagsOf(r.attempt_flags);
    if (r.score === null || r.attempt_status !== 'complete') {
      if (r.attempt_status === 'playing' || r.stage === 'playing') excluded.stillPlaying++;
      else excluded.noScore++;
      continue;
    }
    if (flags.includes('invalid')) {
      excluded.invalid++;
      continue;
    }
    if (flags.length) flagged++;
    kept.push({
      hash: createHash('sha256').update(`${sessionSeed}:${r.id}`).digest('hex'),
      row: {
        kind: r.kind as 'human' | 'bot',
        score: r.score,
        r1: r.r1,
        r2: r.r2,
        world: r.world,
        stratum: r.stratum,
        peers: r.peers.map((p) => ({ score: p.score, real: p.real })),
        dwellMs: r.dwell_ms,
      },
    });
  }
  kept.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const rows = kept.map((x, k) => ({ k, ...x.row }));
  const active = players.filter((p) => p.removed_at === null);
  const counts: SnapshotCounts = {
    joined: active.length,
    started: active.filter((p) => p.started_at !== null || past(p.stage, 'playing')).length,
    scored: active.filter((p) => past(p.stage, 'scored')).length,
    ratedBefore: active.filter((p) => past(p.stage, 'rated_before')).length,
    assigned: active.filter((p) => past(p.stage, 'assigned')).length,
    done: active.filter((p) => p.stage === 'done').length,
    flagged,
    excluded,
  };
  const stillFinishing = active.filter((p) => p.stage !== 'done' && (p.started_at !== null || past(p.stage, 'playing'))).length;
  return { rows, counts, stillFinishing };
}
