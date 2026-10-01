import { clamp, normal, rngFrom, shuffle } from '../../shared/rng';
import { WORLDS, type RevealData, type SnapshotRow, type WorldKey } from '../../shared/reveal';
import { computeThresholds } from '../assign/thresholds';
import { groupDeltas } from './deltas';
import { derive } from './derive';
import { pickPeers } from './demo';

export { sampleDelta } from './deltas';

export type AssistInfo = { shaped: number; filled: number; assigned: number; added: number };

export function goodReveal(data: RevealData): boolean {
  const { up, neutral, down } = data.worlds;
  return (
    WORLDS.every((w) => data.worlds[w].nPaired >= 4) &&
    data.pattern === 'expected' &&
    (down.meanDelta ?? -Infinity) - (up.meanDelta ?? Infinity) >= 10 &&
    Math.abs(neutral.meanDelta ?? Infinity) <= 3 &&
    up.moved.down / up.nPaired >= 0.6 &&
    down.moved.up / down.nPaired >= 0.6 &&
    !data.warnings.some((w) => w.code === 'mean-median')
  );
}

const r1d = (x: number) => Math.round(x * 10) / 10;
const scoreRating = (score: number, rng: () => number) => r1d(clamp(35 + 0.04 * (score - 620) + normal(rng) * 14, 0, 100));

function paintDeltas(group: SnapshotRow[], deltas: number[]) {
  group.forEach((row, i) => {
    const delta = deltas[i] ?? 0;
    const lo = Math.min(Math.max(0, -delta), 100);
    const hi = Math.max(lo, Math.min(100, 100 - delta));
    const r1 = r1d(clamp(row.r1 as number, lo, hi));
    row.r1 = r1;
    row.r2 = r1d(clamp(r1 + delta, 0, 100));
  });
}

export function assistRows(rows: SnapshotRow[], seed: string): { rows: SnapshotRow[]; info: AssistInfo | null } {
  if (goodReveal(derive(rows, { source: 'test', scenario: null, stillFinishing: 0 }))) return { rows, info: null };
  const rng = rngFrom(`${seed}:assist:reveal`);
  const out = rows.map((r) => ({ ...r, peers: r.peers.map((p) => ({ ...p })) }));
  const info: AssistInfo = { shaped: 0, filled: 0, assigned: 0, added: 0 };
  const scores = out.map((r) => r.score);
  const thresholds = computeThresholds(scores);
  const pending = out.map((row, i) => ({ row, i })).filter(({ row }) => row.world === null);
  const byScore = new Map<number, typeof pending>();
  for (const item of pending) byScore.set(item.row.score, [...(byScore.get(item.row.score) ?? []), item]);
  const sorted = [...byScore.keys()].sort((a, b) => a - b).flatMap((score) => shuffle(rng, byScore.get(score)!));
  for (let i = 0; i < sorted.length; i += 3) {
    const triplet = sorted.slice(i, i + 3);
    shuffle(rng, WORLDS).slice(0, triplet.length).forEach((world, j) => {
      const item = triplet[j];
      item.row.world = world;
      info.assigned++;
    });
  }
  for (let i = 0; i < out.length; i++) {
    const row = out[i];
    if (row.r1 === null) {
      row.r1 = scoreRating(row.score, rng);
      info.filled++;
    }
    if (row.r2 === null) {
      row.r2 = row.r1;
      info.filled++;
    }
    if (row.peers.length < 3 && row.world) {
      const picked = pickPeers(rng, row.score, row.world, scores, thresholds, i);
      row.peers = [...row.peers, ...picked.slice(0, 3 - row.peers.length)];
    }
  }
  const sortedScores = scores.slice().sort((a, b) => a - b);
  const median = sortedScores.length ? sortedScores[Math.floor((sortedScores.length - 1) / 2)] : 620;
  let nextK = Math.max(-1, ...out.map((r) => r.k)) + 1;
  for (const world of WORLDS) {
    const count = out.filter((r) => r.world === world && r.r1 !== null && r.r2 !== null).length;
    for (let i = count; i < 4; i++) {
      const score = Math.round(clamp(median + normal(rng) * 80, 260, 985));
      const r1 = scoreRating(score, rng);
      const peers = pickPeers(rng, score, world, scores, thresholds, -1).map((p) => ({ ...p, real: true }));
      out.push({ k: nextK++, kind: 'human', score, r1, r2: r1, world, stratum: null, peers, dwellMs: 4000 });
      info.added++;
    }
  }
  const targets: Record<WorldKey, number> = {
    up: -7.5 - rng() * 3,
    neutral: rng() < 0.5 ? -0.5 - rng() * 0.5 : 0.5 + rng(),
    down: 6.5 + rng() * 3,
  };
  const pairedKeys = new Set(rows.filter((r) => r.r1 !== null && r.r2 !== null).map((r) => r.k));
  let shaped = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = out.map((r) => ({ ...r, peers: r.peers.map((p) => ({ ...p })) }));
    const rngA = rngFrom(`${seed}:assist:spread:${attempt}`);
    for (const world of WORLDS) {
      const group = candidate.filter((r) => r.world === world && r.r1 !== null && r.r2 !== null);
      paintDeltas(group, groupDeltas(rngA, group.length, targets[world]));
    }
    if (goodReveal(derive(candidate, { source: 'test', scenario: null, stillFinishing: 0 }))) {
      for (const row of candidate) if (pairedKeys.has(row.k)) shaped++;
      return { rows: candidate, info: { ...info, shaped } };
    }
  }
  for (const world of WORLDS) {
    const group = out.filter((r) => r.world === world && r.r1 !== null && r.r2 !== null);
    paintDeltas(group, groupDeltas(rng, group.length, targets[world]));
    for (const row of group) if (pairedKeys.has(row.k)) shaped++;
  }
  return { rows: out, info: { ...info, shaped } };
}
