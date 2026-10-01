import type { Rng } from '../../shared/rng';
import { normal } from '../../shared/rng';

const r1d = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.floor((s.length - 1) / 2);
  return s.length % 2 ? s[i] : (s[i] + s[i + 1]) / 2;
}

/** Nudge the wildest point toward the middle until the average stays near the median, then pin the average to `pull`. */
function relax(deltas: number[], pull: number): number[] {
  const next = deltas.slice();
  for (let k = 0; k < 12; k++) {
    const med = median(next);
    if (Math.abs(mean(next) - med) <= 4.5) break;
    let idx = 0;
    for (let i = 1; i < next.length; i++) if (Math.abs(next[i] - med) > Math.abs(next[idx] - med)) idx = i;
    const excess = (next[idx] - med) * 0.22;
    next[idx] -= excess;
    const share = excess / Math.max(1, next.length - 1);
    for (let i = 0; i < next.length; i++) if (i !== idx) next[i] += share;
  }
  const shift = pull - mean(next);
  return next.map((d) => r1d(Math.max(-42, Math.min(42, d + shift))));
}

/**
 * Rating changes for one comparison group.
 * The average follows `pull`. Most people scatter along that direction.
 * When the group is large enough, one person jumps hard the other way.
 */
export function groupDeltas(rng: Rng, n: number, pull: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [r1d(Math.max(-42, Math.min(42, pull)))];
  const s = Math.sign(pull);
  if (s === 0 || Math.abs(pull) < 1.5) {
    const out = Array.from({ length: n }, () => (rng() - 0.5) * 22 + normal(rng) * 3);
    if (n >= 3) {
      const up = Math.floor(rng() * n);
      let down = Math.floor(rng() * (n - 1));
      if (down >= up) down += 1;
      out[up] = 16 + rng() * 18;
      out[down] = -(16 + rng() * 18);
    }
    return relax(out, pull);
  }
  const spikeAt = Math.floor(rng() * n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === spikeAt) {
      out.push(-s * (16 + rng() * 18));
      continue;
    }
    const roll = rng();
    if (n >= 8 && roll < 0.12) out.push(-s * (3 + rng() * 7));
    else if (n >= 6 && roll < 0.2) out.push(s * (2.5 + rng() * 2));
    else out.push(s * (4 + rng() * (Math.abs(pull) * 2.2 + 16)));
  }
  return relax(out, pull);
}

/** One person's change. Wide on purpose: a few people barely move, and some jump the other way. */
export function sampleDelta(rng: Rng, pull: number): number {
  const cap = (d: number) => r1d(Math.max(-42, Math.min(42, d)));
  if (Math.abs(pull) < 1.5) return cap((rng() - 0.5) * 22 + normal(rng) * 3);
  const s = Math.sign(pull);
  const u = rng();
  if (u < 0.1) return cap(-s * (16 + rng() * 16));
  if (u < 0.22) return cap(normal(rng) * 2.5);
  return cap(s * (4 + rng() * (Math.abs(pull) * 2.2 + 14)));
}
