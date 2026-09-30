import { generateRound } from './generate';
import { ROUND_COUNT, SPECS } from './specs';
import { clamp } from '../rng';

export type RoundSubmission = {
  idx: number;
  variant: number;
  tapped: number | null;
  rtMs: number | null;
  studyMs: number;
  maskMs: number;
};

export type ScoredRound = RoundSubmission & { target: number; correct: boolean };

export type AttemptStats = {
  hits: number;
  misses: number;
  timeouts: number;
  avgLockMs: number | null;
  medianLockMs: number | null;
  fastestMs: number | null;
  bestStreak: number;
};

export const TOTAL_WEIGHT = SPECS.reduce((s, sp) => s + sp.weight, 0);

export function roundPoints(idx: number, hit: boolean, rtMs: number | null): number {
  const spec = SPECS[idx];
  if (!hit || rtMs === null) return 0;
  const speed = clamp((spec.slowMs - rtMs) / (spec.slowMs - spec.fastMs), 0, 1);
  return spec.weight * (0.8 + 0.2 * speed);
}

export function scoreFromHits(rounds: { idx: number; hit: boolean; rtMs: number | null }[]): number {
  const pts = rounds.reduce((s, r) => s + roundPoints(r.idx, r.hit, r.rtMs), 0);
  return Math.round(200 + 800 * (pts / TOTAL_WEIGHT));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

type StatInput = { hit: boolean; tapped: number | null; rtMs: number | null };

export function computeStats(rounds: StatInput[]): AttemptStats {
  let streak = 0;
  let best = 0;
  let hits = 0;
  let misses = 0;
  let timeouts = 0;
  const hitRts: number[] = [];
  for (const r of rounds) {
    if (r.hit) {
      hits++;
      streak++;
      best = Math.max(best, streak);
      if (r.rtMs !== null) hitRts.push(r.rtMs);
    } else {
      streak = 0;
      if (r.tapped === null) timeouts++;
      else misses++;
    }
  }
  const avg = hitRts.length ? Math.round(hitRts.reduce((a, b) => a + b, 0) / hitRts.length) : null;
  return {
    hits,
    misses,
    timeouts,
    avgLockMs: avg,
    medianLockMs: median(hitRts),
    fastestMs: hitRts.length ? Math.min(...hitRts) : null,
    bestStreak: best,
  };
}

export function scoreAttempt(seed: string, subs: RoundSubmission[]) {
  if (subs.length !== ROUND_COUNT) throw new Error('bad round count');
  const sorted = subs.slice().sort((a, b) => a.idx - b.idx);
  const rounds: ScoredRound[] = sorted.map((s) => {
    const { target, grid } = generateRound(seed, s.idx, s.variant);
    const inRange = s.tapped !== null && s.tapped >= 0 && s.tapped < grid * grid;
    const tapped = inRange ? s.tapped : null;
    const rtMs = tapped === null ? null : s.rtMs;
    return { ...s, tapped, rtMs, target, correct: tapped !== null && tapped === target };
  });
  const score = scoreFromHits(rounds.map((r) => ({ idx: r.idx, hit: r.correct, rtMs: r.rtMs })));
  const stats = computeStats(rounds.map((r) => ({ hit: r.correct, tapped: r.tapped, rtMs: r.rtMs })));
  return { score, stats, rounds };
}
