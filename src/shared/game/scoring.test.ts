import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeStats, scoreAttempt, scoreFromHits } from './scoring';
import { SPECS } from './specs';
import { generateRound } from './generate';

const all = (hit: boolean, rt: (i: number) => number | null) => SPECS.map((s) => ({ idx: s.idx, hit, rtMs: rt(s.idx) }));

describe('scoring', () => {
  it('extremes', () => {
    expect(scoreFromHits(all(true, (i) => SPECS[i].fastMs - 100))).toBe(1000);
    expect(scoreFromHits(all(false, () => 300))).toBe(200);
    expect(scoreFromHits(all(true, (i) => SPECS[i].slowMs + 100))).toBe(840);
  });

  it('a fast miss earns nothing', () => {
    const rounds = all(false, () => 100);
    rounds[0] = { idx: 0, hit: false, rtMs: 50 };
    expect(scoreFromHits(rounds)).toBe(200);
  });

  const arb = fc.array(fc.record({ hit: fc.boolean(), rt: fc.integer({ min: 0, max: 5000 }) }), {
    minLength: 12,
    maxLength: 12,
  });

  it('monotone in hits and speed; ±50ms shift moves ≤ 4 points', () => {
    fc.assert(
      fc.property(arb, fc.integer({ min: 0, max: 11 }), (rs, k) => {
        const base = rs.map((r, i) => ({ idx: i, hit: r.hit, rtMs: r.rt }));
        const s = scoreFromHits(base);
        const moreHits = base.map((r, i) => (i === k ? { ...r, hit: true } : r));
        expect(scoreFromHits(moreHits)).toBeGreaterThanOrEqual(s);
        const faster = base.map((r, i) => (i === k ? { ...r, rtMs: Math.max(0, (r.rtMs ?? 0) - 300) } : r));
        expect(scoreFromHits(faster)).toBeGreaterThanOrEqual(s);
        const shifted = base.map((r) => ({ ...r, rtMs: (r.rtMs ?? 0) + 50 }));
        expect(Math.abs(scoreFromHits(shifted) - s)).toBeLessThanOrEqual(4);
      }),
    );
  });

  it('stats edge cases', () => {
    const none = computeStats([{ hit: false, tapped: null, rtMs: null }]);
    expect(none.avgLockMs).toBeNull();
    expect(none.fastestMs).toBeNull();
    expect(none.bestStreak).toBe(0);
    const st = computeStats([
      { hit: true, tapped: 1, rtMs: 900 },
      { hit: true, tapped: 1, rtMs: 700 },
      { hit: false, tapped: 2, rtMs: 400 },
      { hit: true, tapped: 1, rtMs: 800 },
    ]);
    expect(st).toMatchObject({ hits: 3, misses: 1, timeouts: 0, bestStreak: 2, fastestMs: 700, avgLockMs: 800 });
  });

  it('scoreAttempt uses the seed and drops out-of-range taps', () => {
    const seed = 'attempt-1';
    const subs = SPECS.map((s) => {
      const r = generateRound(seed, s.idx, 0);
      return { idx: s.idx, variant: 0, tapped: r.target, rtMs: 500, studyMs: s.studyMs, maskMs: 400 };
    });
    expect(scoreAttempt(seed, subs).score).toBe(1000);
    subs[0] = { ...subs[0], tapped: 99 };
    const res = scoreAttempt(seed, subs);
    expect(res.rounds[0].tapped).toBeNull();
    expect(res.score).toBeLessThan(1000);
  });
});
