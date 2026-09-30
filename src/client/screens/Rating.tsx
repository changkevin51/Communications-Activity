import { useRef, useState } from 'react';
import type { ParticipantView } from '../../shared/protocol';
import { Fader } from '../ui/Fader';
import { BarButton } from '../ui/BarButton';

export const QUESTION = 'How well do you think you performed?';

type Props = { view: ParticipantView; onSubmit: (v: { value: number; responseMs: number; adjustments: number }) => void; busy: boolean };

export function Rating({ view, onSubmit, busy }: Props) {
  const mounted = useRef(performance.now());
  const [val, setVal] = useState<{ value: number; adjustments: number } | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <main className="screen fade-in">
      <div className="topline mono"><span>{view.me.codename}</span><span data-testid="corner-score">{view.result?.score}</span></div>
      <h1 className="display h2" style={{ marginTop: 18 }}>{QUESTION}</h1>
      <div className="body">
        <Fader label={QUESTION} onChange={(value, adjustments) => setVal({ value, adjustments })} />
      </div>
      <BarButton
        disabled={!val || busy || sent}
        data-testid="lock"
        onClick={() => {
          if (!val || sent) return;
          setSent(true);
          onSubmit({ value: val.value, adjustments: val.adjustments, responseMs: Math.round(performance.now() - mounted.current) });
        }}
      >
        Lock it in
      </BarButton>
    </main>
  );
}
