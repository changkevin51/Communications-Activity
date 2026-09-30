import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { openDb, type Db } from '../../src/server/db/db';
import { createApp } from '../../src/server/app';
import { Player, hostCall, hostClient } from '../helpers/player';
import type { PresenterView, ScreenState } from '../../src/shared/reveal';

const KEY = 'test-key';
const LEASE = 'lease-aaaaaaaa';
let db: Db;
let url: string;
let close: () => Promise<void>;
let host: Socket;
const sockets: { close(): unknown }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function until<T>(f: () => T | undefined | false, ms = 3000): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timeout');
    await sleep(10);
  }
}

async function setup() {
  const res = await hostCall<{ session: { id: string; code: string } }>(host, 'create', { label: 't', mode: 'test', config: { countdownMs: 0 } });
  const s = res.session;
  await hostCall(host, 'pres.open', { sessionId: s.id, leaseId: LEASE });
  await hostCall(host, 'bots.spawn', { sessionId: s.id, n: 20 });
  await hostCall(host, 'bots.advance', { sessionId: s.id, to: 'rated_before' });
  await hostCall(host, 'release', { sessionId: s.id });
  await hostCall(host, 'bots.advance', { sessionId: s.id, to: 'done', effect: 'expected' });
  const open = await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId: s.id, leaseId: LEASE });
  const b = await cmd(s.id, { t: 'begin', rev: open.view.rev, confirm: 'BEGIN' });
  expect(b.ok).toBe(true);
  return { ...s, view: b.view };
}

async function cmd(sessionId: string, c: Record<string, unknown>, leaseId = LEASE) {
  return hostCall<{ view: PresenterView; changed: boolean }>(host, 'pres.cmd', { sessionId, leaseId, cmd: c });
}

function screen(code: string, key: string) {
  const s = io(`${url}/s`, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { code, key } });
  sockets.push(s);
  const states: ScreenState[] = [];
  s.on('screen', (st: ScreenState) => states.push(st));
  return { s, last: () => states[states.length - 1] };
}

async function players(code: string, n: number) {
  const ps = [...Array(n)].map(() => new Player(url, code));
  sockets.push(...ps.map((p) => p.socket));
  for (const p of ps) expect((await p.join()).ok).toBe(true);
  return ps;
}

