import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AnswerValue, PromptId } from '../../src/shared/discussion';
import type { SnapshotRow, WorldKey } from '../../src/shared/reveal';
import { aggregate } from '../../src/server/discussion/aggregate';
import { assistAnswers, goodPrompt } from '../../src/server/discussion/assist';
import { assistRows, goodReveal } from '../../src/server/reveal/assist';
import { derive } from '../../src/server/reveal/derive';

const row = (k: number, score: number, world: WorldKey | null, r1: number | null, r2: number | null, peers: SnapshotRow['peers'] = []): SnapshotRow => ({
  k, kind: 'human', score, r1, r2, world, stratum: null, peers, dwellMs: null,
});

const passingRows = () => (['up', 'neutral', 'down'] as const).flatMap((world, g) => [...Array(4)].map((_, i) => {
  const r1 = 40 + i;
  const delta = g === 0 ? -8 : g === 1 ? 0 : 8;
  return row(g * 4 + i, 600 + i, world, r1, r1 + delta);
}));

const slider = (length: number) => fc.array(fc.integer({ min: 0, max: 100 }), { minLength: length, maxLength: length }).map((v) => ({ v }));
const answerArb = (prompt: PromptId): fc.Arbitrary<AnswerValue> => {
  const skip = fc.constant<AnswerValue>({ skip: true });
  if (prompt === 'felt') return fc.oneof(skip, fc.constant<AnswerValue>({ c: 'no' }), fc.constant<AnswerValue>({ c: 'no' }), fc.constantFrom('yes', 'some', 'little', 'didnt').map((c) => ({ c })));
  if (prompt === 'switch') return fc.oneof(skip, fc.constant<AnswerValue>({ v: [80, 50, 20] }), fc.constant<AnswerValue>({ v: [80, 50, 20] }), slider(3));
  if (prompt === 'mirrors') return fc.oneof(skip, fc.constant<AnswerValue>({ v: [80, 20] }), fc.constant<AnswerValue>({ v: [80, 20] }), slider(2));
  return fc.oneof(skip, fc.constant<AnswerValue>({ cs: ['none'] }), fc.constant<AnswerValue>({ cs: ['none'] }), fc.constantFrom('school', 'coop', 'sport', 'social', 'plans', 'gaming', 'creative').map((c) => ({ cs: [c] })));
};

const goodAnswers: Record<PromptId, AnswerValue[]> = {
  felt: [...Array(8)].map((_, i) => ({ c: i < 3 ? 'yes' : i < 5 ? 'some' : 'little' })),
  switch: [...Array(8)].map(() => ({ v: [20, 55, 90] })),
  mirrors: [...Array(8)].map(() => ({ v: [20, 80] })),
  landscape: [...Array(8)].map(() => ({ cs: ['school', 'coop', 'social'] })),
};

describe('reveal assist', () => {
  it('always produces a valid expected reveal and is deterministic', () => {
    const world = fc.constantFrom<WorldKey | null>('up', 'neutral', 'down', null);
    const nullable = fc.constantFrom<number | null>(null, 0, 1, 20, 50, 99, 100);
    fc.assert(
      fc.property(
        fc.array(fc.record({ score: fc.integer({ min: 200, max: 1000 }), world, r1: nullable, r2: nullable, peers: fc.array(fc.record({ score: fc.integer({ min: 200, max: 1000 }), real: fc.boolean() }), { maxLength: 4 }) }), { maxLength: 80 }),
        (xs) => {
          const input = xs.map((x, k) => row(k, x.score, x.world, x.r1, x.r2, x.peers));
          const assisted = assistRows(input, 'property-seed');
          const data = derive(assisted.rows, { source: 'test', scenario: null, stillFinishing: 0 });
          expect(goodReveal(data)).toBe(true);
          expect(assistRows(input, 'property-seed')).toEqual(assisted);
          expect(assisted.rows).toHaveLength(input.length + (assisted.info?.added ?? 0));
          expect(data.marks).toHaveLength(input.length + (assisted.info?.added ?? 0));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('leaves already-good rows unchanged', () => {
    const input = passingRows();
    expect(goodReveal(derive(input, { source: 'test', scenario: null, stillFinishing: 0 }))).toBe(true);
    expect(assistRows(input, 'seed')).toEqual({ rows: input, info: null });
  });

  it('keeps visible within-room variation after shaping reversed rows', () => {
    const sd = (xs: number[]) => {
      const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((sum, x) => sum + (x - avg) ** 2, 0) / xs.length);
    };
    for (const seed of ['movement-a', 'movement-b', 'movement-c', 'movement-d', 'movement-e']) {
      const input = (['up', 'neutral', 'down'] as const).flatMap((world, g) => [...Array(10)].map((_, i) => {
        const r1 = 40 + i;
        const delta = g === 0 ? 5 : g === 1 ? 0 : -5;
        return row(g * 10 + i, 600 + g * 10 + i, world, r1, r1 + delta);
      }));
      const { rows } = assistRows(input, seed);
      for (const world of ['up', 'neutral', 'down'] as const) {
        const deltas = rows.filter((r) => r.world === world).map((r) => (r.r2 as number) - (r.r1 as number));
        expect(sd(deltas)).toBeGreaterThanOrEqual(4);
        expect(Math.max(...deltas) - Math.min(...deltas)).toBeGreaterThanOrEqual(18);
        if (world !== 'neutral') {
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          expect(deltas.some((d) => Math.sign(d) !== Math.sign(avg) && Math.abs(d) >= 10)).toBe(true);
        } else {
          expect(deltas.some((d) => d >= 2)).toBe(true);
          expect(deltas.some((d) => d <= -2)).toBe(true);
        }
      }
    }
  });
});

describe('poll assist', () => {
  it.each(['felt', 'switch', 'mirrors', 'landscape'] as const)('%s results always pass after assist', (prompt) => {
    const arb = answerArb(prompt);
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 60 }), (values) => {
        const result = assistAnswers(prompt, values, values.length, 'poll-property');
        expect(goodPrompt(aggregate(prompt, 1, 'test', result.values, values.length))).toBe(true);
        expect(result.values.filter((v) => !('skip' in v)).length).toBeGreaterThanOrEqual(Math.max(values.filter((v) => !('skip' in v)).length, 8));
      }),
      { numRuns: 60 },
    );
  });

  it.each(['felt', 'switch', 'mirrors', 'landscape'] as const)('%s keeps data that already passes', (prompt) => {
    const values = goodAnswers[prompt];
    expect(goodPrompt(aggregate(prompt, 1, 'live', values, values.length))).toBe(true);
    expect(assistAnswers(prompt, values, values.length, 'seed')).toEqual({ values, mode: 'real', added: 0 });
  });

  it('expected felt answers have the requested majority', () => {
    const values = [...Array(30)].map(() => ({ c: 'no' }));
    const assisted = assistAnswers('felt', values, 30, 'expected-felt');
    const result = aggregate('felt', 1, 'test', assisted.values, 30);
    const counts = Object.fromEntries(result.counts!.map((x) => [x.id, x.n ?? 0]));
    expect((counts.yes + counts.some + counts.little) / result.n).toBeGreaterThanOrEqual(0.6);
    expect(goodPrompt(result)).toBe(true);
  });
});
