import { z } from 'zod';
import type { RevealData } from '../../shared/reveal';

const num = z.number().finite();
const nn = num.nullable();
const World = z.enum(['up', 'neutral', 'down']);
const WorldStats = z.object({
  n: num, nPaired: num, meanScore: nn, meanR1: nn, meanR2: nn, meanDelta: nn, medianDelta: nn,
  moved: z.object({ up: num, down: num, same: num }),
  small: z.boolean(),
});

export const PublicReveal = z.object({
  version: z.literal('reveal@1'),
  source: z.enum(['live', 'test', 'demo']),
  scenario: z.string().nullable(),
  n: z.object({ eligible: num, rated1: num, assigned: num, paired: num, stillFinishing: num }),
  scoreAxis: z.object({ lo: num, hi: num, ticks: z.array(num) }),
  marks: z.array(z.object({ k: num, score: num, r1: nn, r2: nn, world: World.nullable() })),
  scores: z.object({ mean: nn, median: nn, min: nn, max: nn, ties: num }),
  selfRating: z.object({ ok: z.boolean(), mean: nn, corr: z.enum(['none', 'weak', 'clear']).nullable() }),
  worlds: z.object({ up: WorldStats, neutral: WorldStats, down: WorldStats }),
  samescore: z
    .object({
      mode: z.enum(['real', 'example', 'illustration']),
      focal: num,
      generated: num,
      members: z.array(z.object({ world: World, score: num, peers: z.array(z.object({ score: num, real: z.boolean() })) })),
    })
    .nullable(),
  mechanism: z.object({ peersShown: num, realShown: num, generatedShown: num, perPerson: z.literal(3) }),
  pattern: z.enum(['expected', 'partial', 'flat', 'reversed', 'mixed', 'thin']),
  warnings: z.array(z.object({ code: z.string(), text: z.string() })),
});

export function assertPublic(data: unknown): RevealData {
  return PublicReveal.parse(data) as RevealData;
}
