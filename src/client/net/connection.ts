import { io, type Socket } from 'socket.io-client';
import type { Ack, ClockAck, ParticipantView } from '../../shared/protocol';
import { bestOffset, clockSample, type ClockSample } from '../../shared/time';
import { tokenFor } from '../storage';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'no_room' | 'closed';
export type ConnState = { status: NetStatus; view: ParticipantView | null; offset: number };

type Pending = { event: string; payload: unknown; tries: number; resolve: (a: Ack) => void };

const MAX_TRIES = 5;

export class Connection {
  private socket: Socket;
  private state: ConnState = { status: 'connecting', view: null, offset: 0 };
  private listeners = new Set<() => void>();
  private outbox: Pending[] = [];
  private flushing = false;
  private token: string;

  constructor(public code: string) {
    this.token = tokenFor(code);
    this.socket = io('/p', { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    this.socket.on('connect', () => void this.onConnect());
    this.socket.on('disconnect', () => this.set({ status: this.state.view ? 'offline' : 'connecting' }));
    this.socket.on('view', (v: ParticipantView) => this.accept(v));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  serverNow() {
    return Date.now() + this.state.offset;
  }

  private set(p: Partial<ConnState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private accept(v: ParticipantView) {
    const cur = this.state.view;
    if (cur && v.rev < cur.rev) return;
    const offset = this.state.offset || v.serverNow - Date.now();
    this.set({ view: v, offset });
  }

  private async onConnect() {
    try {
      const res = (await this.socket.timeout(5000).emitWithAck('join', { code: this.code, token: this.token })) as Ack;
      if (!res.ok) {
        if (res.reason === 'NO_ROOM' || res.reason === 'BAD_REQUEST') return this.set({ status: 'no_room' });
        if (res.reason === 'CLOSED') return this.set({ status: 'closed' });
        return;
      }
      this.accept(res.view);
      this.set({ status: 'online' });
      void this.syncClock();
      void this.flush();
    } catch {
      /* retried on next connect */
    }
  }

  private async syncClock() {
    const samples: ClockSample[] = [];
    for (let i = 0; i < 3; i++) {
      const sent = Date.now();
      try {
        const r = (await this.socket.timeout(3000).emitWithAck('clock', {})) as ClockAck;
        samples.push(clockSample(sent, Date.now(), r.serverNow));
      } catch {
        break;
      }
    }
    if (samples.length) this.set({ offset: bestOffset(samples) });
  }

  send(event: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve) => {
      this.outbox.push({ event, payload, tries: 0, resolve });
      void this.flush();
    });
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length && this.socket.connected && this.state.status === 'online') {
        const item = this.outbox[0];
        try {
          const res = (await this.socket.timeout(5000).emitWithAck(item.event, item.payload)) as Ack;
          if (!res.ok && res.reason === 'RATE_LIMIT' && item.tries < MAX_TRIES) throw new Error('retry');
          this.outbox.shift();
          if (res.ok) this.accept(res.view);
          item.resolve(res);
        } catch {
          item.tries++;
          if (item.tries >= MAX_TRIES) {
            this.outbox.shift();
            item.resolve({ ok: false, reason: 'ERROR' });
          } else {
            await new Promise((r) => setTimeout(r, 400 * 2 ** item.tries));
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
