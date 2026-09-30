import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeThresholds } from './thresholds';

describe('thresholds', () => {
  it('small-n fallback', () => {
    const th = computeThresholds([500, 600]);
    expect(th.robustSD).toBe(110);
    expect(th.gapMin).toBe(66);
  });
  it('clamps and neutralWindow < gapMin', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 200, max: 1000 }), { maxLength: 80 }), (scores) => {
        const th = computeThresholds(scores);
        expect(th.robustSD).toBeGreaterThanOrEqual(60);
        expect(th.robustSD).toBeLessThanOrEqual(200);
        expect(th.gapMin).toBeGreaterThanOrEqual(45);
        expect(th.gapMin).toBeLessThanOrEqual(120);
        expect(th.neutralWindow).toBeLessThan(th.gapMin);
        expect(th.dialSpan).toBeGreaterThanOrEqual(360);
        expect(th.dialSpan).toBeLessThanOrEqual(640);
      }),
    );
  });
});
