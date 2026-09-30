import { useRef, useState } from 'react';
import { CODE_ALPHABET } from '../../shared/code';
import { BarButton } from '../ui/BarButton';

export function Join({ onCode, error }: { onCode: (code: string) => void; error?: string }) {
  const [chars, setChars] = useState(['', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = chars.join('');
  const set = (i: number, raw: string) => {
    const clean = raw.toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c));
    const next = [...chars];
    if (!clean.length) {
      next[i] = '';
      setChars(next);
      return;
    }
    let j = i;
    for (const c of clean) if (j < 4) next[j++] = c;
    setChars(next);
    refs.current[Math.min(j, 3)]?.focus();
  };
  return (
    <main className="screen">
      <div className="topline mono"><span>Signal Shift</span><span>Ch. 01</span></div>
      <div className="body">
        <h1 className="display wordmark">SIGNAL<br /><span className="accent">SHIFT</span></h1>
        <label className="mono" htmlFor="code0">Room code</label>
        <div className="codeboxes">
          {chars.map((c, i) => (
            <input
              key={i}
              id={`code${i}`}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="codebox"
              value={c}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              aria-label={`Code character ${i + 1}`}
              onChange={(e) => set(i, e.target.value.slice(-4))}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus();
                if (e.key === 'Enter' && code.length === 4) onCode(code);
              }}
            />
          ))}
        </div>
        <div className="error" role="alert">{error}</div>
      </div>
      <BarButton disabled={code.length !== 4} onClick={() => onCode(code)}>Tune in</BarButton>
    </main>
  );
}
