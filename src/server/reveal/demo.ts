import { clamp, normal, rngFrom, shuffle, type Rng } from '../../shared/rng';
import { WORLDS, type SnapshotRow, type WorldKey } from '../../shared/reveal';
import { bandFor, computeThresholds, inBand } from '../assign/thresholds';

export const SCENARIOS = ['expected', 'noisy', 'none', 'reversed', 'small', 'ties', 'imbalanced', 'lateheavy'] as const;
export type Scenario = (typeof SCENARIOS)[number];

type Spec = { effect: Record<WorldKey, number>; noise: number; missing: number; stillFinishing: number };
const E = { up: -8, neutral: 0, down: 7 };
export const SPECS: Record<Scenario, Spec> = {
  expected: { effect: E, noise: 5, missing: 0, stillFinishing: 0 },
  noisy: { effect: { up: -4, neutral: 1, down: 3 }, noise: 12, missing: 0.1, stillFinishing: 0 },
  none: { effect: { up: 0, neutral: 0, down: 0 }, noise: 5, missing: 0, stillFinishing: 0 },
  reversed: { effect: { up: 5, neutral: 0, down: -5 }, noise: 6, missing: 0, stillFinishing: 0 },
  small: { effect: E, noise: 5, missing: 0, stillFinishing: 0 },
  ties: { effect: { up: -6, neutral: 0, down: 6 }, noise: 6, missing: 0, stillFinishing: 0 },
  imbalanced: { effect: E, noise: 5, missing: 0, stillFinishing: 0 },
  lateheavy: { effect: E, noise: 5, missing: 0.4, stillFinishing: 12 },
};

const r1d = (x: number) => Math.round(x * 10) / 10;

function pickPeers(rng: Rng, score: number, world: WorldKey, pool: number[], th: ReturnType<typeof computeThresholds>, idx: number) {
  const band = bandFor(score, world, th);
  const target = world === 'up' ? score + th.targetGap : world === 'down' ? score - th.targetGap : score;
  const real = pool
    .map((s, i) => ({ s, i }))
    .filter((p) => p.i !== idx && inBand(p.s, band))
    .sort((a, b) => Math.abs(a.s - target) - Math.abs(b.s - target) + (rng() - 0.5) * 20)
    .slice(0, 3)
    .map((p) => ({ score: p.s, real: true }));
  while (real.length < 3) {
    const s = Math.round(clamp(target + normal(rng) * th.sigma * 0.5, band.lo, band.hi));
    real.push({ score: s, real: false });
  }
  if (rng() < 0.05) real[2] = { score: real[2].score, real: false };
  return real.sort((a, b) => Math.abs(a.score - score) - Math.abs(b.score - score));
}

export function demoRows(scenario: Scenario, n: number, seed: string): { rows: SnapshotRow[]; stillFinishing: number } {
  const spec = SPECS[scenario];
  const size = scenario === 'small' ? 6 : Math.max(0, Math.min(200, Math.round(n)));
  const rng = rngFrom(`demo:${scenario}:${size}:${seed}`);
  const scores: number[] = [];
  for (let i = 0; i < size; i++) {
    let s = Math.round(clamp(620 + normal(rng) * 140, 200, 1000) / 5) * 5;
    if (scenario === 'ties' ? rng() < 0.6 : rng() < 0.08 && i > 0) s = scenario === 'ties' ? 620 : scores[Math.floor(rng() * i)];
    scores.push(s);
  }
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s || a.i - b.i);
  const world: (WorldKey | null)[] = new Array(size).fill(null);
  const stratum: (number | null)[] = new Array(size).fill(null);
  if (scenario === 'imbalanced') {
    for (const { i } of order) {
      const u = rng();
      world[i] = u < 0.6 ? 'up' : u < 0.85 ? 'neutral' : 'down';
    }
  } else {
    for (let t = 0; t * 3 < order.length; t++) {
      const trip = order.slice(t * 3, t * 3 + 3);
      const ws = shuffle(rng, WORLDS);
      trip.forEach(({ i }, j) => {
        world[i] = ws[j];
        stratum[i] = trip.length === 3 ? t : null;
      });
    }
  }
  const th = computeThresholds(scores);
  let downKept = 0;
  const rows = scores.map((score, i): Omit<SnapshotRow, 'k'> => {
    const w = world[i] as WorldKey;
    const r1 = r1d(clamp(35 + 0.04 * (score - 620) + normal(rng) * 14, 0, 100));
    let r2: number | null = r1d(clamp(r1 + spec.effect[w] + normal(rng) * spec.noise, 0, 100));
    if (rng() < spec.missing) r2 = null;
    if (scenario === 'imbalanced' && w === 'down') r2 = downKept++ === 0 ? r2 ?? r1 : null;
    return { kind: 'human', score, r1, r2, world: w, stratum: stratum[i], peers: pickPeers(rng, score, w, scores, th, i), dwellMs: Math.round(3000 + rng() * 5000) };
  });
  const shuffled = shuffle(rng, rows).map((r, k) => ({ k, ...r }));
  return { rows: shuffled, stillFinishing: spec.stillFinishing };
}
