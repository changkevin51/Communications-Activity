import type { Socket } from 'socket.io';
import { z } from 'zod';
import type { Db } from '../db/db';
import type { Hub } from '../hub';
import { SCENES } from '../../shared/reveal';
import { SCENARIOS } from '../reveal/demo';
import { PROFILES } from '../../shared/discussion';
import { command, ensurePresentation, getPresentation, rotateScreenKey, setConcept, snapshotData, type Cmd } from '../services/presentation';

function mustControl(db: Db, sessionId: string, leaseId: string) {
  const row = getPresentation(db, sessionId);
  if (row?.controller && row.controller !== leaseId) throw new Error('NOT_CONTROLLER');
}

type On = <T>(event: string, schema: z.ZodType<T>, fn: (req: T, now: number) => Record<string, unknown>) => void;

const Rev = z.number().int();
const SceneEnum = z.enum(SCENES.map((s) => s.id) as [string, ...string[]]);
export const CmdSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('next'), rev: Rev, scene: z.boolean().optional() }),
  z.object({ t: z.literal('prev'), rev: Rev, scene: z.boolean().optional() }),
  z.object({ t: z.literal('goto'), rev: Rev, scene: SceneEnum, beat: z.number().int().min(0).max(20).optional() }),
  z.object({ t: z.literal('begin'), rev: Rev, confirm: z.literal('BEGIN') }),
  z.object({ t: z.literal('hold'), rev: Rev, on: z.boolean() }),
  z.object({ t: z.literal('plain'), rev: Rev, on: z.boolean() }),
  z.object({ t: z.literal('motion'), rev: Rev, motion: z.enum(['full', 'calm', 'off']) }),
  z.object({ t: z.literal('auto'), rev: Rev, on: z.boolean() }),
  z.object({ t: z.literal('replay'), rev: Rev }),
  z.object({ t: z.literal('resnap'), rev: Rev, confirm: z.literal('RESNAP') }),
  z.object({ t: z.literal('rewind'), rev: Rev, confirm: z.literal('REWIND') }),
  z.object({ t: z.literal('demo'), rev: Rev, scenario: z.enum(SCENARIOS), n: z.number().int().min(1).max(200), seed: z.string().min(1).max(40), profile: z.enum(PROFILES).optional() }),
  z.object({ t: z.literal('close'), rev: Rev }),
  z.object({ t: z.literal('reopen'), rev: Rev, confirm: z.literal('REOPEN') }),
  z.object({ t: z.literal('hide'), rev: Rev, on: z.boolean() }),
  z.object({ t: z.literal('phones'), rev: Rev, mode: z.enum(['auto', 'passive']) }),
  z.object({ t: z.literal('focus'), rev: Rev, i: z.number().int().min(0).max(9).nullable() }),
  z.object({ t: z.literal('flag'), rev: Rev, key: z.literal('landscape'), on: z.boolean() }),
  z.object({ t: z.literal('take') }),
]);

const Sid = z.object({ sessionId: z.string().min(1) });
const Open = Sid.extend({ leaseId: z.string().min(8).max(64) });
const CmdReq = Open.extend({ cmd: CmdSchema });
const Quote = z.object({ text: z.string().max(400), source: z.string().max(120), page: z.string().max(20) });
const Concept = Open.extend({
  concept: z.object({
    title: z.string().max(80),
    quotes: z.array(Quote).max(3),
    slots: z.partialRecord(z.enum(['felt', 'switch', 'mirrors', 'chooser']), Quote).optional(),
  }),
});

export function registerPresenter(socket: Socket, on: On, db: Db, hub: Hub) {
  const held = new Set<string>();
  socket.on('disconnect', () => {
    for (const k of held) {
      const [sid, lease] = k.split('|');
      hub.leaseDropped(sid, lease);
    }
  });
  const hold = (sid: string, lease: string) => {
    const k = `${sid}|${lease}`;
    if (held.has(k)) return;
    held.add(k);
    hub.leaseHeld(sid, lease);
  };

  on('pres.open', Open, (req, now) => {
    if (!ensurePresentation(db, req.sessionId, now)) throw new Error('NO_SESSION');
    for (const room of socket.rooms) if (room.startsWith('h:')) socket.leave(room);
    socket.join(`h:${req.sessionId}`);
    hold(req.sessionId, req.leaseId);
    return { view: hub.presenter(req.sessionId) };
  });
  on('pres.cmd', CmdReq, (req, now) => {
    hold(req.sessionId, req.leaseId);
    const res = command(db, req.sessionId, req.leaseId, req.cmd as Cmd, now);
    if (res.ok && res.changed) hub.pushPresentation(req.sessionId);
    if (res.ok && res.lookChanged) hub.pushSessionViews(req.sessionId);
    else if (res.ok && res.changed) hub.pushHost(req.sessionId);
    if (!res.ok) throw new Error(res.reason);
    return { changed: res.changed, view: hub.presenter(req.sessionId) };
  });
  on('pres.data', Sid, (req) => {
    const row = getPresentation(db, req.sessionId);
    const snap = row ? snapshotData(db, row.snapshot_id) : null;
    return snap ? { hash: snap.snap.hash, data: snap.data } : { hash: null, data: null };
  });
  on('pres.concept', Concept, (req, now) => {
    mustControl(db, req.sessionId, req.leaseId);
    setConcept(db, req.sessionId, req.concept, now);
    hub.pushPresentation(req.sessionId);
    return {};
  });
  on('pres.rotateKey', Open, (req, now) => {
    mustControl(db, req.sessionId, req.leaseId);
    const key = rotateScreenKey(db, req.sessionId, now);
    hub.screenNs?.in(`s:${req.sessionId}`).disconnectSockets(true);
    hub.pushPresenter(req.sessionId);
    return { screenKey: key };
  });
}
