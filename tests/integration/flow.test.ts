import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io-client';
import { openDb, type Db } from '../../src/server/db/db';
import { createApp } from '../../src/server/app';
import { Player, hostCall, hostClient, openPlay } from '../helpers/player';

const KEY = 'test-key';
const FORBIDDEN = ['condition', 'ghost', 'stratum', 'threshold', 'band', 'batch', 'kind', 'peer_kind', 'diff', 'bot'];

let db: Db;
let url: string;
let close: () => Promise<void>;
let host: Socket;
const players: Player[] = [];

beforeEach(async () => {
  db = openDb(':memory:');
  const { app } = await createApp({ db, adminKey: KEY, hostDebounceMs: 10, botTickMs: 0 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = async () => {
    await app.close();
    db.close();
  };
  host = hostClient(url, KEY);
});

afterEach(async () => {
  for (const p of players.splice(0)) p.close();
  host.close();
  await close();
});

async function newSession(mode: 'live' | 'test' = 'live', config: Record<string, unknown> = {}) {
  const res = await hostCall<{ session: { id: string; code: string } }>(host, 'create', { label: 't', mode, config: { countdownMs: 0, ...config } });
  expect(res.ok).toBe(true);
  return res.session;
}

function player(code: string, token?: string) {
  const p = new Player(url, code, token);
  players.push(p);
  return p;
}

function scanKeys(v: unknown, out: string[] = []): string[] {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), scanKeys(x, out));
  return out;
}

