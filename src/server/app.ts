import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import type { Db } from './db/db';
import { Hub } from './hub';
import { keyMatches } from './auth';
import { CODE_RE } from '../shared/code';
import { exportCsv, exportJson } from './services/exporter';
import { registerParticipantNs } from './sockets/participant';
import { registerHostNs } from './sockets/host';

export type AppOptions = { db: Db; adminKey: string; clientDir?: string; logger?: boolean; hostDebounceMs?: number };

export async function createApp(opts: AppOptions) {
  const { db, adminKey } = opts;
  const app = Fastify({ logger: opts.logger ?? false, logController: new LogController({ disableRequestLogging: true }), trustProxy: true, bodyLimit: 32 * 1024 });
  const hub = new Hub(db, opts.hostDebounceMs);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.get('/healthz', async () => {
    db.get('SELECT 1 AS ok');
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/export/:id', async (req, reply) => {
    if (!keyMatches(req.headers['x-admin-key'], adminKey)) return reply.code(401).send({ ok: false });
    if (req.query.format === 'csv') {
      const csv = exportCsv(db, req.params.id);
      if (csv === null) return reply.code(404).send({ ok: false });
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="signal-shift-${req.params.id}.csv"`)
        .send(csv);
    }
    const data = exportJson(db, req.params.id);
    if (!data) return reply.code(404).send({ ok: false });
    return reply.header('Content-Disposition', `attachment; filename="signal-shift-${req.params.id}.json"`).send(data);
  });

  const clientDir = opts.clientDir ? resolve(opts.clientDir) : null;
  if (clientDir && existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir, serve: false });
    const noStore = { 'Cache-Control': 'no-store' };
    app.get('/', (_req, reply) => reply.headers(noStore).sendFile('index.html'));
    app.get('/host', (_req, reply) => reply.headers(noStore).sendFile('host.html'));
    app.get<{ Params: { '*': string } }>('/assets/*', (req, reply) =>
      reply.header('Cache-Control', 'public, max-age=31536000, immutable').sendFile(`assets/${req.params['*']}`),
    );
    app.get<{ Params: { seg: string } }>('/:seg', (req, reply) => {
      const seg = req.params.seg;
      if (CODE_RE.test(seg.toUpperCase())) return reply.headers(noStore).sendFile('index.html');
      return reply.sendFile(seg);
    });
  }

  const io = new Server(app.server, { maxHttpBufferSize: 64 * 1024, serveClient: false });
  hub.participantNs = io.of('/p');
  hub.hostNs = io.of('/h');
  registerParticipantNs(hub.participantNs, db, hub);
  registerHostNs(hub.hostNs, db, hub, adminKey);

  app.addHook('onClose', async () => {
    hub.close();
    await io.close();
  });

  return { app, io, hub };
}
