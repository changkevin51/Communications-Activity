import { z } from 'zod';
import { MIN_CELL, MIN_SHOW, PROMPT_VERSION, type AnswerValue, type PromptId, type PromptResult } from '../../shared/discussion';
import { PROMPTS, type PromptSpec } from '../../shared/discussionContent';

export function validAnswer(spec: PromptSpec, v: AnswerValue): boolean {
  if ('skip' in v) return v.skip === true;
  const ids = new Set((spec.choices ?? []).map((c) => c.id));
  switch (spec.kind) {
    case 'single':
      return 'c' in v && ids.has(v.c);
    case 'multi': {
      if (!('cs' in v)) return false;
      const set = new Set(v.cs);
      if (set.size !== v.cs.length || v.cs.length < 1 || v.cs.length > (spec.max ?? 3)) return false;
      if (!v.cs.every((c) => ids.has(c))) return false;
      return !(spec.exclusive ?? []).some((x) => set.has(x) && set.size > 1);
    }
    case 'sliders':
      return 'v' in v && v.v.length === (spec.sliders ?? []).length && v.v.every((x) => Number.isInteger(x) && x >= 0 && x <= 100);
  }
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 10) / 10;
}

const lex = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** Pure, order-independent summary of one prompt run. Holds no identities or timestamps. */
export function aggregate(prompt: PromptId, run: number, source: PromptResult['source'], values: AnswerValue[], eligible: number): PromptResult {
  const spec = PROMPTS[prompt];
  const answers = values.filter((v) => !('skip' in v) && validAnswer(spec, v));
  const skipped = values.length - answers.length;
  const n = answers.length;
  const small = n < MIN_SHOW;
  const base: PromptResult = { version: PROMPT_VERSION, prompt, run, source, n, skipped, eligible: Math.max(eligible, values.length), small, counts: null, sliders: null };
  if (small) return base;
  if (spec.kind === 'single' || spec.kind === 'multi') {
    const tally = new Map<string, number>((spec.choices ?? []).map((c) => [c.id, 0]));
    for (const v of answers) {
      const picks = 'c' in v ? [v.c] : 'cs' in v ? v.cs : [];
      for (const c of picks) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    base.counts = [...tally].map(([id, c]) => ({ id, n: spec.kind === 'multi' && c > 0 && c < MIN_CELL ? null : c }));
    return base;
  }
  const vecs = answers.map((v) => ('v' in v ? v.v.slice() : [])).sort(lex);
  base.sliders = (spec.sliders ?? []).map((sl, i) => {
    const col = vecs.map((v) => v[i]).sort((a, b) => a - b);
    return { id: sl.id, median: quantile(col, 0.5), q1: quantile(col, 0.25), q3: quantile(col, 0.75), min: col[0], max: col[col.length - 1] };
  });
  return base;
}

const num = z.number().finite();
export const PublicPromptResult = z
  .object({
    version: z.literal(PROMPT_VERSION),
    prompt: z.enum(['felt', 'switch', 'landscape', 'mirrors']),
    run: num,
    source: z.enum(['live', 'test', 'demo']),
    n: num,
    skipped: num,
    eligible: num,
    small: z.boolean(),
    counts: z.array(z.object({ id: z.string().max(24), n: num.nullable() }).strict()).nullable(),
    sliders: z.array(z.object({ id: z.string().max(24), median: num, q1: num, q3: num, min: num, max: num }).strict()).nullable(),
  })
  .strict();

export function assertPublicPrompt(d: unknown): PromptResult {
  return PublicPromptResult.parse(d) as PromptResult;
}