describe('participant flow', () => {
  it('rejects bad host key', async () => {
    const bad = hostClient(url, 'nope');
    await expect(new Promise((res, rej) => (bad.once('connect', () => res(null)), bad.once('connect_error', rej)))).rejects.toThrow('UNAUTHORIZED');
    bad.close();
  });

  it('rejects unknown room and bad payloads', async () => {
    const p = player('ZZZZ');
    expect(await p.join()).toEqual({ ok: false, reason: 'NO_ROOM' });
    expect(await p.send('join', { code: 'ab', token: 'x' })).toEqual({ ok: false, reason: 'BAD_REQUEST' });
    expect(await p.start()).toEqual({ ok: false, reason: 'NOT_JOINED' });
  });

  it('releases waiting phones when the presenter moves to stand-by', async () => {
    const s = await newSession();
    const lease = 'lease-open-play01';
    expect((await openPlay(host, s.id, lease)).ok).toBe(true);
    const cur = await hostCall<{ view: { rev: number; scene: string } }>(host, 'pres.open', { sessionId: s.id, leaseId: lease });
    expect(cur.view.scene).toBe('playing');
    const p = player(s.code);
    await p.join();
    await p.start();
    await p.finish(0.8);
    await p.rate('before', 40);
    expect(p.view!.me.stage).toBe('rated_before');
    const held = await hostCall<{ view: { rev: number; scene: string; phase: string } }>(host, 'pres.cmd', {
      sessionId: s.id,
      leaseId: lease,
      cmd: { t: 'next', rev: cur.view.rev },
    });
    expect(held.ok).toBe(true);
    expect(held.view.scene).toBe('hold');
    expect(held.view.phase).toBe('released');
    const v = await p.waitFor((x) => x.me.stage === 'assigned');
    expect(v.recap!.others).toHaveLength(3);
  });

  it('stays joined until the host presses next', async () => {
    const s = await newSession();
    const p = player(s.code);
    const j = await p.join();
    expect(j.ok && j.view.room.play).toBe(false);
    expect(await p.start()).toEqual({ ok: false, reason: 'WAIT' });
    expect(p.view!.me.stage).toBe('joined');
    expect((await openPlay(host, s.id)).ok).toBe(true);
    const v = await p.waitFor((x) => x.room.play);
    expect(v.me.stage).toBe('joined');
    const st = await p.start();
    expect(st.ok && st.view.me.stage).toBe('playing');
  });

  it('full release flow with idempotency, reconnect, and no leaks', async () => {
    const s = await newSession();
    expect((await openPlay(host, s.id)).ok).toBe(true);
    const ps = Array.from({ length: 9 }, () => player(s.code));
    for (const [i, p] of ps.entries()) {
      const j = await p.join();
      expect(j.ok).toBe(true);
      await p.start();
      await p.start();
      const f = await p.finish(0.3 + i * 0.07);
      expect(f.ok && f.view.result?.score).toBeGreaterThanOrEqual(200);
      const again = await p.finish(1);
      expect(again.ok && again.view.result?.score).toBe(f.ok && f.view.result?.score);
      await p.rate('before', 50);
    }
    const early = await ps[0].rate('after', 60);
    expect(early).toEqual({ ok: false, reason: 'WRONG_STAGE' });

    const rel = await hostCall<{ released: number }>(host, 'release', { sessionId: s.id });
    expect(rel.released).toBe(9);
    for (const p of ps) {
      const v = await p.waitFor((x) => x.me.stage === 'assigned');
      expect(v.recap!.others).toHaveLength(3);
      const names = new Set(v.recap!.others.map((o) => o.codename));
      expect(names.has(v.me.codename)).toBe(false);
    }
    const reconnect = player(s.code, ps[0].token);
    const rj = await reconnect.join();
    expect(rj.ok && rj.view.me.stage).toBe('assigned');
    expect(rj.ok && rj.view.me.codename).toBe(ps[0].view!.me.codename);

    for (const p of ps) {
      expect((await p.seen()).ok).toBe(true);
      const d = await p.rate('after', 55);
      expect(d.ok && d.view.me.stage).toBe('done');
      expect((await p.rate('after', 99)).ok).toBe(true);
    }
    for (const p of [...ps, reconnect]) {
      for (const v of p.views) {
        const keys = scanKeys(v);
        for (const f of FORBIDDEN) expect(keys).not.toContain(f);
        expect(JSON.stringify(v)).not.toMatch(/"(up|down|neutral)"/);
      }
    }
    const res = await fetch(`${url}/api/export/${s.id}?format=csv`, { headers: { 'x-admin-key': KEY } });
    const csv = await res.text();
    expect(csv.trim().split('\n')).toHaveLength(10);
    expect((await fetch(`${url}/api/export/${s.id}`)).status).toBe(401);
    const json = (await (await fetch(`${url}/api/export/${s.id}`, { headers: { 'x-admin-key': KEY } })).json()) as {
      summary: { condition: string; rating_delta: number }[];
      session: Record<string, unknown>;
    };
    expect(json.summary.every((r) => r.condition && r.rating_delta === 5)).toBe(true);
    expect(json.session.seed).toBeUndefined();
    const counts = json.summary.reduce<Record<string, number>>((m, r) => ((m[r.condition] = (m[r.condition] ?? 0) + 1), m), {});
    expect(Object.values(counts).every((c) => c === 3)).toBe(true);
  });

  it('late finisher is assigned instantly after release, and closed room rejects new joins', async () => {
    const s = await newSession();
    expect((await openPlay(host, s.id)).ok).toBe(true);
    const a = player(s.code);
    await a.join();
    await a.start();
    await a.finish(0.8);
    await a.rate('before', 40);
    await hostCall(host, 'release', { sessionId: s.id });
    await a.waitFor((v) => v.me.stage === 'assigned');
    const late = player(s.code);
    await late.join();
    await late.start();
    await late.finish(0.5);
    const r = await late.rate('before', 40);
    expect(r.ok && r.view.me.stage).toBe('assigned');
    expect(r.ok && r.view.recap?.others).toHaveLength(3);
    await hostCall(host, 'close', { sessionId: s.id });
    expect(await player(s.code).join()).toEqual({ ok: false, reason: 'CLOSED' });
    const back = await player(s.code, a.token).join();
    expect(back.ok).toBe(true);
  });

  it('bots are test-only and host view updates', async () => {
    const live = await newSession('live');
    expect((await hostCall(host, 'bots.spawn', { sessionId: live.id, n: 5 })).reason).toBe('LIVE_SESSION');
    const t = await newSession('test');
    const views: unknown[] = [];
    host.on('hostView', (v) => views.push(v));
    await hostCall(host, 'watch', { sessionId: t.id });
    expect((await hostCall(host, 'bots.spawn', { sessionId: t.id, n: 30 })).ok).toBe(true);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM participants WHERE session_id = ? AND kind = 'bot' AND stage = 'joined'", t.id)?.n).toBe(30);
    await hostCall(host, 'bots.advance', { sessionId: t.id, to: 'rated_before' });
    const rel = await hostCall<{ released: number }>(host, 'release', { sessionId: t.id });
    expect(rel.released).toBe(30);
    await hostCall(host, 'bots.advance', { sessionId: t.id, to: 'done' });
    const w = await hostCall<{ view: { funnel: Record<string, number>; internals: { summary: { n: number }[] } } }>(host, 'watch', { sessionId: t.id });
    expect(w.view.funnel.done).toBe(30);
    expect(w.view.internals.summary.map((x) => x.n)).toEqual([10, 10, 10]);
    await new Promise((r) => setTimeout(r, 50));
    expect(views.length).toBeGreaterThan(0);
  });

  it('removed participant sees removed stage', async () => {
    const s = await newSession();
    const p = player(s.code);
    await p.join();
    const w = await hostCall<{ view: { internals: { participants: { id: string }[] } } }>(host, 'watch', { sessionId: s.id });
    await hostCall(host, 'remove', { participantId: w.view.internals.participants[0].id });
    await p.waitFor((v) => v.me.stage === 'removed');
  });

  it('healthz', async () => {
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ ok: true });
  });
});
