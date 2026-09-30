import { COLOR_NAMES, COLOR_SWAPS } from './palette';
import { PRACTICE_SPEC, SPECS } from './specs';
import type { Glyph, Round, RoundSpec, Shape, Zone } from './types';
import { pick, randInt, rngFrom, shuffle, type Rng } from '../rng';

export const SHAPES: readonly Shape[] = ['circle', 'square', 'ring', 'plus', 'triangle', 'halfdisc'];
export const ORIENTED: readonly Shape[] = ['triangle', 'halfdisc'];
const ROTS = [0, 90, 180, 270] as const;

export function isOriented(s: Shape): boolean {
  return ORIENTED.includes(s);
}

export function glyphKey(g: Glyph): string {
  return `${g.shape}:${g.color}:${isOriented(g.shape) ? g.rot : 0}`;
}

export function zoneOf(cell: number, grid: number): Zone {
  const r = Math.floor(cell / grid);
  const c = cell % grid;
  const edgeR = r === 0 || r === grid - 1;
  const edgeC = c === 0 || c === grid - 1;
  if (edgeR && edgeC) return 'corner';
  if (edgeR || edgeC) return 'edge';
  return 'inner';
}

export function neighbors(cell: number, grid: number): number[] {
  const r = Math.floor(cell / grid);
  const c = cell % grid;
  const out: number[] = [];
  if (r > 0) out.push(cell - grid);
  if (r < grid - 1) out.push(cell + grid);
  if (c > 0) out.push(cell - 1);
  if (c < grid - 1) out.push(cell + 1);
  return out;
}

function chooseCells(rng: Rng, spec: RoundSpec): { target: number; cells: number[] } {
  const n = spec.grid * spec.grid;
  const zoneCells = Array.from({ length: n }, (_, i) => i).filter((i) => zoneOf(i, spec.grid) === spec.zone);
  const cap = Math.ceil(spec.items / spec.grid) + 1;
  for (let attempt = 0; attempt < 200; attempt++) {
    const target = pick(rng, zoneCells);
    const others = shuffle(
      rng,
      Array.from({ length: n }, (_, i) => i).filter((i) => i !== target),
    ).slice(0, spec.items - 1);
    const cells = [target, ...others];
    const rows = new Array(spec.grid).fill(0);
    const cols = new Array(spec.grid).fill(0);
    for (const c of cells) {
      rows[Math.floor(c / spec.grid)]++;
      cols[c % spec.grid]++;
    }
    if (Math.max(...rows) <= cap && Math.max(...cols) <= cap) return { target, cells };
  }
  throw new Error('layout generation failed');
}

function randomGlyph(rng: Rng, shapes: readonly Shape[]): Glyph {
  const shape = pick(rng, shapes);
  return { shape, color: pick(rng, COLOR_NAMES), rot: isOriented(shape) ? pick(rng, ROTS) : 0 };
}

function neighborKeys(A: (Glyph | null)[], cell: number, grid: number): Set<string> {
  const s = new Set<string>();
  for (const nb of neighbors(cell, grid)) {
    const g = A[nb];
    if (g) s.add(glyphKey(g));
  }
  return s;
}

function assignGlyphs(rng: Rng, spec: RoundSpec, cells: number[], target: number): (Glyph | null)[] | null {
  const n = spec.grid * spec.grid;
  const A: (Glyph | null)[] = new Array(n).fill(null);
  for (const cell of cells) {
    const shapes = cell === target && spec.change === 'rotate' ? ORIENTED : SHAPES;
    let placed = false;
    for (let t = 0; t < 30; t++) {
      const g = randomGlyph(rng, shapes);
      if (!neighborKeys(A, cell, spec.grid).has(glyphKey(g))) {
        A[cell] = g;
        placed = true;
        break;
      }
    }
    if (!placed) return null;
  }
  const glyphs = cells.map((c) => A[c] as Glyph);
  if (new Set(glyphs.map((g) => g.color)).size < Math.min(spec.items, 4)) return null;
  if (new Set(glyphs.map((g) => g.shape)).size < 3) return null;
  return A;
}

function applyChange(rng: Rng, spec: RoundSpec, A: (Glyph | null)[], target: number): Glyph | null {
  const g = A[target] as Glyph;
  const nbKeys = neighborKeys(A, target, spec.grid);
  const nbColors = new Set(neighbors(target, spec.grid).map((c) => A[c]?.color).filter(Boolean));
  let candidates: Glyph[] = [];
  if (spec.change === 'color') {
    const swaps = COLOR_SWAPS[g.color];
    const preferred = swaps.filter((c) => !nbColors.has(c));
    candidates = (preferred.length ? preferred : swaps).map((color) => ({ ...g, color }));
  } else if (spec.change === 'shape') {
    candidates = SHAPES.filter((s) => s !== g.shape).map((shape) => ({
      ...g,
      shape,
      rot: isOriented(shape) ? g.rot : 0,
    }));
  } else {
    candidates = [90, 270].map((d) => ({ ...g, rot: ((g.rot + d) % 360) as Glyph['rot'] }));
  }
  candidates = candidates.filter((c) => !nbKeys.has(glyphKey(c)));
  if (!candidates.length) return null;
  return pick(rng, candidates);
}

export function generateFromSpec(seed: string, spec: RoundSpec, variant: number): Round {
  const rng = rngFrom(`${seed}:${spec.idx}:${variant}`);
  for (let attempt = 0; attempt < 500; attempt++) {
    const { target, cells } = chooseCells(rng, spec);
    const A = assignGlyphs(rng, spec, cells, target);
    if (!A) continue;
    const changed = applyChange(rng, spec, A, target);
    if (!changed) continue;
    const B = A.slice();
    B[target] = changed;
    return { grid: spec.grid, A, B, target };
  }
  throw new Error(`round generation failed for ${seed}:${spec.idx}:${variant}`);
}

export function generateRound(seed: string, idx: number, variant: number): Round {
  const spec = SPECS[idx];
  if (!spec) throw new Error(`no spec ${idx}`);
  return generateFromSpec(seed, spec, variant);
}

export function generatePractice(seed: string, variant: number): Round {
  return generateFromSpec(`${seed}:practice`, PRACTICE_SPEC, variant);
}

export function randomCell(rng: Rng, grid: number): number {
  return randInt(rng, grid * grid);
}
