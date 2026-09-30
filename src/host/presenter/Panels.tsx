import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Concept } from '../../shared/reveal';
import { call } from '../api';

const SCENARIOS = ['expected', 'noisy', 'none', 'reversed', 'small', 'ties', 'imbalanced', 'lateheavy'] as const;

export function HoldButton({ label, onConfirm, disabled, testId, ms = 1200 }: { label: string; onConfirm: () => void; disabled?: boolean; testId: string; ms?: number }) {
  const [p, setP] = useState(0);
  const t = useRef<number | null>(null);
  const start = () => {
    if (disabled) return;
    const t0 = performance.now();
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      setP(f);
      if (f >= 1) {
        t.current = null;
        setP(0);
        onConfirm();
      } else t.current = requestAnimationFrame(tick);
    };
    t.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (t.current) cancelAnimationFrame(t.current);
    t.current = null;
    setP(0);
  };
  useEffect(() => stop, []);
  return (
    <button
      className="hold-btn"
      data-testid={testId}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => e.key === ' ' && !e.repeat && (e.preventDefault(), start())}
      onKeyUp={(e) => e.key === ' ' && stop()}
      style={{ backgroundSize: `${p * 100}% 100%` }}
    >
      Hold to {label}
    </button>
  );
}

export function Rehearsal({ onRun, disabled }: { onRun: (scenario: string, n: number, seed: string) => void; disabled?: boolean }) {
  const [scenario, setScenario] = useState<string>('expected');
  const [n, setN] = useState(32);
  const [seed, setSeed] = useState('rehearsal');
  return (
    <div className="panel" data-testid="rehearsal">
      <h3>Rehearsal (synthetic data)</h3>
      <div className="row">
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
          {SCENARIOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="number" min={0} max={200} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Class size" style={{ width: 80 }} />
        <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" style={{ width: 120 }} />
        <button className="primary" disabled={disabled} onClick={() => onRun(scenario, n, seed || 'rehearsal')}>Run rehearsal</button>
      </div>
      <div className="muted">Projector shows REHEARSAL · SYNTHETIC DATA. REWIND to clear.</div>
    </div>
  );
}

export function ConceptEditor({ socket, sessionId, initial }: { socket: Socket; sessionId: string; initial: Concept }) {
  const [c, setC] = useState<Concept>(() => ({ title: initial.title, quotes: initial.quotes.length ? initial.quotes : [{ text: '', source: '', page: '' }] }));
  const [saved, setSaved] = useState('');
  const save = async () => {
    const r = await call(socket, 'pres.concept', { sessionId, concept: { ...c, quotes: c.quotes.filter((q) => q.text.trim()) } });
    setSaved(r.ok ? 'Saved' : r.reason);
  };
  const setQ = (i: number, k: 'text' | 'source' | 'page', v: string) => setC({ ...c, quotes: c.quotes.map((q, j) => (j === i ? { ...q, [k]: v } : q)) });
  return (
    <div className="panel">
      <h3>Concept slide (optional)</h3>
      <input placeholder="Title, e.g. Social comparison" value={c.title} maxLength={80} onChange={(e) => setC({ ...c, title: e.target.value })} aria-label="Concept title" />
      {c.quotes.map((q, i) => (
        <div key={i} className="row">
          <textarea placeholder="Quote" value={q.text} maxLength={400} onChange={(e) => setQ(i, 'text', e.target.value)} aria-label={`Quote ${i + 1}`} />
          <input placeholder="Source" value={q.source} maxLength={120} onChange={(e) => setQ(i, 'source', e.target.value)} aria-label={`Source ${i + 1}`} />
          <input placeholder="p." value={q.page} maxLength={20} onChange={(e) => setQ(i, 'page', e.target.value)} style={{ width: 60 }} aria-label={`Page ${i + 1}`} />
        </div>
      ))}
      <div className="row">
        {c.quotes.length < 3 && <button onClick={() => setC({ ...c, quotes: [...c.quotes, { text: '', source: '', page: '' }] })}>Add quote</button>}
        <button onClick={() => void save()}>Save</button>
        <span className="muted">{saved}</span>
      </div>
    </div>
  );
}
