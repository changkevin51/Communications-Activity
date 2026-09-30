import { useEffect, useRef, useState } from 'react';
import type { ParticipantView } from '../../shared/protocol';
import { Dial } from '../recap/Dial';
import { Sigil } from '../ui/Sigil';
import { BarButton } from '../ui/BarButton';
import { Stats } from './Result';

const MIN_DWELL = 5500;

export function Recap({ view, onDone, busy }: { view: ParticipantView; onDone: (dwellMs: number) => void; busy: boolean }) {
  const mounted = useRef(performance.now());
  const [t, setT] = useState(0);
  useEffect(() => {
    const steps = [600, 1200, 2400, 3600, MIN_DWELL].map((ms, i) => setTimeout(() => setT(i + 1), ms));
    return () => steps.forEach(clearTimeout);
  }, []);
  const recap = view.recap!;
  const me = view.result!.score;
  const shown = Math.max(0, t - 1);
  return (
    <main className="screen fade-in" data-testid="recap">
      <div className="topline mono"><span>Also on the dial</span><span>{view.me.codename}</span></div>
      <div style={{ marginTop: 14 }}><Stats r={view.result!} /></div>
      <div className="body" style={{ gap: 10 }}>
        <Dial me={me} span={recap.dialSpan} others={recap.others} shown={Math.min(3, shown)} needle={t >= 1} />
        <ul className="others">
          {recap.others.slice(0, Math.min(3, shown)).map((o) => (
            <li key={o.codename} className="rise">
              <Sigil sigil={o.sigil} size={32} />
              <span className="name">{o.codename}</span>
              <span className="score">{o.score}</span>
            </li>
          ))}
        </ul>
      </div>
      <BarButton
        disabled={t < 5 || busy}
        className={t < 5 ? 'quiet' : 'fade-in'}
        data-testid="recap-continue"
        onClick={() => onDone(Math.round(performance.now() - mounted.current))}
      >
        Continue
      </BarButton>
    </main>
  );
}
