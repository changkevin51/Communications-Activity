import type { ColorName } from './types';

export const COLORS: Record<ColorName, string> = {
  sun: '#FFD23F',
  paper: '#F4F1EA',
  sky: '#38BDF8',
  rose: '#FF5C8A',
  cobalt: '#3B5BDB',
};

export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 255);
  const g = srgbToLinear((n >> 8) & 255);
  const b = srgbToLinear(n & 255);
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116;
  return 116 * f - 16;
}

export const MIN_DELTA_L = 20;

export function deltaL(a: ColorName, b: ColorName): number {
  return Math.abs(lightness(COLORS[a]) - lightness(COLORS[b]));
}

export const COLOR_SWAPS: Record<ColorName, ColorName[]> = Object.fromEntries(
  COLOR_NAMES.map((c) => [c, COLOR_NAMES.filter((o) => o !== c && deltaL(c, o) >= MIN_DELTA_L)]),
) as Record<ColorName, ColorName[]>;
