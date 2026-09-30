import type { RevealData, SceneId, ScreenState } from '../shared/reveal';
import { WORLDS } from '../shared/reveal';
import { isPart3 } from '../shared/discussion';
import { part3Frame } from './part3Copy';
import { WORLD_ACADEMIC, WORLD_PLAIN, compareCopy, fmt, mechanismLine, onegameCaption, selfRatingCaption, worldsCaption } from '../shared/revealCopy';

export type PlainFrame = { kicker: string; headline: string; lines: string[] };

export function plainFrame(st: Pick<ScreenState, 'scene' | 'beat' | 'live' | 'concept' | 'late' | 'q' | 'hide' | 'slot'>, d: RevealData | null): PlainFrame {
  const s: SceneId = st.scene;
  const b = st.beat;
  const live = st.live;
  if (isPart3(s)) return part3Frame(st, d);
  switch (s) {
    case 'lobby':
      return { kicker: 'SIGNAL SHIFT', headline: 'TUNE IN', lines: [`Room code ${live?.code ?? '—'}`, `${fmt(live?.joined ?? 0)} joined`] };
    case 'playing':
      return { kicker: 'SIGNAL IN PROGRESS', headline: 'PLAYING', lines: [`${fmt(live?.playing ?? 0)} playing · ${fmt(live?.rating ?? 0)} rating · ${fmt(live?.done ?? 0)} done`] };
    case 'hold':
      return { kicker: 'SIGNAL SHIFT', headline: 'EYES UP HERE', lines: ['Stand by.'] };
    case 'concept': {
      const q = st.concept?.quotes.filter((x) => x.text.trim())[Math.min(b, 2)] ?? st.concept?.quotes[0];
      return { kicker: st.concept?.title || 'CONCEPT', headline: q ? `“${q.text}”` : 'THE CONCEPT', lines: q ? [`${q.source}${q.page ? `, p. ${q.page}` : ''}`] : [] };
    }
    case 'end':
      return { kicker: 'SIGNAL SHIFT', headline: 'THANK YOU.', lines: ['All data stays anonymous.', ...(st.late ? [`+${st.late} finished after we froze the data.`] : [])] };
  }
  if (!d) return { kicker: 'SIGNAL SHIFT', headline: 'ONE MOMENT', lines: ['Loading the class data…'] };
  const w = d.worlds;
  switch (s) {
    case 'onegame':
      return {
        kicker: 'ONE GAME',
        headline: 'EVERYONE PLAYED THE SAME GAME.',
        lines: [
          onegameCaption(d),
          ...(b >= 1 && d.scores.mean !== null ? [`Average ${fmt(d.scores.mean)} · middle ${fmt(d.scores.median)}`] : []),
          ...(b >= 2 ? ['Every score was calculated by the server from the same rounds.'] : []),
        ],
      };
    case 'selfrating':
      if (!d.selfRating.ok) return { kicker: 'SELF-RATING', headline: 'HOW DID YOU THINK YOU DID?', lines: ['Not enough ratings yet to show.'] };
      return {
        kicker: 'SELF-RATING',
        headline: 'HOW DID YOU THINK YOU DID?',
        lines: [`${d.n.rated1} rated themselves after the game.`, ...(b >= 1 ? [`Average self-rating ${fmt(d.selfRating.mean, 'r1')} / 100.`, selfRatingCaption(d) ?? ''].filter(Boolean) : [])],
      };
    case 'cut':
      return b === 0
        ? { kicker: '', headline: 'THEN YOU SAW OTHER PLAYERS.', lines: [] }
        : { kicker: '', headline: 'WHO LOOKED AT THE OTHER SCORES?', lines: ['Be honest.'] };
    case 'samescore': {
      const ss = d.samescore;
      if (!ss) return { kicker: 'SAME SCORE', headline: 'SAME SCORE.', lines: [] };
      const lines = [ss.mode === 'real' ? 'Three real players from this room.' : ss.mode === 'example' ? 'An example built from this room’s real scores.' : 'An illustration.'];
      if (b >= 1) lines.push(ss.members.map((m) => fmt(m.score)).join(' · '));
      if (b >= 2) for (const m of ss.members) lines.push(`${WORLD_PLAIN[m.world]}: ${m.peers.map((p) => fmt(p.score)).join(', ')}`);
      return { kicker: 'SAME SCORE', headline: b >= 3 ? 'SAME SCORE. DIFFERENT CONTEXT.' : 'ALMOST THE SAME SCORE.', lines };
    }
    case 'worlds':
      return {
        kicker: 'THREE WORLDS',
        headline: 'YOU WERE SORTED INTO THREE ROOMS.',
        lines: [
          ...WORLDS.map((k) => `${b >= 2 ? WORLD_ACADEMIC[k] : WORLD_PLAIN[k]}: ${w[k].n} people${b >= 1 ? ` · average score ${fmt(w[k].meanScore)}` : ''}`),
          ...(b >= 1 ? [worldsCaption(d)] : []),
        ],
      };
    case 'movement':
      if (d.n.paired < 3) return { kicker: 'MOVEMENT', headline: 'NOT ENOUGH SECOND RATINGS YET.', lines: [`${d.n.paired} people rated twice.`] };
      return {
        kicker: 'MOVEMENT',
        headline: b === 0 ? 'YOUR FIRST RATINGS.' : b === 1 ? 'THEN YOU RATED AGAIN.' : b === 2 ? 'SOME WENT UP. SOME WENT DOWN.' : 'THE AVERAGE CHANGE.',
        lines: b >= 2 ? WORLDS.map((k) => `${WORLD_PLAIN[k]}: ${fmt(w[k].meanDelta, 'delta')} (${w[k].moved.up} up · ${w[k].moved.down} down · ${w[k].moved.same} same)`) : [],
      };
    case 'compare': {
      const c = compareCopy(d);
      return {
        kicker: 'COMPARE',
        headline: b >= 1 ? c.headline : 'CHANGE IN SELF-RATING',
        lines: [
          ...WORLDS.map((k) => `${WORLD_PLAIN[k]}: ${fmt(w[k].meanDelta, 'delta')}`),
          ...(b >= 1 ? [c.support] : []),
          ...(b >= 2 ? [`One class, ${d.n.paired} people. A real study would repeat this many times.`] : []),
        ],
      };
    }
    case 'mechanism':
      return {
        kicker: 'HOW IT WORKED',
        headline: 'THE ONLY DIFFERENCE WAS WHO YOU SAW.',
        lines: ['Same game → your score → three players chosen for your room → you rated again.', ...(b >= 1 ? [mechanismLine(d)] : [])],
      };
  }
  return { kicker: "SIGNAL SHIFT", headline: "SIGNAL SHIFT", lines: [] };
}
