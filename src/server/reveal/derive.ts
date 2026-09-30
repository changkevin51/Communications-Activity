import { createHash } from 'node:crypto';
import {
  REVEAL_VERSION, WORLDS,
  type Pattern, type RevealData, type SameScoreDemo, type SameScoreMember, type SnapshotRow, type Source, type Warning, type WorldKey, type WorldStats,
} from '../../shared/reveal';
import { bandFor, computeThresholds, inBand, quantile } from '../assign/thresholds';

const r1d = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean1 = (xs: number[]): number | null => (xs.length >= 2 ? r1d(sum(xs) / xs.length) : xs.length === 1 ? r1d(xs[0]) : null);
const meanN = (xs: number[], min = 2): number | null => (xs.length >= min ? r1d(sum(xs) / xs.length) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return r1d(quantile(s, 0.5));
}

export const MOVE_EPS = 2;

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let t = i; t <= j; t++) r[idx[t][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = sum(ra) / ra.length;
  const mb = sum(rb) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (!(da > 0 && db > 0)) return null;
  return num / Math.sqrt(da * db);
}

export function scoreAxis(scores: number[]): RevealData['scoreAxis'] {
  let lo = 200, hi = 1000;
  if (scores.length) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const pad = Math.max(20, (max - min) * 0.05);
    lo = Math.max(0, Math.floor((min - pad) / 50) * 50);
    hi = Math.min(1000, Math.ceil((max + pad) / 50) * 50);
    if (hi - lo < 200) {
      const mid = (hi + lo) / 2;
      lo = Math.max(0, Math.floor((mid - 100) / 50) * 50);
      hi = Math.min(1000, lo + 200);
      lo = Math.max(0, hi - 200);
    }
  }
  const step = hi - lo > 400 ? 100 : 50;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

function worldStats(rows: SnapshotRow[], w: WorldKey): WorldStats {
  const g = rows.filter((r) => r.world === w);
  const paired = g.filter((r) => r.r1 !== null && r.r2 !== null);
  const deltas = paired.map((r) => (r.r2 as number) - (r.r1 as number));
  const meanScore = meanN(g.map((r) => r.score));
  return {
    n: g.length,
    nPaired: paired.length,
    meanScore: meanScore === null ? null : Math.round(meanScore),
    meanR1: meanN(paired.map((r) => r.r1 as number)),
    meanR2: meanN(paired.map((r) => r.r2 as number)),
    meanDelta: meanN(deltas),
    medianDelta: deltas.length >= 2 ? median(deltas) : null,
    moved: {
      up: deltas.filter((d) => d >= MOVE_EPS).length,
      down: deltas.filter((d) => d <= -MOVE_EPS).length,
      same: deltas.filter((d) => Math.abs(d) < MOVE_EPS).length,
    },
    small: paired.length < 5,
  };
}

export function classify(worlds: Record<WorldKey, WorldStats>, paired: number): Pattern {
  const usable = WORLDS.filter((w) => worlds[w].nPaired >= 3 && worlds[w].meanDelta !== null);
  if (paired < 6 || usable.length < 2) return 'thin';
  const d = (w: WorldKey) => (usable.includes(w) ? worlds[w].meanDelta : null);
  const up = d('up');
  const mid = d('neutral');
  const down = d('down');
  const vals = usable.map((w) => worlds[w].meanDelta as number);
  const range = Math.max(...vals) - Math.min(...vals);
  if (vals.every((v) => Math.abs(v) < 2) && range < 3) return 'flat';
  if (up === null || down === null) return 'mixed';
  const spread = down - up;
  const ordered = up < down && (mid === null || (up < mid && mid < down));
  if (ordered && spread >= 4) return 'expected';
  if (up - down >= 4) return 'reversed';
  if (up < down && (mid === null || (up <= mid && mid <= down))) return 'partial';
  if (up < down && spread >= 4) return 'partial';
  return 'mixed';
}

export const ILLUSTRATION: SameScoreDemo = {
  mode: 'illustration',
  focal: 740,
  generated: 0,
  members: [
    { world: 'up', score: 738, peers: [{ score: 862, real: true }, { score: 891, real: true }, { score: 915, real: true }] },
    { world: 'neutral', score: 742, peers: [{ score: 725, real: true }, { score: 748, real: true }, { score: 760, real: true }] },
    { world: 'down', score: 745, peers: [{ score: 588, real: true }, { score: 611, real: true }, { score: 640, real: true }] },
  ],
};

const tie = (a: string, b: string) => createHash('sha256').update(a).digest('hex') < createHash('sha256').update(b).digest('hex');

function realTriplet(rows: SnapshotRow[], med: number): SameScoreDemo | null {
  const by = new Map<number, SnapshotRow[]>();
  for (const r of rows) if (r.stratum !== null && r.world) by.set(r.stratum, [...(by.get(r.stratum) ?? []), r]);
  type Cand = { members: SnapshotRow[]; range: number; allReal: boolean; dist: number; key: string };
  const cands: Cand[] = [];
  for (const [stratum, ms] of by) {
    if (ms.length !== 3 || new Set(ms.map((m) => m.world)).size !== 3) continue;
    if (ms.some((m) => m.peers.length < 3)) continue;
    const scores = ms.map((m) => m.score);
    const range = Math.max(...scores) - Math.min(...scores);
    if (range > 30) continue;
    cands.push({
      members: ms,
      range,
      allReal: ms.every((m) => m.peers.every((p) => p.real)),
      dist: Math.abs(sum(scores) / 3 - med),
      key: `${stratum}:${ms.map((m) => m.k).join(',')}`,
    });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.range - b.range || Number(b.allReal) - Number(a.allReal) || a.dist - b.dist || (tie(a.key, b.key) ? -1 : 1));
  const best = cands[0];
  const members: SameScoreMember[] = WORLDS.map((w) => {
    const m = best.members.find((x) => x.world === w)!;
    return { world: w, score: m.score, peers: m.peers.map((p) => ({ score: p.score, real: p.real })) };
  });
  const scores = members.map((m) => m.score);
  return {
    mode: 'real',
    focal: Math.round(sum(scores) / 3 / 10) * 10,
    members,
    generated: members.reduce((a, m) => a + m.peers.filter((p) => !p.real).length, 0),
  };
}

function example(rows: SnapshotRow[], med: number): SameScoreDemo | null {
  if (rows.length < 4) return null;
  const focal = Math.round(med / 10) * 10;
  const scores = rows.map((r) => r.score);
  const th = computeThresholds(scores);
  const members: SameScoreMember[] = [];
  for (const w of WORLDS) {
    const band = bandFor(focal, w, th);
    const target = w === 'up' ? focal + th.targetGap : w === 'down' ? focal - th.targetGap : focal;
    const pool = [...new Set(scores.filter((s) => inBand(s, band) && s !== focal))].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    if (pool.length < 3) return null;
    members.push({ world: w, score: focal, peers: pool.slice(0, 3).sort((a, b) => a - b).map((score) => ({ score, real: true })) });
  }
  return { mode: 'example', focal, members, generated: 0 };
}

export function selectSameScore(rows: SnapshotRow[]): SameScoreDemo | null {
  if (!rows.length) return null;
  const med = quantile(rows.map((r) => r.score).sort((a, b) => a - b), 0.5);
  if (rows.length >= 8) {
    const real = realTriplet(rows, med);
    if (real) return real;
  }
  return example(rows, med) ?? ILLUSTRATION;
}

export type DeriveMeta = { source: Source; scenario: string | null; stillFinishing: number };

export function derive(rows: SnapshotRow[], meta: DeriveMeta): RevealData {
  const scores = rows.map((r) => r.score);
  const sorted = scores.slice().sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const s of scores) counts.set(s, (counts.get(s) ?? 0) + 1);
  const ties = [...counts.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);
  const rated = rows.filter((r) => r.r1 !== null);
  const rho = rated.length >= 10 ? spearman(rated.map((r) => r.score), rated.map((r) => r.r1 as number)) : null;
  const worlds = Object.fromEntries(WORLDS.map((w) => [w, worldStats(rows, w)])) as Record<WorldKey, WorldStats>;
  const assigned = rows.filter((r) => r.world !== null);
  const paired = assigned.filter((r) => r.r1 !== null && r.r2 !== null).length;
  const peers = assigned.flatMap((r) => r.peers);
  const samescore = selectSameScore(rows);
  const data: RevealData = {
    version: REVEAL_VERSION,
    source: meta.source,
    scenario: meta.scenario,
    n: { eligible: rows.length, rated1: rated.length, assigned: assigned.length, paired, stillFinishing: meta.stillFinishing },
    scoreAxis: scoreAxis(scores),
    marks: rows.map((r) => ({ k: r.k, score: r.score, r1: r.r1, r2: r.r2, world: r.world })).sort((a, b) => a.k - b.k),
    scores: {
      mean: sorted.length ? Math.round(sum(sorted) / sorted.length) : null,
      median: sorted.length ? Math.round(quantile(sorted, 0.5)) : null,
      min: sorted.length ? sorted[0] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      ties,
    },
    selfRating: {
      ok: rated.length >= 3,
      mean: rated.length >= 2 ? r1d(sum(rated.map((r) => r.r1 as number)) / rated.length) : null,
      corr: rated.length < 3 ? null : rho === null ? 'none' : rho >= 0.4 ? 'clear' : rho >= 0.2 ? 'weak' : 'none',
    },
    worlds,
    samescore,
    mechanism: { peersShown: peers.length, realShown: peers.filter((p) => p.real).length, generatedShown: peers.filter((p) => !p.real).length, perPerson: 3 },
    pattern: classify(worlds, paired),
    warnings: [],
  };
  data.warnings = warningsFor(data);
  return data;
}

