import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io-client';
import { openDb, type Db } from '../../src/server/db/db';
import { createApp } from '../../src/server/app';
import { goodPrompt } from '../../src/server/discussion/assist';
import type { PresenterView } from '../../src/shared/reveal';
import { Player, hostCall, hostClient, openPlay } from '../helpers/player';

const KEY = 'assist-key';
const LEASE = 'lease-assist01';
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

async function session(mode: 'live' | 'test', config: Record<string, unknown> = {}) {
  const res = await hostCall<{ session: { id: string; code: string } }>(host, 'create', { label: 'assist', mode, config: { countdownMs: 0, ...config } });
  expect(res.ok).toBe(true);
  return res.session;
}

function player(code: string) {
  const p = new Player(url, code);
  players.push(p);
  return p;
}

async function command(sessionId: string, view: PresenterView, cmd: Record<string, unknown>) {
  const res = await hostCall<{ view: PresenterView }>(host, 'pres.cmd', { sessionId, leaseId: LEASE, cmd: { ...cmd, rev: view.rev } });
  expect(res.ok).toBe(true);
  return res.view;
}

async function presenter(sessionId: string) {
  const res = await hostCall<{ view: PresenterView }>(host, 'pres.open', { sessionId, leaseId: LEASE });
  expect(res.ok).toBe(true);
  return res.view;
}

async function scoredPlayer(code: string) {
  const p = player(code);
  expect((await p.join()).ok).toBe(true);
  expect((await p.start()).ok).toBe(true);
  expect((await p.finish(0.75)).ok).toBe(true);
  expect((await p.rate('before', 50)).ok).toBe(true);
  return p;
}

async function assignAtStandby(sessionId: string) {
  let view = await presenter(sessionId);
  view = await command(sessionId, view, { t: 'goto', scene: 'hold', beat: 0 });
  return view;
}

async function completeReverseClass(s: { id: string; code: string }, n = 9) {
  await openPlay(host, s.id, LEASE);
  const ps: Player[] = [];
  for (let i = 0; i < n; i++) ps.push(await scoredPlayer(s.code));
  await assignAtStandby(s.id);
  for (const p of ps) {
    await p.waitFor((v) => v.me.stage === 'assigned');
    await p.seen();
    const score = p.view!.result!.score;
    const peers = p.view!.recap!.others.map((x) => x.score);
    const direction = peers.every((x) => x > score) ? 1 : peers.every((x) => x < score) ? -1 : 0;
    await p.rate('after', direction < 0 ? 0 : 100);
  }
  return ps;
}

