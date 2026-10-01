import type { RevealData, WorldKey } from '../shared/reveal';

export const W = 1920;
export const H = 1080;
export const SAFE = { x0: 120, x1: 1800, y0: 90, y1: 990 };
export const MARK_R = 11;

export type Target = { k: number; x: number; y: number; r: number; a: number; color: string; trail?: { x: number; y: number } };

export function scale(lo: number, hi: number, a: number, b: number) {
  const span = hi - lo || 1;
  return (v: number) => a + ((v - lo) / span) * (b - a);
}

export function markRadius(n: number) {
  return n > 120 ? 7 : n > 60 ? 9 : MARK_R;
}

/** Deterministic beeswarm: items sorted by x then k; each placed at the lowest free offset from baseline. */
export function beeswarm(items: { k: number; x: number }[], r: number, baseY: number, maxRise: number, dir: 1 | -1 | 0 = -1): Map<number, number> {
  const placed: { x: number; y: number }[] = [];
  const out = new Map<number, number>();
  const step = r * 2 + 2;
  const sorted = items.slice().sort((a, b) => a.x - b.x || a.k - b.k);
  for (const it of sorted) {
    let y = baseY;
    for (let i = 0; i < 400; i++) {
      const off = dir === 0 ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * step * 0.9 : dir * i * step * 0.9;
      const cand = baseY + (Math.abs(off) > maxRise ? Math.sign(off) * maxRise : off);
      if (placed.every((p) => Math.hypot(p.x - it.x, p.y - cand) >= step - 0.5) || Math.abs(off) >= maxRise) {
        y = cand;
        break;
      }
    }
    placed.push({ x: it.x, y });
    out.set(it.k, y);
  }
  return out;
}

export const LANES: WorldKey[] = ['up', 'neutral', 'down'];

export function laneX(w: WorldKey) {
  const i = LANES.indexOf(w);
  return SAFE.x0 + ((SAFE.x1 - SAFE.x0) * (i * 2 + 1)) / 6;
}

export function scoreX(d: RevealData, x0 = SAFE.x0 + 80, x1 = SAFE.x1 - 80) {
  return scale(d.scoreAxis.lo, d.scoreAxis.hi, x0, x1);
}

export function ratingY(y0 = 820, y1 = 260) {
  return scale(0, 100, y0, y1);
}

/** Zoom the movement lanes around the ratings actually on screen, so small disagreements and one long jump both read. */
export function movementRatingY(d: RevealData) {
  const vals: number[] = [];
  for (const m of d.marks) {
    if (m.r1 !== null) vals.push(m.r1);
    if (m.r2 !== null) vals.push(m.r2);
  }
  if (vals.length < 2) return ratingY(930, 400);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max(8, (hi - lo) * 0.22);
  lo -= pad;
  hi += pad;
  if (hi - lo < 28) {
    const mid = (lo + hi) / 2;
    lo = mid - 14;
    hi = mid + 14;
  }
  return scale(lo, hi, 940, 380);
}

export function clampToSafe(t: Target): Target {
  return {
    ...t,
    x: Math.min(SAFE.x1 - t.r, Math.max(SAFE.x0 + t.r, t.x)),
    y: Math.min(SAFE.y1 - t.r, Math.max(SAFE.y0 + t.r, t.y)),
  };
}

export function jitter(k: number, span: number) {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * span;
}
