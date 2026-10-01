import { clamp, normal, rngFrom } from '../../shared/rng';
import type { AnswerValue, PromptId, PromptResult } from '../../shared/discussion';
import { MIN_CELL } from '../../shared/discussion';
import { aggregate } from './aggregate';
import { demoAnswer } from './demo';

export const ASSIST_FLOOR = 8;

export function goodPrompt(result: PromptResult): boolean {
  if (result.small || result.n < ASSIST_FLOOR) return false;
  if (result.prompt === 'felt') {
    const tally = Object.fromEntries((result.counts ?? []).map((x) => [x.id, x.n ?? 0]));
    const yes = tally.yes ?? 0;
    const some = tally.some ?? 0;
    const little = tally.little ?? 0;
    const no = tally.no ?? 0;
    const didnt = tally.didnt ?? 0;
    return (yes + some + little) / result.n >= 0.6 && Math.max(yes, some, little) >= Math.max(no, didnt) && didnt / result.n <= 0.15;
  }
  if (result.prompt === 'switch') {
    const sliders = Object.fromEntries((result.sliders ?? []).map((x) => [x.id, x.median]));
    return (sliders.hi ?? Infinity) + 12 <= (sliders.mid ?? -Infinity) && (sliders.mid ?? Infinity) + 12 <= (sliders.lo ?? -Infinity);
  }
  if (result.prompt === 'mirrors') {
    const sliders = Object.fromEntries((result.sliders ?? []).map((x) => [x.id, x.median]));
    return (sliders.friend ?? -Infinity) - (sliders.grades ?? Infinity) >= 20;
  }
  const counts = result.counts ?? [];
  const active = counts.filter((x) => x.id !== 'none' && (x.n ?? 0) >= MIN_CELL);
  const top = counts.reduce((a, b) => (b.n ?? 0) > (a.n ?? 0) ? b : a, { id: 'none', n: 0 });
  return active.length >= 3 && top.id !== 'none';
}

function synthetic(prompt: PromptId, n: number, seed: string, passes?: (values: AnswerValue[]) => boolean): AnswerValue[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rng = rngFrom(`${seed}:${prompt}:${attempt}`);
    const out: AnswerValue[] = [];
    while (out.length < n) {
      const answer = demoAnswer(rng, prompt, 'expected');
      if (!('skip' in answer)) out.push(answer);
    }
    if (passes ? passes(out) : goodPrompt(aggregate(prompt, 1, 'test', out, n))) return out;
  }
  const rng = rngFrom(`${seed}:${prompt}:exact`);
  if (prompt === 'felt') {
    const didnt = Math.max(1, Math.round(n * 0.06));
    const remaining = n - didnt;
    const quotas = [0.22, 0.26, 0.24, 0.22].map((x) => x / 0.94 * remaining);
    const counts = quotas.map(Math.floor);
    const left = remaining - counts.reduce((a, b) => a + b, 0);
    const order = quotas.map((x, i) => ({ i, remainder: x - counts[i] })).sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < left; i++) counts[order[i].i]++;
    const out: AnswerValue[] = ['yes', 'some', 'little', 'no'].flatMap((c, i) => [...Array(counts[i])].map(() => ({ c })));
    out.push(...[...Array(didnt)].map(() => ({ c: 'didnt' })));
    return out;
  }
  if (prompt === 'switch') {
    return [...Array(n)].map(() => ({ v: [clamp(32 + normal(rng) * 11, 24, 40), clamp(56 + normal(rng) * 11, 53, 60), clamp(79 + normal(rng) * 11, 75, 90)].map(Math.round) }));
  }
  if (prompt === 'mirrors') {
    return [...Array(n)].map(() => ({ v: [clamp(34 + normal(rng) * 12, 20, 45), clamp(74 + normal(rng) * 12, 68, 90)].map(Math.round) }));
  }
  return [...Array(n)].map(() => ({ cs: ['school', 'coop', 'social'] }));
}

export function assistAnswers(prompt: PromptId, values: AnswerValue[], eligible: number, seed: string): { values: AnswerValue[]; mode: 'real' | 'padded' | 'replaced'; added: number } {
  if (goodPrompt(aggregate(prompt, 1, 'test', values, eligible))) return { values, mode: 'real', added: 0 };
  const answered = values.filter((v) => !('skip' in v));
  const skips = values.filter((v) => 'skip' in v);
  const target = Math.max(answered.length, ASSIST_FLOOR);
  if (answered.length < ASSIST_FLOOR) {
    const added = synthetic(prompt, ASSIST_FLOOR - answered.length, seed, (extra) => goodPrompt(aggregate(prompt, 1, 'test', [...values, ...extra], eligible)));
    const topped = [...values, ...added];
    if (goodPrompt(aggregate(prompt, 1, 'test', topped, eligible))) return { values: topped, mode: 'padded', added: ASSIST_FLOOR - answered.length };
  }
  const replacements = synthetic(prompt, target, seed);
  return { values: [...replacements, ...skips], mode: 'replaced', added: replacements.length };
}
