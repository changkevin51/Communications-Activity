import { z } from 'zod';
import { GAME_VERSION } from '../shared/game/specs';

export const SessionConfigSchema = z.object({
  gameVersion: z.literal(GAME_VERSION).default(GAME_VERSION),
  studyScale: z.number().min(0.3).max(3).default(1),
  peers: z.literal(3).default(3),
  countdownMs: z.number().int().min(0).max(15000).default(3500),
  ghostPolicy: z.enum(['fill', 'off']).default('fill'),
  assignMode: z.enum(['release', 'instant']).default('release'),
  assist: z.boolean().default(true),
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const LATE_REVEAL_MS = 3000;

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? '.data/dev.db',
  adminKey: process.env.ADMIN_KEY ?? (process.env.APP_ENV === 'production' ? '' : 'bob'),
  appEnv: process.env.APP_ENV ?? 'development',
  clientDir: process.env.CLIENT_DIR ?? 'dist/client',
};
