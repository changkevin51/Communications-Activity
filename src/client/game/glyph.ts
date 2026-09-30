import type { Glyph } from '../../shared/game/types';
import { COLORS } from '../../shared/game/palette';

const SHAPES: Record<Glyph['shape'], (c: string) => string> = {
  circle: (c) => `<circle cx="50" cy="50" r="30" fill="${c}"/>`,
  square: (c) => `<rect x="23" y="23" width="54" height="54" fill="${c}"/>`,
  ring: (c) => `<circle cx="50" cy="50" r="26" fill="none" stroke="${c}" stroke-width="11"/>`,
  plus: (c) => `<path d="M42 20h16v22h22v16H58v22H42V58H20V42h22z" fill="${c}"/>`,
  triangle: (c) => `<path d="M50 18 82 78H18z" fill="${c}"/>`,
  halfdisc: (c) => `<path d="M18 62a32 32 0 0 1 64 0z" fill="${c}"/>`,
};

export function glyphSvg(g: Glyph | null): string {
  if (!g) return '';
  const inner = SHAPES[g.shape](COLORS[g.color]);
  const t = g.rot ? ` transform="rotate(${g.rot} 50 50)"` : '';
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g${t}>${inner}</g></svg>`;
}
