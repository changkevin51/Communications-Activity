import { useState } from 'react';
import type { ParticipantView } from '../../shared/protocol';
import { ScoreLockIn } from '../recap/ScoreLockIn';
import { BarButton } from '../ui/BarButton';

export const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)}s`);

export function Stats({ r }: { r: NonNullable<ParticipantView['result']> }) {
  return (
    <div className="stats">
      <div className="stat"><div className="mono">Avg lock</div><div className="v">{secs(r.avgLockMs)}</div></div>
      <div className="stat"><div className="mono">Best streak</div><div className="v">{r.bestStreak}</div></div>
      <div className="stat"><div className="mono">Fastest</div><div className="v">{secs(r.fastestMs)}</div></div>
    </div>
  );
}

export function Result({ view, onNext }: { view: ParticipantView; onNext: () => void }) {
  const [locked, setLocked] = useState(false);
  const r = view.result!;
  return (
    <main className="screen fade-in">
      <div className="topline mono"><span>{view.me.codename}</span><span>Room {view.room.code}</span></div>
      <div className="body">
        <div className="mono">Signal score</div>
        <ScoreLockIn score={r.score} onLocked={() => setLocked(true)} />
        <div className={locked ? 'rise' : ''} style={{ opacity: locked ? 1 : 0 }}>
          <Stats r={r} />
        </div>
      </div>
      <BarButton disabled={!locked} onClick={onNext}>Continue</BarButton>
    </main>
  );
}
