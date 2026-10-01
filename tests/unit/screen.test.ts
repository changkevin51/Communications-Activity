import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { beeswarm, clampToSafe, SAFE } from '../../src/screen/layout';
import { targetsFor } from '../../src/screen/targets';
import { plainFrame } from '../../src/screen/plain';
import { captionFor } from '../../src/screen/Stage';
import { derive } from '../../src/server/reveal/derive';
import { demoRows, SCENARIOS } from '../../src/server/reveal/demo';
import { SCENES } from '../../src/shared/reveal';

const BAD = /\bNaN\b|undefined|\bnull\b|Infinity/;

describe('layout', () => {
  it('beeswarm is deterministic and non-overlapping below the cap', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 80 }), (xs) => {
        const items = xs.map((x, k) => ({ k, x }));
        const a = beeswarm(items, 6, 700, 1000);
        const b = beeswarm(items.slice().reverse(), 6, 700, 1000);
        for (const it of items) expect(a.get(it.k)).toBe(b.get(it.k));
        for (const p of items) for (const q of items) if (p.k < q.k) expect(Math.hypot(p.x - q.x, a.get(p.k)! - a.get(q.k)!)).toBeGreaterThanOrEqual(13.5);
      }),
    );
  });
  it('clamps to the safe area', () => {
    const t = clampToSafe({ k: 0, x: -50, y: 5000, r: 10, a: 1, color: '#fff' });
    expect(t.x).toBe(SAFE.x0 + 10);
    expect(t.y).toBe(SAFE.y1 - 10);
  });
});

describe('end slide', () => {
  it('puts both jokes under the anonymity line', () => {
    const base = { scene: 'end' as const, beat: 0, live: undefined, concept: undefined, q: undefined, hide: undefined, slot: null };
    expect(plainFrame({ ...base, late: 0 }, null).lines).toEqual(['All data stays anonymous.', 'Just kidding.', '(Just kidding.)']);
    expect(plainFrame({ ...base, late: 3 }, null).lines[3]).toBe('+3 finished after we froze the data.');
  });
});

describe('frames', () => {
  it('every scenario × scene × beat yields finite targets and clean copy', () => {
    for (const sc of SCENARIOS) {
      for (const n of [0, 1, 5, 40, 200]) {
        const { rows, stillFinishing } = demoRows(sc, n, 'u');
        const d = derive(rows, { source: 'demo', scenario: sc, stillFinishing });
        for (const s of SCENES) {
          for (let beat = 0; beat < s.beats; beat++) {
            const ts = targetsFor(s.id, beat, d);
            for (const t of ts) for (const v of [t.x, t.y, t.r, t.a]) expect(Number.isFinite(v)).toBe(true);
            const st = { scene: s.id, beat, nonce: 0, hold: false, plain: false, motion: 'full' as const, source: 'demo' as const, mode: 'test' as const, late: 0,
              live: { code: 'ABCD', joined: n, started: n, playing: 0, rating: 0, done: n }, concept: { title: '', quotes: [] } };
            const f = plainFrame(st, d);
            expect(f.headline.trim().length, `${sc}/${n}/${s.id}/${beat}`).toBeGreaterThan(0);
            expect([f.kicker, f.headline, ...f.lines, captionFor(st, d) ?? ''].join(' ')).not.toMatch(BAD);
          }
        }
      }
    }
  });
});
