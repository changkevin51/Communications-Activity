import { io, type Socket } from 'socket.io-client';

export type HostRes<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; reason: string };

export function connectHost(key: string): Socket {
  return io('/h', { transports: ['websocket', 'polling'], auth: { key } });
}

export async function call<T = Record<string, unknown>>(s: Socket, event: string, payload: unknown = {}): Promise<HostRes<T>> {
  try {
    return (await s.timeout(8000).emitWithAck(event, payload)) as HostRes<T>;
  } catch {
    return { ok: false, reason: 'TIMEOUT' };
  }
}

export async function download(key: string, sessionId: string, format: 'json' | 'csv', code: string) {
  const res = await fetch(`/api/export/${sessionId}?format=${format}`, { headers: { 'x-admin-key': key } });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `signal-shift-${code}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type Summary = { condition: string; n: number; meanScore: number | null; meanR1: number | null; meanR2: number | null; meanDelta: number | null; done: number };
export type PRow = {
  id: string; codename: string; kind: string; stage: string; score: number | null; r1: number | null; r2: number | null; delta: number | null;
  condition: string | null; stratum: number | null; batch: string | null; peers: { codename: string; score: number; kind: string; diff: number }[]; flags: string[];
};
export type HostView = {
  session: { id: string; code: string; label: string; mode: 'live' | 'test'; phase: 'open' | 'released' | 'closed'; config: Record<string, unknown>; releasedAt: number | null };
  funnel: Record<string, number>;
  connected: number;
  total: number;
  finished: number;
  waiting: number;
  internals: {
    summary: Summary[];
    ghosts: { count: number; exposures: number; realExposures: number };
    thresholds: Record<string, number> | null;
    participants: PRow[];
  };
};
export type SessionItem = { id: string; code: string; label: string; mode: string; phase: string; created_at: number; players: number };
