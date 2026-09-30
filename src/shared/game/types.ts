export type Shape = 'circle' | 'square' | 'ring' | 'plus' | 'triangle' | 'halfdisc';
export type ColorName = 'sun' | 'paper' | 'sky' | 'rose' | 'cobalt';
export type ChangeType = 'color' | 'shape' | 'rotate';
export type Zone = 'corner' | 'edge' | 'inner';

export type Glyph = { shape: Shape; color: ColorName; rot: 0 | 90 | 180 | 270 };

export type RoundSpec = {
  idx: number;
  grid: number;
  items: number;
  studyMs: number;
  change: ChangeType;
  zone: Zone;
  weight: number;
  fastMs: number;
  slowMs: number;
  maskMs: number;
  timeoutMs: number;
};

export type Round = {
  grid: number;
  A: (Glyph | null)[];
  B: (Glyph | null)[];
  target: number;
};
