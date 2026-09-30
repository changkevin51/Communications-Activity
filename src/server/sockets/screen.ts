import type { Namespace, Socket } from 'socket.io';
import { timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db';
import type { Hub } from '../hub';
import { getSessionByCode } from '../db/repo';
import { getPresentation, screenState, snapshotData } from '../services/presentation';
import { assertPublic } from '../reveal/public';

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function registerScreenNs(ns: Namespace, db: Db, hub: Hub) {
  ns.use((socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as { code?: unknown; key?: unknown };
    if (typeof auth.code !== 'string' || typeof auth.key !== 'string') return next(new Error('UNAUTHORIZED'));
    const s = getSessionByCode(db, auth.code.toUpperCase());
    const row = s ? getPresentation(db, s.id) : null;
    if (!s || !row || !same(row.screen_key, auth.key)) return next(new Error('UNAUTHORIZED'));
    socket.data.sessionId = s.id;
    next();
  });

  ns.on('connection', (socket: Socket) => {
    const sid = socket.data.sessionId as string;
    socket.join(`s:${sid}`);
    hub.screenConnected(sid, 1);
    const st = screenState(db, sid, Date.now());
    if (st) socket.emit('screen', st);
    socket.on('need', (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const hash = (payload as { hash?: unknown } | null)?.hash;
      const row = getPresentation(db, sid);
      const snap = row ? snapshotData(db, row.snapshot_id) : null;
      if (!snap || snap.snap.hash !== hash) return ack({ ok: false, reason: 'NO_SNAPSHOT' });
      ack({ ok: true, hash: snap.snap.hash, data: assertPublic(snap.data) });
    });
    socket.on('clock', (_p: unknown, ack: unknown) => {
      if (typeof ack === 'function') ack({ ok: true, serverNow: Date.now() });
    });
    socket.on('disconnect', () => hub.screenConnected(sid, -1));
  });
}
