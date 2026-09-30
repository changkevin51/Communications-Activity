import { useEffect, useState } from 'react';
import type { Sigil as SigilT } from '../../shared/identity/sigil';
import { Sigil } from '../ui/Sigil';
import { BarButton } from '../ui/BarButton';

export function Identity({ codename, sigil, onNext }: { codename: string; sigil: SigilT; onNext: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t0 = performance.now();
    let frames = 0;
    let raf = requestAnimationFrame(function tick() {
      frames++;
      if (performance.now() - t0 < 1000) raf = requestAnimationFrame(tick);
      else if ((performance.now() - t0) / frames > 24) document.documentElement.dataset.quality = 'low';
    });
    const t = setTimeout(() => setReady(true), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);
  return (
    <main className="screen static-in">
      <div className="topline mono"><span>Signal Shift</span><span>On air</span></div>
      <div className="body">
        <Sigil sigil={sigil} size={132} trace />
        <div className="mono rise" style={{ animationDelay: '0.9s' }}>You're on air as</div>
        <h1 className="display h1 rise" style={{ animationDelay: '1.1s' }} data-testid="codename">{codename}</h1>
        <p className="lede rise" style={{ animationDelay: '1.4s' }}>
          No names, no accounts — you're {codename}. Anonymous results may appear on screens during class.
        </p>
      </div>
      <BarButton disabled={!ready} onClick={onNext}>Start</BarButton>
    </main>
  );
}