describe('assisted results', () => {
  it('fast-forwards 25 test bots for the reveal and every Part 3 poll', async () => {
    const s = await session('test');
    const watched = await hostCall<{ view: { session: { config: { assist: boolean } } } }>(host, 'watch', { sessionId: s.id });
    expect(watched.view.session.config.assist).toBe(true);
    await openPlay(host, s.id, LEASE);
    const p = await scoredPlayer(s.code);
    expect((await hostCall(host, 'bots.spawn', { sessionId: s.id, n: 25 })).ok).toBe(true);
    let v = await assignAtStandby(s.id);
    expect(v.phase).toBe('released');
    await p.waitFor((x) => x.me.stage === 'assigned');
    await p.seen();
    const assignment = db.get<{ condition: 'up' | 'neutral' | 'down' }>("SELECT condition FROM assignments WHERE participant_id = (SELECT id FROM participants WHERE session_id = ? AND kind = 'human')", s.id);
    const opposite = assignment?.condition === 'down' ? 0 : 100;
    expect((await p.rate('after', opposite)).ok).toBe(true);
    v = await presenter(s.id);
    v = await command(s.id, v, { t: 'begin', confirm: 'BEGIN' });
    expect(v.health?.pattern).toBe('expected');
    expect(v.health?.n.eligible).toBe(26);
    expect(v.health?.n.stillFinishing).toBe(0);
    expect(['up', 'neutral', 'down'].every((w) => v.health!.worlds[w as 'up' | 'neutral' | 'down'].nPaired >= 4)).toBe(true);
    expect(v.health?.counts.assist).not.toBeNull();
    const screen = JSON.stringify((await import('../../src/server/services/presentation')).screenState(db, s.id, Date.now()));
    expect(screen).not.toContain('assist');

    for (const prompt of ['felt', 'switch', 'landscape', 'mirrors'] as const) {
      if (prompt === 'landscape') v = await command(s.id, v, { t: 'flag', key: 'landscape', on: true });
      v = await command(s.id, v, { t: 'goto', scene: prompt, beat: prompt === 'mirrors' ? 1 : 0 });
      expect(v.question?.phase, `${prompt} at ${v.scene}`).toBe('open');
      expect(v.question?.count).toBe(0);
      v = await command(s.id, v, { t: 'next' });
      const result = v.question!.result!;
      expect(result.small).toBe(false);
      expect(goodPrompt(result)).toBe(true);
    }
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM responses')?.n).toBeGreaterThan(0);
  });

  it('repairs a reversed live reveal, pads a contrary felt poll, and preserves raw exports', async () => {
    const s = await session('live');
    const ps = await completeReverseClass(s);
    let v = await presenter(s.id);
    v = await command(s.id, v, { t: 'begin', confirm: 'BEGIN' });
    expect(v.health?.pattern).toBe('expected');
    expect(v.health?.counts.assist).not.toBeNull();

    v = await command(s.id, v, { t: 'goto', scene: 'felt', beat: 0 });
    const prompt = (await ps[0].waitFor((x) => x.room.prompt?.id === 'felt')).room.prompt!;
    for (const [i, p] of ps.slice(0, 3).entries()) {
      expect((await p.send('answer', { prompt: 'felt', run: prompt.run, rid: `no-${i}0000000`, value: { c: 'no' } })).ok).toBe(true);
    }
    v = await command(s.id, v, { t: 'next' });
    const result = v.question!.result!;
    expect(result.n).toBeGreaterThanOrEqual(8);
    expect(goodPrompt(result)).toBe(true);
    expect(result.counts!.find((x) => x.id === 'yes')!.n! + result.counts!.find((x) => x.id === 'some')!.n! + result.counts!.find((x) => x.id === 'little')!.n!).toBeGreaterThanOrEqual(result.n * 0.6);
    const raw = db.all<{ value_json: string }>("SELECT value_json FROM responses WHERE prompt = 'felt'");
    expect(raw).toHaveLength(3);
    expect(raw.every((x) => JSON.parse(x.value_json).c === 'no')).toBe(true);
    const event = db.get<{ data_json: string }>("SELECT data_json FROM events WHERE type = 'assist' AND session_id = ? ORDER BY id DESC LIMIT 1", s.id);
    expect(JSON.parse(event!.data_json).mode).toBe('padded');
    const exported = await (await fetch(`${url}/api/export/${s.id}`, { headers: { 'x-admin-key': KEY } })).json() as { summary: { rating_delta: number }[] };
    expect(exported.summary.map((x) => x.rating_delta)).toEqual(expect.arrayContaining([50, -50]));
  });

  it('keeps reversed raw results when assist is disabled', async () => {
    const s = await session('live', { assist: false });
    await completeReverseClass(s);
    let v = await presenter(s.id);
    v = await command(s.id, v, { t: 'begin', confirm: 'BEGIN' });
    expect(v.health?.pattern).toBe('reversed');
    expect(v.health?.counts.assist).toBeNull();
    const data = await hostCall<{ data: { pattern: string } }>(host, 'pres.data', { sessionId: s.id });
    expect(data.data.pattern).toBe('reversed');
  });

  it('releases waiting players after close and assigns a late finisher', async () => {
    const s = await session('live');
    await openPlay(host, s.id, LEASE);
    const waiting = await scoredPlayer(s.code);
    const late = player(s.code);
    await late.join();
    await late.start();
    await late.finish(0.6);
    expect((await hostCall(host, 'close', { sessionId: s.id })).ok).toBe(true);
    const v = await assignAtStandby(s.id);
    expect(v.phase).toBe('closed');
    expect(v.released).toBe(true);
    await waiting.waitFor((x) => x.me.stage === 'assigned');
    expect((await late.rate('before', 45)).ok).toBe(true);
    await late.waitFor((x) => x.me.stage === 'assigned');
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assignments WHERE session_id = ?', s.id)?.n).toBe(2);
  });
});
