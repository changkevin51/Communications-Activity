import { clamp, normal, type Rng } from '../../shared/rng';
import { bandFor, inBand, type Band, type Condition, type Thresholds } from './thresholds';

export type PoolMember = { id: string; score: number; kind: 'human' | 'bot' | 'ghost' };
export type GhostSpec = { id: string; score: number };
export type GhostFactory = (score: number) => GhostSpec;
export type Exposure = Map<string, number>;
export type GhostPolicy = 'fill' | 'off';

export type ChosenPeer = { id: string; kind: PoolMember['kind']; score: number; diff: number; slot: number };

export type PeerContext = {
  real: PoolMember[];
  ghosts: PoolMember[];
  exposure: Exposure;
  th: Thresholds;
  rng: Rng;
  makeGhost: GhostFactory;
  policy: GhostPolicy;
  newGhosts: GhostSpec[];
};

export function realInBand(viewerId: string, score: number, cond: Condition, ctx: Pick<PeerContext, 'real' | 'th'>): PoolMember[] {
  const band = bandFor(score, cond, ctx.th);
  return ctx.real.filter((p) => p.id !== viewerId && inBand(p.score, band));
}

export function ghostFeasible(score: number, cond: Condition, th: Thresholds): boolean {
  const b = bandFor(score, cond, th);
  return b.hi - b.lo >= 2 * th.k;
}

export function feasible(viewerId: string, score: number, cond: Condition, ctx: Pick<PeerContext, 'real' | 'th' | 'policy'>): boolean {
  if (realInBand(viewerId, score, cond, ctx).length >= ctx.th.k) return true;
  return ctx.policy === 'fill' && ghostFeasible(score, cond, ctx.th);
}

function targetFor(cond: Condition, th: Thresholds): { target: number; sigma: number } {
  if (cond === 'neutral') return { target: 0, sigma: Math.max(th.neutralWindow / 2, 1) };
  return { target: th.targetGap, sigma: th.sigma };
}

function weightedPick(rng: Rng, items: PoolMember[], weight: (p: PoolMember) => number): PoolMember {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function sampleGhostScore(score: number, cond: Condition, band: Band, taken: Set<number>, ctx: PeerContext): number | null {
  const { target, sigma } = targetFor(cond, ctx.th);
  const sign = cond === 'down' ? -1 : 1;
  for (let i = 0; i < 40; i++) {
    const off = cond === 'neutral' ? normal(ctx.rng) * sigma : sign * (target + normal(ctx.rng) * sigma);
    const s = Math.round(clamp(score + off, band.lo, band.hi));
    if (!taken.has(s) && s !== score) return s;
  }
  for (let s = band.lo; s <= band.hi; s++) if (!taken.has(s) && s !== score) return s;
  return null;
}

export function selectPeers(viewerId: string, score: number, cond: Condition, ctx: PeerContext): { peers: ChosenPeer[]; degraded: boolean } {
  const { th, rng, exposure } = ctx;
  const k = th.k;
  const band = bandFor(score, cond, th);
  const { target, sigma } = targetFor(cond, th);
  let candidates = realInBand(viewerId, score, cond, ctx);
  const chosen: PoolMember[] = [];
  const weight = (p: PoolMember) => {
    const d = Math.abs(p.score - score) - target;
    return Math.exp(-(d * d) / (2 * sigma * sigma)) / (1 + (exposure.get(p.id) ?? 0)) ** 2 + 1e-9;
  };
  while (chosen.length < k && candidates.length) {
    let pool = candidates;
    if (cond === 'neutral' && chosen.length === k - 1 && chosen.length >= 2) {
      const signs = chosen.map((c) => Math.sign(c.score - score));
      if (signs.every((s) => s > 0) || signs.every((s) => s < 0)) {
        const other = candidates.filter((c) => Math.sign(c.score - score) === -signs[0]);
        if (other.length) pool = other;
      }
    }
    const p = weightedPick(rng, pool, weight);
    chosen.push(p);
    candidates = candidates.filter((c) => c.id !== p.id);
  }
  let degraded = false;
  if (chosen.length < k && ctx.policy === 'fill') {
    const taken = new Set(chosen.map((c) => c.score));
    const reusable = ctx.ghosts
      .filter((g) => inBand(g.score, band) && !taken.has(g.score) && g.score !== score)
      .map((g) => ({ g, key: (exposure.get(g.id) ?? 0) + rng() * 0.5 }))
      .sort((a, b) => a.key - b.key);
    for (const { g } of reusable) {
      if (chosen.length >= k) break;
      if (taken.has(g.score)) continue;
      chosen.push(g);
      taken.add(g.score);
    }
    while (chosen.length < k) {
      const s = sampleGhostScore(score, cond, band, taken, ctx);
      if (s === null) break;
      const spec = ctx.makeGhost(s);
      const member: PoolMember = { id: spec.id, score: s, kind: 'ghost' };
      ctx.ghosts.push(member);
      ctx.newGhosts.push(spec);
      chosen.push(member);
      taken.add(s);
    }
  }
  if (chosen.length < k && ctx.policy === 'off') {
    degraded = true;
    const rest = ctx.real
      .filter((p) => p.id !== viewerId && !chosen.some((c) => c.id === p.id))
      .sort((a, b) => Math.abs(a.score - score) - Math.abs(b.score - score));
    for (const p of rest) {
      if (chosen.length >= k) break;
      chosen.push(p);
    }
  }
  for (const c of chosen) exposure.set(c.id, (exposure.get(c.id) ?? 0) + 1);
  const peers = chosen
    .map((c) => ({ id: c.id, kind: c.kind, score: c.score, diff: c.score - score, slot: 0 }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
    .map((p, i) => ({ ...p, slot: i }));
  return { peers, degraded };
}
