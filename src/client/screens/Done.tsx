import { useEffect } from 'react';
import type { ParticipantView } from '../../shared/protocol';
import { Sigil } from '../ui/Sigil';
import { requestWakeLock } from '../ui/motion';

export function Done({ view }: { view: ParticipantView }) {
  const look = view.room.screen === 'look';
  useEffect(() => {
    let release = () => {};
    void requestWakeLock().then((r) => (release = r));
    return () => release();
  }, []);
  return (
    <main className="screen fade-in" data-testid="done">
      <div className="topline mono"><span>{view.me.codename}</span><span>Off air</span></div>
      <div className="body">
        <Sigil sigil={view.me.sigil} size={120} morph />
        <h1 className="display h1" data-testid="done-title">{look ? 'Eyes up here.' : "You're done."}</h1>
        <p className="lede">{look ? 'Look at the main screen.' : 'Keep this page open and look at the main screen.'}</p>
      </div>
      <div className="mono" style={{ padding: '18px 0 calc(18px + var(--safe-b))' }}>Room {view.room.code}</div>
    </main>
  );
}
