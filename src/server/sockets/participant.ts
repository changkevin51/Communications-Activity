import type { Namespace, Socket } from 'socket.io';
import type { ZodType } from 'zod';
import type { Db } from '../db/db';
import type { Hub } from '../hub';
import { FinishReq, JoinReq, RateReq, SeenReq, StartReq, type Ack } from '../../shared/protocol';
import { finish, join, rate, seen, start, touch, type CmdResult } from '../services/participant';
import { buildView } from '../views';
import { logEvent } from '../db/repo';
import { tokenBucket } from './rateLimit';

type AckFn = (res: Ack | { serverNow: number }) => void;

export function registerParticipantNs(ns: Namespace, db: Db, hub: Hub) {
  ns.on('connection', (socket: Socket) => {
    const allow = tokenBucket();
    let pid: string | null = null;

    const reply = (ack: AckFn, res: CmdResult) => {
      if (!res.ok) return ack({ ok: false, reason: res.reason });
      const view = buildView(db, res.pid, Date.now());
      if (!view) return ack({ ok: false, reason: 'NOT_JOINED' });
      ack({ ok: true, view });
      if (res.changed) {
        socket.to(`p:${res.pid}`).emit('view', view);
        hub.pushHost(res.sessionId);
      }
    };

    function on<T>(event: string, schema: ZodType<T>, fn: (req: T, now: number) => CmdResult) {
      socket.on(event, (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        const cb = ack as AckFn;
        if (!allow()) return cb({ ok: false, reason: 'RATE_LIMIT' });
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return cb({ ok: false, reason: 'BAD_REQUEST' });
        try {
          reply(cb, fn(parsed.data, Date.now()));
        } catch (e) {
          try {
            logEvent(db, null, pid, 'error', { event, message: e instanceof Error ? e.message : String(e) });
          } catch {
            /* logging must never throw */
          }
          cb({ ok: false, reason: 'ERROR' });
        }
      });
    }

    const needPid = <T>(fn: (id: string, req: T, now: number) => CmdResult) => (req: T, now: number): CmdResult =>
      pid ? fn(pid, req, now) : { ok: false, reason: 'NOT_JOINED' };

    on('join', JoinReq, (req, now) => {
      const res = join(db, req.code, req.token, now);
      if (res.ok && pid !== res.pid) {
        if (pid) {
          socket.leave(`p:${pid}`);
          hub.disconnected(pid);
        }
        pid = res.pid;
        socket.join(`p:${pid}`);
        hub.connected(pid);
        hub.pushHost(res.sessionId);
      }
      return res;
    });
    on('start', StartReq, needPid((id, req, now) => start(db, id, req, now)));
    on('finish', FinishReq, needPid((id, req, now) => finish(db, id, req, now)));
    on('rate', RateReq, needPid((id, req, now) => rate(db, id, req, now)));
    on('seen', SeenReq, needPid((id, req, now) => seen(db, id, req, now)));

    socket.on('clock', (_payload: unknown, ack: unknown) => {
      if (typeof ack === 'function') (ack as AckFn)({ serverNow: Date.now() });
    });

    socket.on('disconnect', () => {
      if (!pid) return;
      hub.disconnected(pid);
      try {
        touch(db, pid, Date.now());
        const s = db.get<{ session_id: string }>('SELECT session_id FROM participants WHERE id = ?', pid);
        if (s) hub.pushHost(s.session_id);
      } catch {
        /* db may be closed during shutdown */
      }
    });
  });
}
