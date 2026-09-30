import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import type { Db } from '../db/db';
import type { Hub } from '../hub';
import { keyMatches } from '../auth';
import { SessionConfigSchema } from '../config';
import { getSession } from '../db/repo';
import { release } from '../services/assignment';
import { BotError, advanceBots, removeBots, spawnBots } from '../services/bots';
import {
  closeSession,
  createSession,
  deleteSession,
  hostView,
  listSessions,
  removeParticipant,
  reopenSession,
  resetSession,
} from '../services/host';
import { tokenBucket } from './rateLimit';
import { registerPresenter } from './presenter';

type HostAck = (res: { ok: true; [k: string]: unknown } | { ok: false; reason: string }) => void;

const Sid = z.object({ sessionId: z.string().min(1) });
const Create = z.object({
  label: z.string().max(80).default(''),
  mode: z.enum(['live', 'test']),
  config: SessionConfigSchema.partial().optional(),
});
const Reset = Sid.extend({ confirm: z.literal('RESET') });
const Remove = z.object({ participantId: z.string().min(1) });
const Spawn = Sid.extend({
  n: z.number().int().min(1).max(200),
  mean: z.number().min(200).max(1000).default(660),
  sd: z.number().min(0).max(300).default(120),
});
const Advance = Sid.extend({ to: z.enum(['rated_before', 'done']), effect: z.enum(['expected', 'none', 'reversed']).default('expected') });

export function registerHostNs(ns: Namespace, db: Db, hub: Hub, adminKey: string) {
  ns.use((socket, next) => {
    const key = (socket.handshake.auth as { key?: unknown } | undefined)?.key;
    if (keyMatches(key, adminKey)) next();
    else next(new Error('UNAUTHORIZED'));
  });

  ns.on('connection', (socket: Socket) => {
    const allow = tokenBucket(20, 80);
    const participantIds = (sessionId: string) =>
      db.all<{ id: string }>("SELECT id FROM participants WHERE session_id = ? AND kind = 'human'", sessionId).map((r) => r.id);
    const view = (sessionId: string) => hostView(db, sessionId, hub.connectedSet());

    function on<T>(event: string, schema: z.ZodType<T>, fn: (req: T, now: number) => Record<string, unknown>) {
      socket.on(event, (payload: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        const cb = ack as HostAck;
        if (!allow()) return cb({ ok: false, reason: 'RATE_LIMIT' });
        const parsed = schema.safeParse(payload ?? {});
        if (!parsed.success) return cb({ ok: false, reason: 'BAD_REQUEST' });
        try {
          cb({ ok: true, ...fn(parsed.data, Date.now()) });
        } catch (e) {
          const known = e instanceof BotError || (e instanceof Error && /^[A-Z0-9_]+$/.test(e.message));
          cb({ ok: false, reason: known ? (e as Error).message : 'ERROR' });
        }
      });
    }

    registerPresenter(socket, on, db, hub);
    on('sessions', z.object({}), () => ({ sessions: listSessions(db) }));
    on('create', Create, (req, now) => {
      const s = createSession(db, req.label, req.mode, req.config, now);
      return { session: { id: s.id, code: s.code } };
    });
    on('watch', Sid, (req) => {
      for (const room of socket.rooms) if (room.startsWith('h:')) socket.leave(room);
      socket.join(`h:${req.sessionId}`);
      return { view: view(req.sessionId) };
    });
    on('release', Sid, (req, now) => {
      const pids = db.tx(() => {
        const s = getSession(db, req.sessionId);
        return s ? release(db, s, now) : [];
      });
      hub.pushViews(pids);
      hub.pushHost(req.sessionId);
      return { released: pids.length, view: view(req.sessionId) };
    });
    on('close', Sid, (req, now) => {
      closeSession(db, req.sessionId, now);
      hub.pushViews(participantIds(req.sessionId));
      hub.pushHost(req.sessionId);
      return {};
    });
    on('reopen', Sid, (req) => {
      reopenSession(db, req.sessionId);
      hub.pushViews(participantIds(req.sessionId));
      hub.pushHost(req.sessionId);
      return {};
    });
    on('reset', Reset, (req) => {
      resetSession(db, req.sessionId);
      hub.pushHost(req.sessionId);
      return {};
    });
    on('delete', Reset, (req) => {
      deleteSession(db, req.sessionId);
      hub.screenNs?.in(`s:${req.sessionId}`).disconnectSockets(true);
      return {};
    });
    on('remove', Remove, (req, now) => {
      const sid = removeParticipant(db, req.participantId, now);
      if (sid) {
        hub.pushViews([req.participantId]);
        hub.pushHost(sid);
      }
      return {};
    });
    on('bots.spawn', Spawn, (req, now) => {
      const ids = spawnBots(db, req.sessionId, req.n, req.mean, req.sd, now);
      hub.pushHost(req.sessionId);
      return { spawned: ids.length };
    });
    on('bots.advance', Advance, (req, now) => {
      const ids = advanceBots(db, req.sessionId, req.to, now, req.effect);
      hub.pushHost(req.sessionId);
      return { advanced: ids.length };
    });
    on('bots.remove', Sid, (req) => {
      removeBots(db, req.sessionId);
      hub.pushHost(req.sessionId);
      return {};
    });
  });
}
