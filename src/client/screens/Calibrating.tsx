import { useEffect, useState } from 'react';
import type { ParticipantView } from '../../shared/protocol';
import { Sigil } from '../ui/Sigil';
import { requestWakeLock, useNow, useReducedMotion } from '../ui/motion';

const LINES = ['Syncing timing data', 'Mapping your run', 'Building your recap'];

export function Calibrating({ view, serverNow }: { view: ParticipantView; serverNow: () => number }) {
  const [line, setLine] = useState(0);
  const reduced = useReducedMotion();
  useNow(100);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 2200);
    let release = () => {};
    void requestWakeLock().then((r) => (release = r));
    return () => {
      clearInterval(t);
      release();
    };
  }, []);
  const revealAt = view.recap?.revealAt;
  const left = revealAt ? revealAt - serverNow() : null;
  const count = left !== null && left > 0 && left <= 3000 ? Math.ceil(left / 1000) : null;
  return (
    <main className="screen" data-testid="calibrating">
      <div className="topline mono"><span>{view.me.codename}</span><span>Room {view.room.code}</span></div>
      <div className="body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 200, height: 200, display: 'grid', placeItems: 'center' }}>
          <svg width="200" height="200" viewBox="0 0 200 200" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
            <circle cx="100" cy="100" r="96" fill="none" stroke="var(--hair)" strokeWidth="1" strokeDasharray="2 6" />
          </svg>
          {count !== null ? (
            <div key={count} className={`big-count ${reduced ? 'fade-in' : 'rise'}`}>{count}</div>
          ) : (
            <Sigil sigil={view.me.sigil} size={150} morph />
          )}
        </div>
        <h1 className="display h2">Calibrating</h1>
        <div className="mono" aria-live="polite">{LINES[line]}…</div>
      </div>
      <div style={{ height: 'calc(var(--bar-h) + var(--safe-b))' }} />
    </main>
  );
}
