import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classify, derive, scoreAxis, selectSameScore, ILLUSTRATION } from '../../src/server/reveal/derive';
import { eligibility, type RawRow } from '../../src/server/reveal/eligibility';
import { demoRows, SCENARIOS } from '../../src/server/reveal/demo';
import { assertPublic } from '../../src/server/reveal/public';
import { CAUSAL_WORDS, compareCopy, fmt, footnote, mechanismLine, onegameCaption } from '../../src/shared/revealCopy';
import { SCENES, beatsFor, nextPos, prevPos, skipReason, type NavCtx, type Pos, type SnapshotRow, type WorldKey } from '../../src/shared/reveal';

const raw = (o: Partial<RawRow>): RawRow => ({
  id: Math.random().toString(36).slice(2), kind: 'human', stage: 'done', removed_at: null, started_at: 1, score: 600,
  attempt_status: 'complete', attempt_flags: '[]', r1: 40, r2: 42, world: 'up', stratum: 0, dwell_ms: 1000, peers: [], ...o,
});

const row = (o: Partial<SnapshotRow>, k = 0): SnapshotRow => ({ k, kind: 'human', score: 600, r1: 40, r2: 40, world: 'up', stratum: null, peers: [], dwellMs: null, ...o });

describe('eligibility', () => {
  it('live keeps humans only, test adds bots, ghosts never', () => {
    const rows = [raw({ kind: 'human' }), raw({ kind: 'bot' }), raw({ kind: 'ghost' })];
    expect(eligibility(rows, 'live', 's').rows).toHaveLength(1);
    expect(eligibility(rows, 'test', 's').rows).toHaveLength(2);
  });
  it('tracks exclusions', () => {
    const e = eligibility(
      [raw({ removed_at: 5 }), raw({ attempt_flags: '["invalid"]' }), raw({ score: null, attempt_status: null, stage: 'joined', started_at: null }), raw({ score: null, attempt_status: 'playing', stage: 'playing' }), raw({ attempt_flags: '["too_fast"]' })],
      'live', 's',
    );
    expect(e.counts.excluded).toEqual({ removed: 1, invalid: 1, noScore: 1, stillPlaying: 1 });
    expect(e.counts.flagged).toBe(1);
    expect(e.rows).toHaveLength(1);
    expect(e.stillFinishing).toBe(1);
  });
  it('emits no ids and a stable k order', () => {
    const rows = Array.from({ length: 10 }, (_, i) => raw({ id: `p${i}`, score: 500 + i }));
    const a = eligibility(rows, 'live', 'seed').rows;
    const b = eligibility(rows.slice().reverse(), 'live', 'seed').rows;
    expect(a.map((r) => r.score)).toEqual(b.map((r) => r.score));
    expect(JSON.stringify(a)).not.toContain('p1');
    expect(a.map((r) => r.k)).toEqual([...a.keys()]);
  });
});

describe('derive', () => {
  it('handles empty input', () => {
    const d = derive([], { source: 'live', scenario: null, stillFinishing: 0 });
    expect(d.samescore).toBeNull();
    expect(d.pattern).toBe('thin');
    expect(assertPublic(d)).toEqual(d);
  });
  it('world means need 2 values; moved uses eps 2', () => {
    const d = derive([row({ r1: 40, r2: 43 }, 0), row({ r1: 40, r2: 39 }, 1), row({ world: 'down', r1: 10, r2: 30 }, 2)], { source: 'test', scenario: null, stillFinishing: 0 });
    expect(d.worlds.up.meanDelta).toBe(1);
    expect(d.worlds.up.moved).toEqual({ up: 1, down: 0, same: 1 });
    expect(d.worlds.down.meanDelta).toBeNull();
  });
  it('score axis covers every score and never inverts', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 60 }), (xs) => {
        const a = scoreAxis(xs);
        expect(a.hi).toBeGreaterThan(a.lo);
        for (const x of xs) expect(x >= a.lo && x <= a.hi).toBe(true);
      }),
    );
  });
  it('property: output is always public and finite', () => {
    const W: (WorldKey | null)[] = ['up', 'neutral', 'down', null];
    fc.assert(
      fc.property(
        fc.array(fc.record({ score: fc.integer({ min: 200, max: 1000 }), r1: fc.option(fc.integer({ min: 0, max: 100 })), r2: fc.option(fc.integer({ min: 0, max: 100 })), w: fc.integer({ min: 0, max: 3 }) }), { maxLength: 80 }),
        (xs) => {
          const d = derive(xs.map((x, k) => row({ score: x.score, r1: x.r1, r2: x.r2, world: W[x.w] }, k)), { source: 'test', scenario: null, stillFinishing: 0 });
          assertPublic(d);
          expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity/);
        },
      ),
      { numRuns: 60 },
    );
  });
  it('classify patterns', () => {
    const w = (d: number | null, n = 5) => ({ n, nPaired: n, meanScore: 600, meanR1: 40, meanR2: 40, meanDelta: d, medianDelta: d, moved: { up: 0, down: 0, same: 0 }, small: false });
    expect(classify({ up: w(-6), neutral: w(0), down: w(5) }, 15)).toBe('expected');
    expect(classify({ up: w(0.5), neutral: w(0), down: w(1) }, 15)).toBe('flat');
    expect(classify({ up: w(5), neutral: w(0), down: w(-5) }, 15)).toBe('reversed');
    expect(classify({ up: w(-1.5), neutral: w(0), down: w(2) }, 15)).toBe('partial');
    expect(classify({ up: w(-6), neutral: w(0), down: w(5) }, 4)).toBe('thin');
  });
});

