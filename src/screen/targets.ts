import type { Mark, RevealData, SceneId } from '../shared/reveal';
import { WORLD_COLOR } from '../shared/revealCopy';
import { LANES, SAFE, beeswarm, clampToSafe, jitter, laneX, markRadius, movementRatingY, ratingY, scoreX, type Target } from './layout';

const PAPER = '#F4F1EA';
const color = (m: Mark) => (m.world ? WORLD_COLOR[m.world] : PAPER);

function swarm(d: RevealData, a: number, baseY = 720, maxRise = 420, col = (_m: Mark) => PAPER): Target[] {
  const r = markRadius(d.marks.length);
  const x = scoreX(d);
  const ys = beeswarm(d.marks.map((m) => ({ k: m.k, x: x(m.score) })), r, baseY, maxRise);
  return d.marks.map((m) => clampToSafe({ k: m.k, x: x(m.score), y: ys.get(m.k) ?? baseY, r, a, color: col(m) }));
}

function lanesByScore(d: RevealData, a: number): Target[] {
  const r = markRadius(d.marks.length);
  const x = scoreX(d, SAFE.x0 + 260, SAFE.x1 - 60);
  const out: Target[] = [];
  LANES.forEach((w, i) => {
    const base = 380 + i * 220;
    const ms = d.marks.filter((m) => m.world === w);
    const ys = beeswarm(ms.map((m) => ({ k: m.k, x: x(m.score) })), Math.min(r, 8), base, 80, 0);
    for (const m of ms) out.push(clampToSafe({ k: m.k, x: x(m.score), y: ys.get(m.k) ?? base, r: Math.min(r, 8), a, color: color(m) }));
  });
  for (const m of d.marks.filter((q) => !q.world)) out.push({ k: m.k, x: x(m.score), y: 960, r: Math.min(r, 6), a: 0.15, color: PAPER });
  return out;
}

function lanesCluster(d: RevealData, a: number): Target[] {
  const r = markRadius(d.marks.length);
  return d.marks.map((m, i) => {
    if (!m.world) return { k: m.k, x: 960, y: 980, r, a: 0, color: PAPER };
    return clampToSafe({ k: m.k, x: laneX(m.world) + jitter(m.k, 360), y: 560 + jitter(m.k + 7 + i, 360), r, a, color: color(m) });
  });
}

function movement(d: RevealData, beat: number): Target[] {
  const r = Math.min(markRadius(d.marks.length), 8);
  const y = movementRatingY(d);
  return d.marks.map((m) => {
    if (!m.world || m.r1 === null) return { k: m.k, x: 960, y: 1000, r, a: 0, color: PAPER };
    const x = laneX(m.world) + jitter(m.k, 420);
    const y1 = y(m.r1);
    if (beat === 0 || m.r2 === null) return clampToSafe({ k: m.k, x, y: y1, r, a: beat === 0 ? 0.9 : 0.25, color: color(m) });
    const t = clampToSafe({ k: m.k, x, y: y(m.r2), r, a: beat === 3 ? 0.25 : 0.9, color: color(m) });
    return { ...t, trail: { x: t.x, y: y1 } };
  });
}

export function targetsFor(scene: SceneId, beat: number, d: RevealData | null): Target[] {
  if (!d) return [];
  const hidden = (a = 0) => d.marks.map((m) => ({ k: m.k, x: 960 + jitter(m.k, 1400), y: 540 + jitter(m.k + 3, 700), r: 6, a, color: PAPER }));
  switch (scene) {
    case 'onegame':
      return swarm(d, 0.92);
    case 'selfrating': {
      if (!d.selfRating.ok) return swarm(d, 0.3);
      const x = scoreX(d);
      const y = ratingY(880, 260);
      const r = markRadius(d.marks.length);
      return d.marks.map((m) => clampToSafe({ k: m.k, x: x(m.score), y: m.r1 === null ? 960 : y(m.r1), r, a: m.r1 === null ? 0.2 : 0.92, color: PAPER }));
    }
    case 'cut':
      return hidden(beat === 0 ? 0.12 : 0);
    case 'worlds':
      return beat === 0 ? lanesCluster(d, 0.92) : lanesByScore(d, 0.92);
    case 'movement':
      return d.n.paired < 3 ? hidden(0.1) : movement(d, beat);
    case 'mechanism':
      return hidden(0.06);
    case 'circle':
      return beat === 0 ? swarm(d, 0.92) : swarm(d, beat === 1 ? 0.92 : 0.2, 720, 420, color);
    default:
      return hidden(0);
  }
}
