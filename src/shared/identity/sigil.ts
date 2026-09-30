import { pick, randInt, type Rng } from '../rng';

export type Sigil = { a: number; b: number; phase: number; hue: number };

const PAIRS: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [3, 5], [4, 5], [1, 3], [2, 5], [5, 6], [3, 2], [5, 4],
];

export function makeSigil(rng: Rng): Sigil {
  const [a, b] = pick(rng, PAIRS);
  return { a, b, phase: Math.round(rng() * 628) / 100, hue: randInt(rng, 360) };
}

export function sigilPath(s: Sigil, size = 100, points = 200, phaseShift = 0): string {
  const r = size * 0.42;
  const c = size / 2;
  let d = '';
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    const x = c + r * Math.sin(s.a * t + s.phase + phaseShift);
    const y = c + r * Math.sin(s.b * t);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}
