import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { generatePractice, generateRound, glyphKey, isOriented, neighbors, zoneOf } from './generate';
import { SPECS } from './specs';
import { deltaL, COLOR_SWAPS, COLOR_NAMES, MIN_DELTA_L } from './palette';

describe('palette', () => {
  it('every color has lightness-distinct swaps', () => {
    for (const c of COLOR_NAMES) {
      expect(COLOR_SWAPS[c].length).toBeGreaterThanOrEqual(2);
      for (const o of COLOR_SWAPS[c]) expect(deltaL(c, o)).toBeGreaterThanOrEqual(MIN_DELTA_L);
    }
  });
});

describe('generateRound', () => {
  for (const spec of SPECS) {
    it(`round ${spec.idx + 1} invariants hold across seeds`, () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 30 }), (seed, variant) => {
          const r = generateRound(seed, spec.idx, variant);
          const n = spec.grid * spec.grid;
          expect(r.A.length).toBe(n);
          const diffs = r.A.map((g, i) => (g && r.B[i] ? glyphKey(g) !== glyphKey(r.B[i]!) : g !== r.B[i])).filter(Boolean);
          expect(diffs.length).toBe(1);
          expect(glyphKey(r.A[r.target]!)).not.toBe(glyphKey(r.B[r.target]!));
          expect(zoneOf(r.target, spec.grid)).toBe(spec.zone);
          expect(r.A.filter(Boolean).length).toBe(spec.items);
          expect(r.B.filter(Boolean).length).toBe(spec.items);
          const a = r.A[r.target]!;
          const b = r.B[r.target]!;
          if (spec.change === 'color') {
            expect(a.shape).toBe(b.shape);
            expect(deltaL(a.color, b.color)).toBeGreaterThanOrEqual(MIN_DELTA_L);
          } else if (spec.change === 'shape') {
            expect(a.shape).not.toBe(b.shape);
            expect(a.color).toBe(b.color);
          } else {
            expect(isOriented(a.shape)).toBe(true);
            expect(a.shape).toBe(b.shape);
            expect(Math.abs(a.rot - b.rot) % 180).toBe(90);
          }
          for (const layer of [r.A, r.B]) {
            for (let i = 0; i < n; i++) {
              const g = layer[i];
              if (!g) continue;
              for (const nb of neighbors(i, spec.grid)) {
                const h = layer[nb];
                if (h && layer === r.A) expect(glyphKey(h)).not.toBe(glyphKey(g));
              }
            }
          }
          const glyphs = r.A.filter(Boolean);
          expect(new Set(glyphs.map((g) => g!.color)).size).toBeGreaterThanOrEqual(Math.min(spec.items, 4));
          expect(new Set(glyphs.map((g) => g!.shape)).size).toBeGreaterThanOrEqual(3);
        }),
        { numRuns: 300 },
      );
    });
  }

  it('is deterministic', () => {
    expect(generateRound('abc', 5, 0)).toEqual(generateRound('abc', 5, 0));
    expect(generateRound('abc', 5, 0)).not.toEqual(generateRound('abc', 5, 1));
  });

  it('golden snapshot', () => {
    const golden = ['seed-a', 'seed-b', 'seed-c'].map((s) => [0, 6, 11].map((i) => generateRound(s, i, 0).target));
    expect(golden).toMatchInlineSnapshot(`
      [
        [
          5,
          2,
          11,
        ],
        [
          7,
          11,
          18,
        ],
        [
          7,
          11,
          8,
        ],
      ]
    `);
  });

  it('practice rounds generate', () => {
    const p = generatePractice('x', 0);
    expect(p.A.filter(Boolean).length).toBe(4);
  });
});
