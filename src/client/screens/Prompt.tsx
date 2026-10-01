import { useMemo, useRef, useState } from 'react';
import type { Ack, PhonePrompt, ParticipantView } from '../../shared/protocol';
import { BarButton } from '../ui/BarButton';

type Value = { c: string } | { cs: string[] } | { v: number[] };
type Props = { view: ParticipantView; prompt: PhonePrompt; send: (event: string, payload: unknown) => Promise<Ack> };

const rid = () => `r${Array.from(crypto.getRandomValues(new Uint32Array(3)), (x) => x.toString(36)).join('')}`.slice(0, 32);

function Slider({ label, anchors, value, onChange }: { label: string; anchors: [string, string]; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="p-slider">
      <div className="p-slider-label">{label}</div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value ?? 50}
        className={value === null ? 'untouched' : ''}
        aria-label={label}
        aria-valuetext={value === null ? 'Not set' : `${value} out of 100`}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(e) => value === null && onChange(Number((e.target as HTMLInputElement).value))}
        data-testid="p-slider"
      />
      <div className="p-anchors mono"><span>{anchors[0]}</span><span>{anchors[1]}</span></div>
    </div>
  );
}

export function Prompt({ view, prompt, send }: Props) {
  const id = useRef(rid()).current;
  const [pick, setPick] = useState<string[]>([]);
  const [vals, setVals] = useState<(number | null)[]>(() => (prompt.sliders ?? []).map(() => null));
  const [state, setState] = useState<'idle' | 'sending' | 'closed'>('idle');
  const max = prompt.kind === 'single' ? 1 : prompt.max ?? 3;

  const value: Value | null = useMemo(() => {
    if (prompt.kind === 'single') return pick[0] ? { c: pick[0] } : null;
    if (prompt.kind === 'multi') return pick.length ? { cs: pick } : null;
    return { v: vals.map((v) => v ?? 50) };
  }, [prompt.kind, pick, vals]);

  const toggle = (c: string) => {
    if (prompt.kind === 'single') return setPick([c]);
    const ex = prompt.exclusive ?? [];
    if (pick.includes(c)) return setPick(pick.filter((x) => x !== c));
    if (ex.includes(c)) return setPick([c]);
    const next = pick.filter((x) => !ex.includes(x));
    if (next.length >= max) return;
    setPick([...next, c]);
  };

  const submit = async (v: Value) => {
    if (state !== 'idle') return;
    setState('sending');
    const res = await send('answer', { prompt: prompt.id, run: prompt.run, rid: id, value: v });
    if (!res.ok) setState(res.reason === 'CLOSED' || res.reason === 'WRONG_STAGE' ? 'closed' : 'idle');
  };

  if (state === 'closed')
    return (
      <main className="screen fade-in" data-testid="prompt-closed">
        <div className="topline mono"><span>{view.me.codename}</span><span>Closed</span></div>
        <div className="body"><h1 className="display h2">That question just closed.</h1><p className="lede">No problem. Look at the main screen.</p></div>
      </main>
    );

  return (
    <main className="screen fade-in prompt" data-testid="prompt" data-prompt={prompt.id}>
      <div className="topline mono"><span>{view.me.codename}</span><span>Private</span></div>
      <h1 className="display h2" style={{ marginTop: 18 }} data-testid="prompt-title">{prompt.title}</h1>
      {prompt.body && <p className="lede" style={{ marginTop: 10 }}>{prompt.body}</p>}
      <div className="body p-body">
        {prompt.choices && (
          <div className="p-choices" role={prompt.kind === 'single' ? 'radiogroup' : 'group'} aria-label={prompt.title}>
            {prompt.choices.map((c) => {
              const on = pick.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`p-choice ${on ? 'on' : ''}`}
                  role={prompt.kind === 'single' ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  onClick={() => toggle(c.id)}
                  data-testid={`choice-${c.id}`}
                >
                  {c.label}
                </button>
              );
            })}
            {prompt.kind === 'multi' && <div className="mono">{pick.length} of {max} picked</div>}
          </div>
        )}
        {prompt.sliders?.map((s, i) => (
          <Slider key={s.id} label={s.label} anchors={prompt.anchors ?? ['0', '100']} value={vals[i]} onChange={(v) => setVals((cur) => cur.map((x, j) => (j === i ? v : x)))} />
        ))}
      </div>
      <BarButton disabled={!value || state !== 'idle'} onClick={() => value && void submit(value)} data-testid="prompt-send">
        {state === 'sending' ? 'Sending…' : prompt.submitLabel}
      </BarButton>
    </main>
  );
}
