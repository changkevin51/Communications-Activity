import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/server/db/db';
import { createSession } from '../../src/server/services/host';
import { spawnBots } from '../../src/server/services/bots';
import { fastForwardBots, releaseSession, stepBots } from '../../src/server/services/autopilot';
import { ensurePresentation, getPresentation, command } from '../../src/server/services/presentation';
import { openRun } from '../../src/server/services/discussion';
import { getSession } from '../../src/server/db/repo';

let db: Db;
afterEach(() => db.close());

function setup(n = 12) {
  db = openDb(':memory:');
  const now = 1000;
  const session = createSession(db, 'autopilot', 'test', { countdownMs: 0 }, now);
  spawnBots(db, session.id, n, 660, 120, now);
  ensurePresentation(db, session.id, now);
  return { session, now };
}

function leaveLobby(sessionId: string, now: number) {
  const row = getPresentation(db, sessionId)!;
  const result = command(db, sessionId, 'lease-autopilot', { t: 'next', rev: row.rev }, now);
  expect(result.ok).toBe(true);
  return now;
}

describe('bot autopilot', () => {
  it('waits in the lobby, then starts and rates on schedule', () => {
    const { session, now } = setup();
    stepBots(db, session.id, now + 60_000);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ?", session.id).every((p) => p.stage === 'joined')).toBe(true);
    const openedAt = leaveLobby(session.id, now + 1000);
    stepBots(db, session.id, openedAt + 7000);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ?", session.id).every((p) => p.stage === 'playing')).toBe(true);
    stepBots(db, session.id, openedAt + 90_000);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ?", session.id).every((p) => p.stage === 'rated_before')).toBe(true);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ratings WHERE phase = ?', 'before')?.n).toBe(12);
  });

  it('catches bots up through recaps and completes them after release', () => {
    const { session, now } = setup();
    const released = releaseSession(db, getSession(db, session.id)!, now + 1000);
    expect(released).toHaveLength(12);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ? AND kind = 'bot' ORDER BY id", session.id).map((p) => p.stage)).toEqual(Array(12).fill('assigned'));
    stepBots(db, session.id, now + 31_000);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ? AND kind = 'bot' ORDER BY id", session.id).map((p) => p.stage)).toEqual(Array(12).fill('done'));
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ratings WHERE phase = 'after'")?.n).toBe(12);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM assignments WHERE dial_dwell_ms BETWEEN 3000 AND 8000')?.n).toBe(12);
  });

  it('answers each open test question after its delay', () => {
    const { session, now } = setup(10);
    fastForwardBots(db, getSession(db, session.id)!, 'done', now + 1000);
    const s = getSession(db, session.id)!;
    const run = openRun(db, { s, source: 'test', demo: null }, 'felt', now + 2000);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM responses')?.n).toBe(0);
    stepBots(db, session.id, now + 12_000);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM responses WHERE run = ?', run)?.n).toBe(10);
  });

  it('fast-forwards from joined, releases, and finishes every bot', () => {
    const { session, now } = setup(8);
    const result = fastForwardBots(db, getSession(db, session.id)!, 'done', now + 5000);
    expect(result.touched).toHaveLength(8);
    expect(result.refresh).toHaveLength(8);
    expect(db.all<{ stage: string }>("SELECT stage FROM participants WHERE session_id = ? AND kind = 'bot' ORDER BY id", session.id).map((p) => p.stage)).toEqual(Array(8).fill('done'));
    expect(getSession(db, session.id)?.released_at).toBe(now + 5000);
  });
});
