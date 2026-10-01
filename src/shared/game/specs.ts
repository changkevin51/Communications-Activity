import type { RoundSpec } from './types';

export const GAME_VERSION = 'signal-shift@1';
export const ROUND_COUNT = 12;
export const MASK_MS = 400;
export const CUE_MS = 400;
export const TIMEOUT_MS = 5000;
export const FEEDBACK_MS = 550;
export const GAP_MS = 250;
/** Extra memorize time on every scored round. */
export const STUDY_BONUS_MS = 1200;
/** Additional look time on the larger boards. */
const LARGER_GRID_STUDY_MS: Record<number, number> = { 4: 800, 5: 1200 };

type Row = [number, number, number, RoundSpec['change'], RoundSpec['zone'], number, number, number];

const ROWS: Row[] = [
  [3, 5, 1400, 'color', 'edge', 1.0, 600, 2600],
  [3, 5, 1400, 'shape', 'corner', 1.0, 600, 2600],
  [3, 5, 1300, 'rotate', 'edge', 1.0, 600, 2600],
  [4, 7, 1400, 'color', 'inner', 1.25, 700, 3000],
  [4, 7, 1300, 'shape', 'edge', 1.25, 700, 3000],
  [4, 7, 1300, 'rotate', 'corner', 1.25, 700, 3000],
  [4, 7, 1200, 'color', 'edge', 1.25, 700, 3000],
  [4, 7, 1200, 'shape', 'inner', 1.25, 700, 3000],
  [5, 9, 1400, 'color', 'inner', 1.5, 800, 3400],
  [5, 9, 1300, 'rotate', 'edge', 1.5, 800, 3400],
  [5, 9, 1300, 'shape', 'corner', 1.5, 800, 3400],
  [5, 9, 1200, 'color', 'inner', 1.5, 800, 3400],
];

export const SPECS: readonly RoundSpec[] = ROWS.map(([grid, items, studyMs, change, zone, weight, fastMs, slowMs], i) => ({
  idx: i,
  grid,
  items,
  studyMs: studyMs + STUDY_BONUS_MS + (LARGER_GRID_STUDY_MS[grid] ?? 0),
  change,
  zone,
  weight,
  fastMs,
  slowMs,
  maskMs: MASK_MS,
  timeoutMs: TIMEOUT_MS,
}));

export const PRACTICE_SPEC: RoundSpec = {
  idx: -1,
  grid: 3,
  items: 4,
  studyMs: 2600,
  change: 'color',
  zone: 'edge',
  weight: 0,
  fastMs: 0,
  slowMs: 1,
  maskMs: 500,
  timeoutMs: Number.POSITIVE_INFINITY,
};

export const TIER_BREAKS: Record<number, string> = { 3: '4 × 4', 8: '5 × 5' };
