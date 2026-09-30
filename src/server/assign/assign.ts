import { shuffle, type Rng } from '../../shared/rng';
import { feasible, selectPeers, type ChosenPeer, type Exposure, type GhostFactory, type GhostPolicy, type GhostSpec, type PoolMember } from './peers';
import { CONDITIONS, quantile, type Condition, type Thresholds } from './thresholds';

export type Viewer = { id: string; score: number };

export type AssignmentResult = {
  viewerId: string;
  condition: Condition;
  stratum: number | null;
  viewerScore: number;
  peers: ChosenPeer[];
  degraded: boolean;
};

export type AssignInput = {
  real: PoolMember[];
  ghosts: PoolMember[];
  exposure: Exposure;
  th: Thresholds;
  rng: Rng;
  makeGhost: GhostFactory;
  policy: GhostPolicy;
};

export type AssignOutput = { assignments: AssignmentResult[]; newGhosts: GhostSpec[] };

type Counts = Record<Condition, number>;

const emptyCounts = (): Counts => ({ up: 0, neutral: 0, down: 0 });

function imbalance(c: Counts): number {
  const v = CONDITIONS.map((k) => c[k]);
  return Math.max(...v) - Math.min(...v);
}

function feasibleSet(v: Viewer, input: AssignInput): Condition[] {
  return CONDITIONS.filter((c) => feasible(v.id, v.score, c, input));
}

const PERMS: Condition[][] = [
  ['up', 'neutral', 'down'],
  ['up', 'down', 'neutral'],
  ['neutral', 'up', 'down'],
  ['neutral', 'down', 'up'],
  ['down', 'up', 'neutral'],
  ['down', 'neutral', 'up'],
];

function product(sets: Condition[][]): Condition[][] {
  return sets.reduce<Condition[][]>((acc, s) => acc.flatMap((a) => s.map((c) => [...a, c])), [[]]);
}

function leastRepresented(options: Condition[], counts: Counts, rng: Rng): Condition {
  const min = Math.min(...options.map((c) => counts[c]));
  const best = options.filter((c) => counts[c] === min);
  return best[Math.floor(rng() * best.length)];
}

function withPeers(
  decided: { viewer: Viewer; condition: Condition; stratum: number | null }[],
  input: AssignInput,
): AssignOutput {
  const ctx = { ...input, newGhosts: [] as GhostSpec[] };
  const order = shuffle(input.rng, decided);
  const assignments = order.map(({ viewer, condition, stratum }) => {
    const { peers, degraded } = selectPeers(viewer.id, viewer.score, condition, ctx);
    return { viewerId: viewer.id, condition, stratum, viewerScore: viewer.score, peers, degraded };
  });
  return { assignments, newGhosts: ctx.newGhosts };
}

export function assignBatch(viewers: Viewer[], input: AssignInput): AssignOutput {
  const { rng } = input;
  const keyed = viewers.map((v) => ({ v, key: rng() }));
  keyed.sort((a, b) => a.v.score - b.v.score || a.key - b.key);
  const sorted = keyed.map((x) => x.v);
  const strata: Viewer[][] = [];
  for (let i = 0; i < sorted.length; i += 3) strata.push(sorted.slice(i, i + 3));

  const counts = emptyCounts();
  const decided: { viewer: Viewer; condition: Condition; stratum: number | null }[] = [];
  const full = strata
    .map((members, idx) => ({ members, idx }))
    .filter((s) => s.members.length === 3)
    .map((s) => {
      const sets = s.members.map((m) => {
        const f = feasibleSet(m, input);
        return f.length ? f : (['neutral'] as Condition[]);
      });
      let options = PERMS.filter((p) => p.every((c, i) => sets[i].includes(c)));
      if (!options.length) options = product(sets);
      return { ...s, options, tie: rng() };
    })
    .sort((a, b) => a.options.length - b.options.length || a.tie - b.tie);

  for (const s of full) {
    const scored = s.options.map((opt) => {
      const c = { ...counts };
      for (const x of opt) c[x]++;
      return { opt, imb: imbalance(c) };
    });
    const min = Math.min(...scored.map((x) => x.imb));
    const best = scored.filter((x) => x.imb === min);
    const chosen = best[Math.floor(rng() * best.length)].opt;
    chosen.forEach((cond, i) => {
      counts[cond]++;
      decided.push({ viewer: s.members[i], condition: cond, stratum: s.idx });
    });
  }

  strata.forEach((members, idx) => {
    if (members.length === 3) return;
    for (const m of members) {
      const f = feasibleSet(m, input);
      const cond = leastRepresented(f.length ? f : ['neutral'], counts, rng);
      counts[cond]++;
      decided.push({ viewer: m, condition: cond, stratum: idx });
    }
  });

  return withPeers(decided, input);
}

export type PriorAssignment = { condition: Condition; viewerScore: number };

export function tercileOf(score: number, poolScores: number[]): number {
  const s = poolScores.slice().sort((a, b) => a - b);
  if (s.length < 3) return 1;
  if (score < quantile(s, 1 / 3)) return 0;
  if (score < quantile(s, 2 / 3)) return 1;
  return 2;
}

export function assignOne(viewer: Viewer, prior: PriorAssignment[], input: AssignInput): AssignOutput {
  const poolScores = input.real.map((p) => p.score);
  const t = tercileOf(viewer.score, poolScores);
  const local = emptyCounts();
  const global = emptyCounts();
  for (const a of prior) {
    global[a.condition]++;
    if (tercileOf(a.viewerScore, poolScores) === t) local[a.condition]++;
  }
  const f = feasibleSet(viewer, input);
  const options = f.length ? f : (['neutral'] as Condition[]);
  const minLocal = Math.min(...options.map((c) => local[c]));
  const byLocal = options.filter((c) => local[c] === minLocal);
  const condition = leastRepresented(byLocal, global, input.rng);
  return withPeers([{ viewer, condition, stratum: null }], input);
}
