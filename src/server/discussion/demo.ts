import { clamp, normal, rngFrom, type Rng } from '../../shared/rng';
import type { AnswerValue, Profile, PromptId } from '../../shared/discussion';
import { PROMPTS } from '../../shared/discussionContent';

const pick = <T>(rng: Rng, weights: [T, number][]): T => {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [v, w] of weights) if ((x -= w) <= 0) return v;
  return weights[weights.length - 1][0];
};

const slider = (rng: Rng, mean: number, sd: number) => Math.round(clamp(mean + normal(rng) * sd, 0, 100));

const TURNOUT: Record<Profile, number> = { expected: 0.9, onesided: 0.95, split: 0.9, low: 0.25, unexpected: 0.85, optionalzero: 0.9 };

function one(rng: Rng, prompt: PromptId, profile: Profile): AnswerValue {
  if (rng() < 0.05) return { skip: true };
  switch (prompt) {
    case 'felt': {
      const w: Record<Profile, [string, number][]> = {
        expected: [['yes', 2], ['little', 4], ['no', 5], ['didnt', 1]],
        onesided: [['yes', 1], ['little', 1], ['no', 12], ['didnt', 1]],
        split: [['yes', 3], ['little', 3], ['no', 3], ['didnt', 3]],
        low: [['yes', 1], ['little', 2], ['no', 2], ['didnt', 1]],
        unexpected: [['yes', 9], ['little', 3], ['no', 1], ['didnt', 0]],
        optionalzero: [['yes', 2], ['little', 4], ['no', 5], ['didnt', 1]],
      };
      return { c: pick(rng, w[profile]) };
    }
    case 'switch': {
      const flip = profile === 'unexpected' ? -1 : profile === 'split' ? (rng() < 0.5 ? -1 : 1) : 1;
      const gap = profile === 'onesided' ? 30 : 20;
      return { v: [slider(rng, 55 - flip * gap, 12), slider(rng, 55, 12), slider(rng, 55 + flip * gap, 12)] };
    }
    case 'mirrors': {
      const flip = profile === 'unexpected' ? -1 : 1;
      return { v: [slider(rng, 50 - flip * 18, 14), slider(rng, 50 + flip * 22, 12)] };
    }
    case 'landscape': {
      const ids = (PROMPTS.landscape.choices ?? []).map((c) => c.id).filter((c) => c !== 'none');
      if (rng() < 0.06) return { cs: ['none'] };
      const w = profile === 'onesided' ? ids.map((id): [string, number] => [id, id === 'school' ? 20 : 1]) : ids.map((id, i): [string, number] => [id, profile === 'split' ? 1 : 8 - i]);
      const out = new Set<string>();
      const k = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < 6 && out.size < k; i++) out.add(pick(rng, w));
      return { cs: [...out] };
    }
  }
}

/** Deterministic synthetic answers for rehearsal. */
export function demoAnswers(prompt: PromptId, profile: Profile, n: number, seed: string): { values: AnswerValue[]; eligible: number } {
  if (profile === 'optionalzero' && prompt === 'landscape') return { values: [], eligible: n };
  const rng = rngFrom(`${seed}:p3:${prompt}:${profile}`);
  const values: AnswerValue[] = [];
  for (let i = 0; i < n; i++) if (rng() < TURNOUT[profile]) values.push(one(rng, prompt, profile));
  return { values, eligible: n };
}
