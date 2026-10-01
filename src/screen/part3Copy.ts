import type { RevealData, ScreenState } from '../shared/reveal';
import { WORLDS } from '../shared/reveal';
import { WORLD_PLAIN, fmt } from '../shared/revealCopy';
import { roleAt, type Part3Scene, type PromptResult } from '../shared/discussion';
import { PIPELINE, PROMPTS, SCREEN_COPY } from '../shared/discussionContent';

type F = { kicker: string; headline: string; lines: string[] };
type St = Pick<ScreenState, 'scene' | 'beat' | 'q' | 'hide' | 'slot'>;

export const HEADLINES: Partial<Record<Part3Scene, string>> = {
  switch: 'SAME 78%. DIFFERENT ROOM.',
  mirrors: 'SAME B+. TWO DIFFERENT MIRRORS.',
};

export type Bar = { id: string; label: string; pct: number; n: number };

export function feelWord(m: number): string {
  if (m < 20) return 'BAD';
  if (m < 40) return 'NOT GREAT';
  if (m < 60) return 'OKAY';
  if (m < 80) return 'GOOD';
  return 'REALLY GOOD';
}

/** Choice bars, with suppressed cells merged into one "Other" bar. */
export function bars(r: PromptResult): Bar[] {
  const spec = PROMPTS[r.prompt];
  const total = Math.max(1, r.n);
  const out: Bar[] = [];
  let other = 0;
  let hasOther = false;
  for (const c of r.counts ?? []) {
    const ch = spec.choices?.find((x) => x.id === c.id);
    if (c.n === null) {
      hasOther = true;
      other += 1;
      continue;
    }
    if (spec.kind === 'multi' && c.n === 0) continue;
    out.push({ id: c.id, label: ch?.short ?? ch?.label ?? c.id, pct: Math.round((c.n / total) * 100), n: c.n });
  }
  if (hasOther) out.push({ id: 'other', label: 'OTHER', pct: -1, n: other });
  return out;
}

export function resultLines(r: PromptResult | null | undefined): string[] {
  if (!r) return [];
  if (r.small) return [`${fmt(r.n)} answered — not enough to show. Let's talk it through.`];
  const spec = PROMPTS[r.prompt];
  if (r.counts) return bars(r).map((b) => (b.pct < 0 ? `OTHER (small groups combined)` : `${b.label}: ${b.pct}%`));
  return (r.sliders ?? []).map((s) => {
    const sl = spec.sliders?.find((x) => x.id === s.id);
    const median = Math.round(s.median);
    return `${sl?.short ?? s.id}: most slid to “${feelWord(s.median)}” (${median}/100)`;
  });
}

export function part3Frame(st: St, d: RevealData | null): F {
  const scene = st.scene as Part3Scene;
  const copies = SCREEN_COPY[scene];
  const c = copies[Math.min(st.beat, copies.length - 1)];
  const role = roleAt(scene, st.beat);
  const lines = [...(c.lines ?? [])];
  let headline = c.headline;
  const q = st.q;
  if (role === 'concept') {
    const s = st.slot;
    if (s) return { kicker: c.kicker, headline: `“${s.text}”`, lines: [`${s.source}${s.page ? `, p. ${s.page}` : ''}`] };
    return { kicker: 'THE TEXTBOOK TERM', headline: c.kicker, lines: [] };
  }
  if (role === 'ask' && q) lines.push(`${fmt(q.count)} answered`);
  if ((role === 'reveal' || role === 'discuss') && q) {
    if (role === 'reveal' && HEADLINES[scene]) headline = HEADLINES[scene]!;
    if (st.hide) lines.push('Results hidden for now.');
    else if (!q.result) lines.push(q.phase === 'open' ? `${fmt(q.count)} answered` : 'No answers were collected.');
    else lines.push(...resultLines(q.result));
  }
  if (scene === 'felt' && role === 'discuss' && d && !st.hide) {
    lines.push(`What the ratings did: ${WORLDS.map((w) => `${WORLD_PLAIN[w]} ${fmt(d.worlds[w].meanDelta, 'delta')}`).join(' · ')}`);
  }
  if (scene === 'chooser') {
    const p = st.beat === 0 ? PIPELINE.today : PIPELINE.feed;
    lines.unshift(p.join(' → '));
    if (st.beat >= 2) lines.push(PIPELINE.examples.join(' · '));
  }
  return { kicker: c.kicker, headline, lines };
}
