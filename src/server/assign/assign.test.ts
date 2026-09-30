import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normal, rngFrom } from '../../shared/rng';
import { assignBatch, assignOne } from './assign';
import type { AssignInput } from './assign';
import type { PoolMember } from './peers';
import { bandFor, computeThresholds, inBand, type Condition } from './thresholds';

function setup(scores: number[], policy: 'fill' | 'off' = 'fill', seed = 's') {
  const real: PoolMember[] = scores.map((score, i) => ({ id: `p${i}`, score, kind: 'human' }));
  let g = 0;
  const input: AssignInput = {
    real,
    ghosts: [],
    exposure: new Map(),
    th: computeThresholds(scores),
    rng: rngFrom(seed),
    makeGhost: (score) => ({ id: `g${g++}`, score }),
    policy,
  };
  const viewers = real.map((p) => ({ id: p.id, score: p.score }));
  return { input, viewers, real };
}

function check(scores: number[], seed: string) {
  const { input, viewers, real } = setup(scores, 'fill', seed);
  const out = assignBatch(viewers, input);
  const byId = new Map(real.map((p) => [p.id, p]));
  expect(out.assignments.length).toBe(viewers.length);
  const ghostIds = new Set<string>();
  for (const a of out.assignments) {
    expect(a.peers.length).toBe(3);
    expect(new Set(a.peers.map((p) => p.id)).size).toBe(3);
    expect(a.peers.some((p) => p.id === a.viewerId)).toBe(false);
    const band = bandFor(a.viewerScore, a.condition, input.th);
    const realInBand = real.filter((p) => p.id !== a.viewerId && inBand(p.score, band)).length;
    for (const p of a.peers) {
      expect(inBand(p.score, band)).toBe(true);
      expect(p.score).toBeGreaterThanOrEqual(260);
      expect(p.score).toBeLessThanOrEqual(985);
      if (p.kind === 'ghost') {
        expect(realInBand).toBeLessThan(3);
        ghostIds.add(p.id);
      } else expect(byId.get(p.id)?.score).toBe(p.score);
    }
    for (let i = 1; i < a.peers.length; i++) expect(Math.abs(a.peers[i].diff)).toBeGreaterThanOrEqual(Math.abs(a.peers[i - 1].diff));
  }
  expect(out.newGhosts.length).toBe(ghostIds.size);
  return { out, input };
}

const counts = (cs: Condition[]) => ({
  up: cs.filter((c) => c === 'up').length,
  neutral: cs.filter((c) => c === 'neutral').length,
  down: cs.filter((c) => c === 'down').length,
});

describe('assignBatch', () => {
  it('invariants over random distributions', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 200, max: 1000 }), { minLength: 1, maxLength: 60 }), fc.string(), (scores, seed) => {
        check(scores, seed);
      }),
      { numRuns: 150 },
    );
  });

  it('balance within ±1 and score matching at n=24..30', () => {
    for (const n of [24, 27, 30]) {
      const rng = rngFrom(`n${n}`);
      const scores = Array.from({ length: n }, () => Math.round(Math.min(985, Math.max(260, 670 + normal(rng) * 120))));
      const { out, input } = check(scores, `b${n}`);
      const c = counts(out.assignments.map((a) => a.condition));
      expect(Math.max(c.up, c.neutral, c.down) - Math.min(c.up, c.neutral, c.down)).toBeLessThanOrEqual(1);
      const mean = (cond: Condition) => {
        const xs = out.assignments.filter((a) => a.condition === cond).map((a) => a.viewerScore);
        return xs.reduce((s, x) => s + x, 0) / xs.length;
      };
      const ms = (['up', 'neutral', 'down'] as Condition[]).map(mean);
      expect(Math.max(...ms) - Math.min(...ms)).toBeLessThanOrEqual(0.35 * input.th.robustSD);
      const exp = new Map<string, number>();
      for (const a of out.assignments) for (const p of a.peers) exp.set(p.id, (exp.get(p.id) ?? 0) + 1);
      if (n === 24 || n === 27) expect(Math.max(...exp.values())).toBeLessThanOrEqual(8);
    }
  });

  it('is deterministic per seed', () => {
    const scores = [400, 500, 600, 650, 700, 720, 800, 900];
    const a = assignBatch(setup(scores, 'fill', 'x').viewers, setup(scores, 'fill', 'x').input);
    const b = assignBatch(setup(scores, 'fill', 'x').viewers, setup(scores, 'fill', 'x').input);
    expect(a).toEqual(b);
  });

  it('edge cases: tiny pools, ties, extremes', () => {
    for (const scores of [[700], [700, 710], [600, 700, 800], [500, 550, 600, 650, 700], [650, 650, 650, 650, 650, 650]]) check(scores, 'e');
    const ex = check([985, 300, 600, 620, 640, 660, 680, 700, 720], 'ex').out;
    const top = ex.assignments.find((a) => a.viewerScore === 985)!;
    expect(top.condition).not.toBe('up');
  });

  it('policy off: never ghosts, degraded when infeasible', () => {
    const { input, viewers } = setup([500, 600], 'off');
    const out = assignBatch(viewers, input);
    expect(out.newGhosts.length).toBe(0);
    for (const a of out.assignments) {
      expect(a.condition).toBe('neutral');
      expect(a.degraded).toBe(true);
      expect(a.peers.every((p) => p.kind !== 'ghost')).toBe(true);
    }
  });

  it('reuses existing ghosts before creating new ones', () => {
    const { input, viewers } = setup([600, 605]);
    const out = assignBatch(viewers, input);
    const again = setup([600, 605]);
    again.input.ghosts = out.newGhosts.map((g) => ({ ...g, kind: 'ghost' as const }));
    const out2 = assignOne({ id: 'late', score: 603 }, [], { ...again.input, real: [...again.input.real, { id: 'late', score: 603, kind: 'human' }] });
    expect(out2.newGhosts.length).toBeLessThan(3);
  });
});

describe('assignOne', () => {
  it('balances within tercile using prior assignments', () => {
    const scores = Array.from({ length: 24 }, (_, i) => 400 + i * 20);
    const { input } = setup(scores);
    const prior = [
      { condition: 'up' as Condition, viewerScore: 640 },
      { condition: 'neutral' as Condition, viewerScore: 650 },
    ];
    const out = assignOne({ id: 'p12', score: 640 }, prior, input);
    expect(out.assignments[0].condition).toBe('down');
    expect(out.assignments[0].stratum).toBeNull();
  });
});
