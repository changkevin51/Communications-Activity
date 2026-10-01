import { randomBytes } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { generateRound } from '../../src/shared/game/generate';
import { ROUND_COUNT, SPECS } from '../../src/shared/game/specs';
import type { RoundSubmission } from '../../src/shared/game/scoring';
import type { Ack, ParticipantView } from '../../src/shared/protocol';

export const newToken = () => randomBytes(32).toString('base64url');

export function playRounds(seed: string, skill: number, rng: () => number = Math.random): RoundSubmission[] {
  const subs: RoundSubmission[] = [];
  for (let idx = 0; idx < ROUND_COUNT; idx++) {
    const r = generateRound(seed, idx, 0);
    const hit = rng() < skill;
    const n = r.grid * r.grid;
    const tapped = hit ? r.target : (r.target + 1 + Math.floor(rng() * (n - 1))) % n;
    subs.push({ idx, variant: 0, tapped, rtMs: Math.round(600 + rng() * 1800 * (1.2 - skill)), studyMs: SPECS[idx].studyMs, maskMs: SPECS[idx].maskMs });
  }
  return subs;
}

export class Player {
  socket: Socket;
  view: ParticipantView | null = null;
  views: ParticipantView[] = [];
  constructor(
    public url: string,
    public code: string,
    public token = newToken(),
  ) {
    this.socket = io(`${url}/p`, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('view', (v: ParticipantView) => this.accept(v));
  }

  private accept(v: ParticipantView) {
    if (!this.view || v.rev >= this.view.rev) this.view = v;
    this.views.push(v);
  }

  async send(event: string, payload: unknown): Promise<Ack> {
    const res = (await this.socket.timeout(10000).emitWithAck(event, payload)) as Ack;
    if (res.ok) this.accept(res.view);
    return res;
  }

  async connected() {
    if (this.socket.connected) return;
    await new Promise<void>((res, rej) => {
      this.socket.once('connect', () => res());
      this.socket.once('connect_error', rej);
    });
  }

  async join() {
    await this.connected();
    return this.send('join', { code: this.code, token: this.token });
  }

  start() {
    return this.send('start', { practice: { tries: 1, correct: 1 } });
  }

  finish(skill: number, rng?: () => number) {
    return this.send('finish', { rounds: playRounds(this.view!.game!.seed, skill, rng), interruptions: 0 });
  }

  rate(phase: 'before' | 'after', value: number) {
    return this.send('rate', { phase, value, responseMs: 3000, adjustments: 2 });
  }

  seen() {
    return this.send('seen', { dialDwellMs: 4000 });
  }

  waitFor(pred: (v: ParticipantView) => boolean, ms = 10000): Promise<ParticipantView> {
    if (this.view && pred(this.view)) return Promise.resolve(this.view);
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.socket.off('view', h);
        rej(new Error(`timeout waiting; stage=${this.view?.me.stage}`));
      }, ms);
      const h = (v: ParticipantView) => {
        if (pred(v)) {
          clearTimeout(t);
          this.socket.off('view', h);
          res(v);
        }
      };
      this.socket.on('view', h);
    });
  }

  close() {
    this.socket.close();
  }
}

export function hostClient(url: string, key: string): Socket {
  return io(`${url}/h`, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { key } });
}

export async function hostCall<T = Record<string, unknown>>(h: Socket, event: string, payload: unknown = {}): Promise<T & { ok: boolean; reason?: string }> {
  return (await h.timeout(10000).emitWithAck(event, payload)) as T & { ok: boolean; reason?: string };
}

/** Presenter Next off the lobby, which is what opens scored play on phones. */
export async function openPlay(h: Socket, sessionId: string, leaseId = 'lease-open-play01') {
  const opened = await hostCall<{ view: { rev: number; scene: string } }>(h, 'pres.open', { sessionId, leaseId });
  if (!opened.ok || opened.view.scene !== 'lobby') return opened;
  return hostCall<{ view: { rev: number; scene: string } }>(h, 'pres.cmd', {
    sessionId,
    leaseId,
    cmd: { t: 'next', rev: opened.view.rev },
  });
}