const LABEL: Record<WorldKey, string> = { up: 'saw higher', neutral: 'saw similar', down: 'saw lower' };

export function warningsFor(d: RevealData): Warning[] {
  const out: Warning[] = [];
  for (const w of WORLDS) {
    const s = d.worlds[w];
    if (s.n === 0 && d.n.assigned > 0) out.push({ code: 'empty', text: `Nobody landed in "${LABEL[w]}".` });
    else if (s.small && s.n > 0) out.push({ code: 'small', text: `Small group: ${LABEL[w]} (${s.nPaired} paired).` });
    if (s.meanDelta !== null && s.medianDelta !== null && (Math.sign(s.meanDelta) * Math.sign(s.medianDelta) < 0 || Math.abs(s.meanDelta - s.medianDelta) > 5))
      out.push({ code: 'mean-median', text: `One or two big moves are driving the average in "${LABEL[w]}".` });
  }
  const ms = WORLDS.map((w) => d.worlds[w].meanScore).filter((x): x is number => x !== null);
  if (ms.length >= 2 && Math.max(...ms) - Math.min(...ms) > 60) out.push({ code: 'unmatched', text: 'Average scores differ by more than 60 between groups.' });
  if (d.samescore?.mode === 'real' && d.samescore.generated > 0) out.push({ code: 'demo-generated', text: `Same-score demo includes ${d.samescore.generated} generated score(s).` });
  if (d.samescore && d.samescore.mode !== 'real') out.push({ code: 'demo-example', text: `No valid real triplet: same-score uses ${d.samescore.mode} mode.` });
  if (d.n.eligible > 0 && d.n.stillFinishing > 0.2 * d.n.eligible) out.push({ code: 'late', text: `${d.n.stillFinishing} still finishing (> 20%).` });
  if (d.n.eligible === 0) out.push({ code: 'empty-snapshot', text: 'No finished games in this snapshot. RESNAP when people finish.' });
  return out;
}
