import { useEffect, useRef, useState } from 'react';
import { generatePractice } from '../../shared/game/generate';
import { PRACTICE_SPEC } from '../../shared/game/specs';
import { runRound, type Phase } from '../game/runner';
import { BarButton } from '../ui/BarButton';

const CAPTIONS: Partial<Record<Phase, string>> = { cue: 'Memorize the grid.', study: 'Memorize the grid.', mask: 'Blink.', test: 'Tap the one that changed.' };

type Props = { seed: string; play: boolean; onDone: (practice: { tries: number; correct: number }) => void; busy: boolean };

export function Tutorial({ seed, play, onDone, busy }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const [caption, setCaption] = useState('Memorize the grid.');
  const [ready, setReady] = useState(false);
  const stats = useRef({ tries: 0, correct: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let variant = 0; variant < 12 && !cancelled; variant++) {
        const out = await runRound(board.current!, PRACTICE_SPEC, generatePractice(seed, variant), {
          studyScale: 1,
          onPhase: (p) => CAPTIONS[p] && setCaption(CAPTIONS[p]!),
        });
        if (cancelled) return;
        if (out.interrupted) continue;
        stats.current.tries++;
        if (out.correct) stats.current.correct++;
        if (out.correct || stats.current.tries >= 2) break;
        setCaption('It was this one. One more.');
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [seed]);

  if (ready) {
    return (
      <main className="screen fade-in">
        <div className="topline mono"><span>Practice</span><span>Done</span></div>
        <div className="body">
          <h1 className="display h1">12 rounds.<br />It gets harder.<br /><span className="accent">Ready?</span></h1>
          <p className="lede">{play ? "Everyone's game is a little different." : 'Wait for the room to start.'}</p>
        </div>
        <BarButton disabled={busy || !play} onClick={() => onDone(stats.current)} data-testid="go">Go</BarButton>
      </main>
    );
  }
  return (
    <main className="screen">
      <div className="topline mono"><span>Practice</span><span>1 / 1</span></div>
      <div className="body">
        <div className="caption" aria-live="polite">{caption}</div>
        <div ref={board} className="board" data-testid="board" />
      </div>
      <div style={{ height: 'calc(var(--bar-h) + var(--safe-b))' }} />
    </main>
  );
}
