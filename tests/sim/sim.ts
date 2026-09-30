import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Player, hostCall, hostClient } from '../helpers/player';
import { rngFrom, normal, clamp } from '../../src/shared/rng';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    key: { type: 'string', default: process.env.ADMIN_KEY ?? 'dev-admin-key' },
    n: { type: 'string', default: '30' },
    late: { type: 'string', default: '0.15' },
    refresh: { type: 'string', default: '0.1' },
    effect: { type: 'boolean', default: false },
    seed: { type: 'string', default: String(Date.now()) },
  },
});
const N = Number(values.n);
const url = values.url!;
const rng = rngFrom(values.seed!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lat: number[] = [];
const errors: string[] = [];

async function timed<T>(p: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await p();
  lat.push(performance.now() - t);
  return r;
}

function pct(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) : 0;
}

async function main() {
  const host = hostClient(url, values.key!);
  await new Promise<void>((res, rej) => (host.once('connect', () => res()), host.once('connect_error', rej)));
  const created = await hostCall<{ session: { id: string; code: string } }>(host, 'create', { label: `sim-${N}`, mode: 'test' });
  if (!created.ok) throw new Error(`create failed: ${created.reason}`);
  const { id, code } = created.session;
  console.log(`session ${code} (${id}) with ${N} bots`);

  let released = false;
  let releaseAt = 0;
  const lastView: number[] = [];
  const players: Player[] = [];

  const run = async (i: number) => {
    const late = rng() < Number(values.late);
    const refresh = rng() < Number(values.refresh);
    const skill = clamp(0.62 + normal(rng) * 0.15, 0.15, 0.98);
    await sleep(rng() * 2000);
    let p = new Player(url, code);
    players.push(p);
    const must = async (label: string, f: () => Promise<{ ok: boolean; reason?: string }>) => {
      const r = await timed(f);
      if (!r.ok) throw new Error(`${label}: ${r.reason}`);
    };
    await must('join', () => p.join());
    await must('start', () => p.start());
    await sleep(late ? 34000 + rng() * 4000 : 26000 + rng() * 6000);
    if (late) while (!released) await sleep(200);
    await must('finish', () => p.finish(skill, rng));
    if (refresh) {
      p.close();
      p = new Player(url, code, p.token);
      players.push(p);
      await must('rejoin', () => p.join());
    }
    const r1 = Math.round(clamp(((p.view!.result!.score - 200) / 800) * 100 + normal(rng) * 10, 0, 100));
    await must('rate1', () => p.rate('before', r1));
    const v = await p.waitFor((x) => x.me.stage === 'assigned', 60000);
    if (released && !late) lastView.push(performance.now());
    if (v.recap!.others.length !== 3) throw new Error('expected 3 others');
    await must('seen', () => p.seen());
    const meanDiff = v.recap!.others.reduce((a, o) => a + o.score, 0) / 3 - p.view!.result!.score;
    const r2 = clamp(r1 + (values.effect ? -meanDiff / 20 : 0) + normal(rng) * 3, 0, 100);
    await must('rate2', () => p.rate('after', Math.round(r2 * 10) / 10));
    if (p.view!.me.stage !== 'done') throw new Error(`bot ${i} not done`);
  };

  const all = Array.from({ length: N }, (_, i) => run(i).catch((e: Error) => errors.push(`bot ${i}: ${e.message}`)));
  const early = N - Math.round(N * Number(values.late));
  const waitStart = Date.now();
  for (;;) {
    const w = await hostCall<{ view: { waiting: number } }>(host, 'watch', { sessionId: id });
    if (w.ok && w.view.waiting >= Math.ceil(early * 0.9)) break;
    if (Date.now() - waitStart > 90000) {
      errors.push('timeout waiting for bots');
      break;
    }
    await sleep(300);
  }
  await sleep(500);
  releaseAt = performance.now();
  const rel = await hostCall<{ released: number }>(host, 'release', { sessionId: id });
  released = true;
  console.log(`released ${rel.ok ? rel.released : rel.reason}`);
  await Promise.all(all);

  const w = await hostCall<{ view: { funnel: Record<string, number>; total: number; internals: { summary: { condition: string; n: number }[]; ghosts: { count: number; exposures: number; realExposures: number } } } }>(host, 'watch', { sessionId: id });
  if (!w.ok) throw new Error('watch failed');
  const v = w.view;
  if (v.total !== N) errors.push(`expected ${N} participants, found ${v.total}`);
  if (v.funnel.done !== N) errors.push(`done ${v.funnel.done}/${N}`);
  const ns = v.internals.summary.map((s) => s.n);
  if (Math.max(...ns) - Math.min(...ns) > 2) errors.push(`imbalance ${ns.join('/')}`);
  const g = v.internals.ghosts;
  console.log(`conditions ${v.internals.summary.map((s) => `${s.condition}=${s.n}`).join(' ')}`);
  console.log(`generated share ${((g.exposures / Math.max(1, g.exposures + g.realExposures)) * 100).toFixed(1)}% (${g.count} generated)`);
  console.log(`ack latency p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms over ${lat.length} acks`);
  if (lastView.length) console.log(`release fan-out ${Math.round(Math.max(...lastView) - releaseAt)}ms`);
  for (const p of players) p.close();
  host.close();
  if (errors.length) {
    console.error(`FAILED with ${errors.length} error(s):\n${errors.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
  console.log('sim ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