describe('Part 3 question lifecycle', () => {
  it('opens on ask, is idempotent, freezes on advance, never reopens on back, and REOPEN creates a new run', async () => {
    const s = await setup();
    const ps = await players(s.code, 6);
    const scr = screen(s.code, s.view.screenKey);
    let v = (await cmd(s.id, { t: 'goto', rev: s.view.rev, scene: 'switch', beat: 0 })).view;
    expect(v.question?.phase).toBe('open');
    const bots = v.question!.count;
    expect(v.part3At).not.toBeNull();
    const pr = (await ps[0].waitFor((x) => !!x.room.prompt)).room.prompt!;
    expect(pr.id).toBe('switch');
    expect(pr.sliders).toHaveLength(3);

    const req = { prompt: 'switch', run: pr.run, rid: 'rid-00000001', value: { v: [30, 60, 90] } };
    expect((await ps[0].send('answer', req)).ok).toBe(true);
    const again = await ps[0].send('answer', req);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.view.room.prompt?.answered).toBe(true);
    expect((await ps[1].send('answer', { ...req, rid: 'rid-00000002', value: { v: [30, 60] } })).ok).toBe(false);
    expect((await ps[1].send('answer', { ...req, prompt: 'nope', rid: 'rid-00000003' })).ok).toBe(false);
    for (const [i, p] of ps.slice(1).entries()) await p.send('answer', { ...req, rid: `rid-1000000${i}`, value: { v: [20 + i, 50 + i, 80 + i] } });
    await until(() => scr.last()?.q?.count === bots + 6);
    expect(scr.last().q?.result).toBeNull();

    v = (await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId: s.id, leaseId: LEASE })).view;
    expect(v.question?.count).toBe(bots + 6);
    v = (await cmd(s.id, { t: 'next', rev: v.rev })).view;
    expect(v.question?.phase).toBe('frozen');
    const st = await until(() => (scr.last()?.q?.result ? scr.last() : undefined));
    expect(st.q!.result!.n + st.q!.result!.skipped).toBe(bots + 6);
    expect(st.q!.result!.sliders).toHaveLength(3);
    const text = JSON.stringify(st);
    for (const bad of ['rid-', 'participant', 'codename', 'token', 'vectors']) expect(text).not.toContain(bad);
    for (const p of ps) await p.waitFor((x) => !x.room.prompt);

    await sleep(1600);
    const late = await new Player(url, s.code);
    sockets.push(late.socket);
    await late.join();
    expect((await late.send('answer', { ...req, rid: 'rid-late0001' })).ok).toBe(false);

    v = (await cmd(s.id, { t: 'prev', rev: v.rev })).view;
    expect(v.question?.phase).toBe('frozen');
    expect(v.question?.runs).toBe(1);
    v = (await cmd(s.id, { t: 'reopen', rev: v.rev, confirm: 'REOPEN' })).view;
    expect(v.question?.phase).toBe('open');
    expect(v.question?.runs).toBe(2);
    expect(v.question?.count).toBeLessThanOrEqual(20);
    await ps[0].waitFor((x) => x.room.prompt?.run === 2 && !x.room.prompt.answered);
  });

  it('phones can go passive and results can hide', async () => {
    const s = await setup();
    const ps = await players(s.code, 2);
    let v = (await cmd(s.id, { t: 'goto', rev: s.view.rev, scene: 'mirrors', beat: 1 })).view;
    await ps[0].waitFor((x) => x.room.prompt?.id === 'mirrors');
    v = (await cmd(s.id, { t: 'phones', rev: v.rev, mode: 'passive' })).view;
    await ps[0].waitFor((x) => !x.room.prompt && x.room.screen === 'discuss');
    v = (await cmd(s.id, { t: 'phones', rev: v.rev, mode: 'auto' })).view;
    await ps[0].waitFor((x) => !!x.room.prompt);
    await ps[0].send('answer', { prompt: 'mirrors', run: 1, rid: 'rid-aaaaaaaa', value: { v: [20, 80] } });
    v = (await cmd(s.id, { t: 'close', rev: v.rev })).view;
    expect(v.question?.phase).toBe('frozen');
    v = (await cmd(s.id, { t: 'hide', rev: v.rev, on: true })).view;
    expect(v.hide).toBe(true);
    v = (await cmd(s.id, { t: 'next', rev: v.rev })).view;
    expect(v.hide).toBe(false);
    expect((await cmd(s.id, { t: 'resnap', rev: v.rev, confirm: 'RESNAP' })).reason).toBe('PART3_STARTED');
    v = (await cmd(s.id, { t: 'goto', rev: v.rev, scene: 'end', beat: 0 })).view;
    await ps[1].waitFor((x) => x.room.screen === 'end');
  });

  it('optional landscape is off until flagged; concept and key rotation need the lease', async () => {
    const s = await setup();
    expect((await cmd(s.id, { t: 'goto', rev: s.view.rev, scene: 'landscape', beat: 0 })).reason).toBe('GUARD');
    let v = (await cmd(s.id, { t: 'flag', rev: s.view.rev, key: 'landscape', on: true })).view;
    expect(v.flags.landscape).toBe(true);
    v = (await cmd(s.id, { t: 'goto', rev: v.rev, scene: 'landscape', beat: 0 })).view;
    expect(v.question?.prompt).toBe('landscape');
    const h2 = hostClient(url, KEY);
    sockets.push(h2);
    await hostCall(h2, 'pres.open', { sessionId: s.id, leaseId: 'lease-bbbbbbbb' });
    const concept = { title: 'x', quotes: [] };
    expect((await hostCall(h2, 'pres.concept', { sessionId: s.id, leaseId: 'lease-bbbbbbbb', concept })).ok).toBe(false);
    expect((await hostCall(h2, 'pres.rotateKey', { sessionId: s.id, leaseId: 'lease-bbbbbbbb' })).ok).toBe(false);
    const slots = { felt: { text: 'q', source: 's', page: '1' } };
    expect((await hostCall(host, 'pres.concept', { sessionId: s.id, leaseId: LEASE, concept: { ...concept, slots } })).ok).toBe(true);
  });

  it('rehearsal profiles produce synthetic results without phones', async () => {
    const s = await setup();
    const ps = await players(s.code, 1);
    for (const profile of ['expected', 'onesided', 'low'] as const) {
      let v = (await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId: s.id, leaseId: LEASE })).view;
      v = (await cmd(s.id, { t: 'demo', rev: v.rev, scenario: 'expected', n: profile === 'low' ? 12 : 30, seed: 'x', profile })).view;
      v = (await cmd(s.id, { t: 'goto', rev: v.rev, scene: 'felt', beat: 0 })).view;
      expect(v.question?.phase).toBe('open');
      expect(ps[0].view!.room.prompt).toBeUndefined();
      v = (await cmd(s.id, { t: 'next', rev: v.rev })).view;
      const r = v.question!.result!;
      expect(r.source).toBe('demo');
      if (profile === 'low') expect(r.small).toBe(true);
      else expect(r.n).toBeGreaterThan(20);
    }
  });
});
