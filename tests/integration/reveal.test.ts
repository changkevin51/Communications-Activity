import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { openDb, type Db } from '../../src/server/db/db';
import { createApp } from '../../src/server/app';
import { Player, hostCall, hostClient } from '../helpers/player';
import type { PresenterView, RevealData, ScreenState } from '../../src/shared/reveal';
import type { ParticipantView } from '../../src/shared/protocol';

const KEY = 'test-key';
let db: Db;
let url: string;
let close: () => Promise<void>;
let host: Socket;
const sockets: { close(): unknown }[] = [];

beforeEach(async () => {
  db = openDb(':memory:');
  const { app } = await createApp({ db, adminKey: KEY, hostDebounceMs: 10 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  close = async () => {
    await app.close();
    db.close();
  };
  host = hostClient(url, KEY);
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  host.close();
  await close();
});

const LEASE = 'lease-aaaaaaaa';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function session(mode: 'live' | 'test' = 'test') {
  const res = await hostCall<{ session: { id: string; code: string } }>(host, 'create', { label: 't', mode, config: { countdownMs: 0 } });
  const open = await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId: res.session.id, leaseId: LEASE });
  expect(open.ok).toBe(true);
  return { ...res.session, view: open.view };
}

async function cmd(sessionId: string, c: Record<string, unknown>, h = host, leaseId = LEASE) {
  return hostCall<{ view: PresenterView; changed: boolean }>(h, 'pres.cmd', { sessionId, leaseId, cmd: c });
}

async function begin(sessionId: string) {
  const open = await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId, leaseId: LEASE });
  const r = await cmd(sessionId, { t: 'begin', rev: open.view.rev, confirm: 'BEGIN' });
  expect(r.ok).toBe(true);
  return r.view;
}

function screen(code: string, key: string) {
  const s = io(`${url}/s`, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { code, key } });
  sockets.push(s);
  const states: ScreenState[] = [];
  s.on('screen', (st: ScreenState) => states.push(st));
  return { s, states, last: () => states[states.length - 1] };
}

async function until<T>(f: () => T | undefined | false, ms = 3000): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timeout');
    await sleep(10);
  }
}

async function bots(id: string, n = 30, effect = 'expected') {
  await hostCall(host, 'bots.spawn', { sessionId: id, n });
  await hostCall(host, 'bots.advance', { sessionId: id, to: 'rated_before' });
  await hostCall(host, 'release', { sessionId: id });
  await hostCall(host, 'bots.advance', { sessionId: id, to: 'done', effect });
}

describe('projector auth', () => {
  it('rejects a wrong key and accepts the current one; rotation disconnects', async () => {
    const s = await session();
    const bad = screen(s.code, 'nope');
    const err = await new Promise<string>((r) => bad.s.once('connect_error', (e) => r(e.message)));
    expect(err).toBe('UNAUTHORIZED');
    const good = screen(s.code, s.view.screenKey);
    await until(() => good.last());
    expect(good.last().scene).toBe('lobby');
    const rot = await hostCall<{ screenKey: string }>(host, 'pres.rotateKey', { sessionId: s.id });
    expect(rot.screenKey).not.toBe(s.view.screenKey);
    await until(() => !good.s.connected);
  });
});

describe('presenter state machine over the wire', () => {
  it('begin freezes a snapshot; beats propagate; duplicates are STALE', async () => {
    const s = await session();
    await bots(s.id);
    const scr = screen(s.code, s.view.screenKey);
    await until(() => scr.last());
    await until(() => scr.last().scene === 'hold');
    const cur = (await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId: s.id, leaseId: LEASE })).view;
    const b = await cmd(s.id, { t: 'begin', rev: cur.rev, confirm: 'BEGIN' });
    expect(b.ok).toBe(true);
    expect(b.view.scene).toBe('onegame');
    expect(b.view.health?.n.eligible).toBe(30);
    const again = await cmd(s.id, { t: 'begin', rev: cur.rev, confirm: 'BEGIN' });
    expect(again.reason).toBe('STALE');
    const n1 = await cmd(s.id, { t: 'next', rev: b.view.rev });
    const dup = await cmd(s.id, { t: 'next', rev: b.view.rev });
    expect(dup.reason).toBe('STALE');
    await until(() => scr.last().rev === n1.view.rev && scr.last().beat === 1);
    const need = (await scr.s.timeout(3000).emitWithAck('need', { hash: scr.last().dataHash })) as { ok: boolean; data: RevealData };
    expect(need.ok).toBe(true);
    const text = JSON.stringify(need.data);
    for (const bad of ['codename', 'token', 'participant', '"id"', 'sigil', 'stratum']) expect(text).not.toContain(bad);
  });

  it('second console is NOT_CONTROLLER until it takes the lease', async () => {
    const s = await session();
    const v = (await cmd(s.id, { t: 'hold', rev: s.view.rev, on: true })).view;
    const h2 = hostClient(url, KEY);
    sockets.push(h2);
    await hostCall(h2, 'pres.open', { sessionId: s.id, leaseId: 'lease-bbbbbbbb' });
    expect((await cmd(s.id, { t: 'hold', rev: v.rev, on: false }, h2, 'lease-bbbbbbbb')).reason).toBe('NOT_CONTROLLER');
    const t = await cmd(s.id, { t: 'take' }, h2, 'lease-bbbbbbbb');
    expect(t.view.lease.controller).toBe('lease-bbbbbbbb');
    expect((await cmd(s.id, { t: 'hold', rev: t.view.rev, on: false }, h2, 'lease-bbbbbbbb')).ok).toBe(true);
    expect((await cmd(s.id, { t: 'hold', rev: t.view.rev + 1, on: true })).reason).toBe('NOT_CONTROLLER');
  });

  it('projector reconnect restores the settled state', async () => {
    const s = await session();
    await bots(s.id, 12);
    let v = (await cmd(s.id, { t: 'begin', rev: s.view.rev, confirm: 'BEGIN' })).view;
    v = (await cmd(s.id, { t: 'next', rev: v.rev })).view;
    v = (await cmd(s.id, { t: 'next', rev: v.rev })).view;
    const a = screen(s.code, s.view.screenKey);
    const st = await until(() => a.last());
    expect([st.scene, st.beat, st.rev]).toEqual(['onegame', 2, v.rev]);
  });
});

