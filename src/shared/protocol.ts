import { z } from 'zod';
import type { Stage } from './flow';
import type { Sigil } from './identity/sigil';
import { ROUND_COUNT } from './game/specs';

import { CODE_RE } from './code';

export const JoinReq = z.object({
  code: z.string().toUpperCase().regex(CODE_RE),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const StartReq = z.object({
  practice: z.object({ tries: z.number().int().min(0).max(10), correct: z.number().int().min(0).max(10) }),
});

const nullableMs = z.number().int().min(0).max(60000).nullable();

export const RoundSubmissionSchema = z.object({
  idx: z.number().int().min(0).max(ROUND_COUNT - 1),
  variant: z.number().int().min(0).max(100),
  tapped: z.number().int().min(0).max(24).nullable(),
  rtMs: nullableMs,
  studyMs: z.number().int().min(0).max(60000),
  maskMs: z.number().int().min(0).max(60000),
});

export const FinishReq = z.object({
  rounds: z
    .array(RoundSubmissionSchema)
    .length(ROUND_COUNT)
    .refine((rs) => new Set(rs.map((r) => r.idx)).size === ROUND_COUNT, 'duplicate rounds'),
  interruptions: z.number().int().min(0).max(100),
  restarted: z.boolean().optional(),
});

export const RateReq = z.object({
  phase: z.enum(['before', 'after']),
  value: z.number().min(0).max(100),
  responseMs: z.number().int().min(0).max(3_600_000),
  adjustments: z.number().int().min(0).max(10_000),
});

export const SeenReq = z.object({ dialDwellMs: z.number().int().min(0).max(3_600_000) });

export type JoinReqT = z.infer<typeof JoinReq>;
export type StartReqT = z.infer<typeof StartReq>;
export type FinishReqT = z.infer<typeof FinishReq>;
export type RateReqT = z.infer<typeof RateReq>;
export type SeenReqT = z.infer<typeof SeenReq>;

export type OtherPlayer = { codename: string; sigil: Sigil; score: number };

export type ParticipantView = {
  rev: number;
  serverNow: number;
  room: { code: string; open: boolean };
  me: { codename: string; sigil: Sigil; stage: Stage | 'removed' };
  game?: { version: string; seed: string; studyScale: number };
  result?: { score: number; avgLockMs: number | null; bestStreak: number; fastestMs: number | null };
  ratings?: { before: boolean; after: boolean };
  recap?: { revealAt: number; dialSpan: number; others: OtherPlayer[] };
};

export type Ack<T = ParticipantView> =
  | { ok: true; view: T }
  | { ok: false; reason: 'NO_ROOM' | 'CLOSED' | 'BAD_REQUEST' | 'NOT_JOINED' | 'WRONG_STAGE' | 'RATE_LIMIT' | 'ERROR' };

export type ClockAck = { serverNow: number };
