import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './config';
import { openDb } from './db/db';
import { createApp } from './app';

if (!env.adminKey) {
  console.error('ADMIN_KEY is required in production');
  process.exit(1);
}
if (env.dbPath !== ':memory:') mkdirSync(dirname(env.dbPath), { recursive: true });
const db = openDb(env.dbPath);
const { app } = await createApp({ db, adminKey: env.adminKey, clientDir: env.clientDir, logger: true });
await app.listen({ port: env.port, host: env.host });

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
