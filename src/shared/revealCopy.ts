import type { Pattern, RevealData, WorldKey } from './reveal';

export type Copy = { headline: string; support: string };

export function fmt(n: number | null | undefined, kind: 'int' | 'r1' | 'delta' | 'pct' = 'int'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (kind === 'delta') {
    const v = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    const s = Math.abs(v) >= 10 ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
    return v > 0 ? `+${s}` : v < 0 ? `−${s}` : '0';
  }
  if (kind === 'r1') return (Math.round(n * 10) / 10).toFixed(Math.abs(n) >= 10 ? 0 : 1);
  if (kind === 'pct') return `${Math.round(n)}%`;
  return String(Math.round(n));
}

export const WORLD_PLAIN: Record<WorldKey, string> = { up: 'SAW HIGHER SCORES', neutral: 'SAW SIMILAR SCORES', down: 'SAW LOWER SCORES' };
export const WORLD_SHORT: Record<WorldKey, string> = { up: 'saw higher', neutral: 'saw similar', down: 'saw lower' };
export const WORLD_ACADEMIC: Record<WorldKey, string> = { up: 'UPWARD COMPARISON', neutral: 'LATERAL COMPARISON', down: 'DOWNWARD COMPARISON' };
export const WORLD_GLYPH: Record<WorldKey, string> = { up: '▲', neutral: '●', down: '▼' };
export const WORLD_COLOR: Record<WorldKey, string> = { up: '#7CC8FF', neutral: '#F4F1EA', down: '#FFB547' };

const pts = (d: number | null) => `${fmt(d, 'delta')} points out of 100`;

const HEADLINES: Record<Pattern, string> = {
  expected: 'SAME GAME. THE JUDGMENTS MOVED APART.',
  partial: 'A SMALL SHIFT — IN THE EXPECTED DIRECTION.',
  flat: 'IN OUR CLASS, THE RATINGS BARELY MOVED.',
  reversed: 'IN OUR CLASS, IT WENT THE OTHER WAY.',
  mixed: 'MIXED SIGNALS.',
  thin: 'TOO FEW TO CALL.',
};

export function compareCopy(d: RevealData): Copy {
  const up = d.worlds.up.meanDelta;
  const down = d.worlds.down.meanDelta;
  const thin: Copy = { headline: HEADLINES.thin, support: `With ${d.n.paired} people, any pattern could be chance.` };
  switch (d.pattern) {
    case 'expected':
      if (up === null || down === null) return thin;
      return { headline: HEADLINES.expected, support: `In our class, people who saw higher scores rated themselves ${pts(up)} on average; people who saw lower scores, ${pts(down)}.` };
    case 'partial':
      return { headline: HEADLINES.partial, support: 'The groups moved differently, but only by a few points.' };
    case 'flat':
      return { headline: HEADLINES.flat, support: "Seeing different classmates didn't change much here. That's a real result too." };
    case 'reversed':
      if (up === null || down === null) return thin;
      return { headline: HEADLINES.reversed, support: `People who saw higher scores rated themselves ${pts(up)}; lower, ${pts(down)}. Why might that be?` };
    case 'mixed':
      return { headline: HEADLINES.mixed, support: "Some groups shifted, some didn't — no clear pattern." };
    default:
      return thin;
  }
}

export function onegameCaption(d: RevealData): string {
  const n = d.n.eligible;
  if (n === 0) return 'No finished games in this snapshot.';
  if (d.scores.min !== null && d.scores.min === d.scores.max && n > 1) return 'Most of you landed on the same score.';
  if (n < 3) return `${n} of you.`;
  return `${n} of you. Scores from ${fmt(d.scores.min)} to ${fmt(d.scores.max)}.`;
}

export function selfRatingCaption(d: RevealData): string | null {
  if (d.selfRating.corr === 'clear') return 'Higher scorers tended to rate themselves higher.';
  if (d.selfRating.corr === 'none' && d.n.rated1 >= 10) return "Your scores and your ratings didn't line up much.";
  return null;
}

export function worldsCaption(d: RevealData): string {
  const ms = (['up', 'neutral', 'down'] as const).map((w) => d.worlds[w].meanScore).filter((x): x is number => x !== null);
  if (ms.length >= 2 && Math.max(...ms) - Math.min(...ms) > 60) return 'Roughly similar scores in each group.';
  return 'Same kinds of scores in every group. Only the comparison was different.';
}

export function mechanismLine(_d: RevealData): string {
  return 'Everyone saw 3 other players.';
}

export function footnote(d: RevealData): string | null {
  if (d.n.stillFinishing <= 0) return null;
  const total = d.n.eligible + d.n.stillFinishing;
  return `${d.n.eligible} of ${total} players shown · ${d.n.stillFinishing} still finishing`;
}

export const CAUSAL_WORDS = ['caused', 'proves', 'because of', 'significant'];