describe('snapshots', () => {
  it('late ratings do not change the frozen data; UPDATE is rejected', async () => {
    const s = await session();
    await hostCall(host, 'bots.spawn', { sessionId: s.id, n: 15 });
    await hostCall(host, 'bots.advance', { sessionId: s.id, to: 'rated_before' });
    await hostCall(host, 'release', { sessionId: s.id });
    const b = await begin(s.id);
    const before = (await hostCall<{ hash: string; data: RevealData }>(host, 'pres.data', { sessionId: s.id }));
    expect(before.data.n.paired).toBe(0);
    await hostCall(host, 'bots.advance', { sessionId: s.id, to: 'done' });
    const after = await hostCall<{ hash: string; data: RevealData }>(host, 'pres.data', { sessionId: s.id });
    expect(after.hash).toBe(before.hash);
    expect(after.data).toEqual(before.data);
    expect(() => db.run("UPDATE reveal_snapshots SET hash = 'x'")).toThrow(/immutable/);
    const r = (await cmd(s.id, { t: 'resnap', rev: b.rev, confirm: 'RESNAP' })).view;
    expect(r.health?.n.paired).toBe(15);
    expect(db.all('SELECT id FROM reveal_snapshots')).toHaveLength(2);
  });

  it('derive agrees with the Part 1 host summary', async () => {
    const s = await session();
    await bots(s.id, 30);
    await begin(s.id);
    const d = (await hostCall<{ data: RevealData }>(host, 'pres.data', { sessionId: s.id })).data;
    const w = await hostCall<{ view: { internals: { summary: { condition: 'up' | 'neutral' | 'down'; n: number; meanDelta: number | null }[] } } }>(host, 'watch', { sessionId: s.id });
    for (const row of w.view.internals.summary) {
      expect(d.worlds[row.condition].n).toBe(row.n);
      if (row.meanDelta !== null) expect(d.worlds[row.condition].meanDelta).toBeCloseTo(row.meanDelta, 0);
    }
  });

  it('demo is rejected on live sessions (command and trigger)', async () => {
    const s = await session('live');
    expect((await cmd(s.id, { t: 'demo', rev: s.view.rev, scenario: 'expected', n: 20, seed: 'x' })).reason).toBe('LIVE_SESSION');
    expect(() =>
      db.run(
        "INSERT INTO reveal_snapshots (id, session_id, source, version, created_at, counts_json, rows_json, data_json, hash) VALUES ('z', ?, 'demo', 'v', 0, '{}', '[]', '{}', 'h')",
        s.id,
      ),
    ).toThrow(/demo data on live session/);
  });

  it('demo on test sessions runs every scenario to the end', async () => {
    const s = await session('test');
    let v = (await cmd(s.id, { t: 'demo', rev: s.view.rev, scenario: 'reversed', n: 40, seed: 'r' })).view;
    expect(v.source).toBe('demo');
    expect(v.health?.pattern).toBe('reversed');
    let steps = 0;
    for (;;) {
      const r = await cmd(s.id, { t: 'next', rev: v.rev });
      if (!r.changed) break;
      v = r.view;
      steps++;
    }
    expect(v.scene).toBe('end');
    expect(steps).toBeGreaterThan(15);
  });
});

describe('phones', () => {
  it('get a neutral look flag after BEGIN that clears on rewind', async () => {
    const s = await session('live');
    const p = new Player(url, s.code);
    sockets.push(p);
    await p.join();
    expect(p.view!.room.screen).toBeUndefined();
    const b = await begin(s.id);
    await p.waitFor((v: ParticipantView) => v.room.screen === 'look');
    const keys = JSON.stringify(p.view);
    for (const bad of ['scene', 'beat', 'snapshot', 'reveal', 'world']) expect(keys).not.toContain(bad);
    await cmd(s.id, { t: 'rewind', rev: b.rev, confirm: 'REWIND' });
    await p.waitFor((v: ParticipantView) => v.room.screen === undefined);
  });

  it('reset clears presentation and snapshots', async () => {
    const s = await session();
    await cmd(s.id, { t: 'demo', rev: s.view.rev, scenario: 'expected', n: 20, seed: 'x' });
    expect((await hostCall(host, 'reset', { sessionId: s.id, confirm: 'RESET' })).ok).toBe(true);
    expect(db.all('SELECT id FROM reveal_snapshots')).toHaveLength(0);
    expect((await hostCall(host, 'delete', { sessionId: s.id, confirm: 'RESET' })).ok).toBe(true);
  });
});