describe('same-score selection', () => {
  it('prefers a real triplet with range <= 30', () => {
    const peers = [{ score: 1, real: true }, { score: 2, real: true }, { score: 3, real: true }];
    const rows = [
      ...(['up', 'neutral', 'down'] as const).map((w, i) => row({ world: w, stratum: 1, score: 600 + i * 5, peers }, i)),
      ...Array.from({ length: 6 }, (_, i) => row({ score: 400 + i * 50, stratum: 9 + i }, 3 + i)),
    ];
    const s = selectSameScore(rows)!;
    expect(s.mode).toBe('real');
    expect(s.members.map((m) => m.world)).toEqual(['up', 'neutral', 'down']);
  });
  it('falls back to example then illustration', () => {
    const d = demoRows('expected', 40, 'x').rows.map((r) => ({ ...r, stratum: null }));
    expect(selectSameScore(d)!.mode).toBe('example');
    expect(selectSameScore([row({}), row({}, 1)])).toEqual(ILLUSTRATION);
  });
});

describe('demo scenarios', () => {
  it('deterministic', () => {
    expect(demoRows('expected', 30, 'a')).toEqual(demoRows('expected', 30, 'a'));
  });
  it.each([
    ['expected', ['expected']],
    ['none', ['flat', 'mixed', 'partial']],
    ['reversed', ['reversed']],
    ['small', ['thin']],
  ] as const)('%s produces an adaptive pattern', (sc, want) => {
    const { rows, stillFinishing } = demoRows(sc, 60, 'seed1');
    expect(want).toContain(derive(rows, { source: 'demo', scenario: sc, stillFinishing }).pattern);
  });
  it('every scenario derives valid public data', () => {
    for (const sc of SCENARIOS) {
      const { rows, stillFinishing } = demoRows(sc, 30, 'z');
      assertPublic(derive(rows, { source: 'demo', scenario: sc, stillFinishing }));
    }
  });
  it('imbalanced leaves one lane with one pair; lateheavy has late finishers', () => {
    const d = derive(demoRows('imbalanced', 40, 'q').rows, { source: 'demo', scenario: 'imbalanced', stillFinishing: 0 });
    expect(d.worlds.down.nPaired).toBe(1);
    expect(demoRows('lateheavy', 30, 'q').stillFinishing).toBe(12);
  });
});

describe('copy', () => {
  it('never uses causal or significance language', () => {
    for (const sc of SCENARIOS) {
      const { rows, stillFinishing } = demoRows(sc, 30, 'c');
      const d = derive(rows, { source: 'demo', scenario: sc, stillFinishing });
      const text = [compareCopy(d).headline, compareCopy(d).support, onegameCaption(d), mechanismLine(d), footnote(d) ?? ''].join(' ').toLowerCase();
      for (const w of CAUSAL_WORDS) expect(text).not.toContain(w);
      expect(text).not.toMatch(/nan|undefined|null|infinity/);
    }
  });
  it('fmt guards', () => {
    expect(fmt(NaN)).toBe('—');
    expect(fmt(null)).toBe('—');
    expect(fmt(5.12, 'delta')).toBe('+5.1');
    expect(fmt(-0.04, 'delta')).toBe('0');
    expect(fmt(-12.4, 'delta')).toBe('−12');
  });
});

describe('navigation', () => {
  const ctx: NavCtx = { data: null, concept: { title: '', quotes: [] } };
  it('skips optional scenes and never crosses into pre-reveal', () => {
    expect(nextPos({ scene: 'cut', beat: 1 }, ctx)).toEqual({ scene: 'worlds', beat: 0 });
    expect(prevPos({ scene: 'onegame', beat: 0 }, ctx)).toBeNull();
    expect(nextPos({ scene: 'hold', beat: 0 }, ctx)).toBeNull();
    expect(nextPos({ scene: 'end', beat: 0 }, ctx)).toBeNull();
  });
  it('walks every beat forward and back', () => {
    const d = derive(demoRows('expected', 30, 'n').rows, { source: 'demo', scenario: 'expected', stillFinishing: 0 });
    const c: NavCtx = { data: d, concept: { title: 'T', quotes: [{ text: 'q', source: 's', page: '1' }] } };
    let p: Pos = { scene: 'onegame', beat: 0 };
    const seen = [p];
    for (let n = nextPos(p, c); n; n = nextPos(p, c)) seen.push((p = n));
    const total = SCENES.filter((s) => !['lobby', 'playing', 'hold'].includes(s.id) && !skipReason(s.id, c)).reduce((a, s) => a + beatsFor(s.id, c), 0);
    expect(seen).toHaveLength(total);
    for (let n = prevPos(p, c); n; n = prevPos(p, c)) p = n;
    expect(p).toEqual({ scene: 'onegame', beat: 0 });
  });
});
