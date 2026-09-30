import { clamp } from '../../shared/rng';

export const ALGO_VERSION = 'assign@1';
export const SCORE_LO = 260;
export const SCORE_HI = 985;

export type Condition = 'up' | 'neutral' | 'down';
export const CONDITIONS: readonly Condition[] = ['up', 'neutral', 'down'];

export type Thresholds = {
  n: number;
  robustSD: number;
  gapMin: number;
  gapMax: number;
  neutralWindow: number;
  targetGap: number;
  sigma: number;
  dialSpan: number;
  lo: number;
  hi: number;
  k: number;
  algoVersion: string;
};

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

export function computeThresholds(scores: number[], k = 3): Thresholds {
  const sorted = scores.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const robustSD = clamp(n >= 8 ? iqr / 1.349 : 110, 60, 200);
  const gapMin = Math.round(clamp(0.6 * robustSD, 45, 120));
  const gapMax = Math.round(gapMin + 1.6 * robustSD);
  const neutralWindow = Math.round(Math.min(clamp(0.3 * robustSD, 20, 45), gapMin - 15));
  return {
    n,
    robustSD: Math.round(robustSD * 10) / 10,
    gapMin,
    gapMax,
    neutralWindow,
    targetGap: gapMin + 0.6 * robustSD,
    sigma: 0.5 * robustSD,
    dialSpan: Math.round(clamp(5 * robustSD, 360, 640)),
    lo: SCORE_LO,
    hi: SCORE_HI,
    k,
    algoVersion: ALGO_VERSION,
  };
}

export type Band = { lo: number; hi: number };

export function bandFor(score: number, cond: Condition, th: Thresholds): Band {
  if (cond === 'up') return { lo: score + th.gapMin, hi: Math.min(score + th.gapMax, th.hi) };
  if (cond === 'down') return { lo: Math.max(score - th.gapMax, th.lo), hi: score - th.gapMin };
  return { lo: Math.max(score - th.neutralWindow, th.lo), hi: Math.min(score + th.neutralWindow, th.hi) };
}

export function inBand(x: number, b: Band): boolean {
  return x >= b.lo && x <= b.hi;
}
