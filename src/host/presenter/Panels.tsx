import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Concept, ConceptQuote, PresenterView } from '../../shared/reveal';
import { PROFILES } from '../../shared/discussion';
import { PROMPTS } from '../../shared/discussionContent';
import type { Cmd } from './usePresenter';
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

export function QuestionPanel({ view, send, disabled }: { view: PresenterView; send: (c: Cmd) => unknown; disabled?: boolean }) {
  const q = view.question;
  const spec = q ? PROMPTS[q.prompt] : null;
  const label = (id: string) => spec?.choices?.find((c) => c.id === id)?.short ?? spec?.sliders?.find((s) => s.id === id)?.short ?? id;
  return (
    <div className="panel" data-testid="question-panel">
      <h3>Discussion</h3>
      {q ? (
        <>
          <div className="mono" data-testid="q-status">
            {q.prompt} · run {q.runs} · {q.phase} · {q.count}/{q.eligible} answered · {q.skipped} skipped{q.late ? ` · ${q.late} late` : ''}
          </div>
          {q.split.length > 0 && <div className="mono muted">{q.split.map((s) => `${label(s.id)} ${s.n}`).join(' · ')}</div>}
          {q.result?.small && <div className="warn">Fewer than 5 answers — the screen shows a talk-it-through fallback.</div>}
          <div className="row">
            <button data-testid="q-close" disabled={disabled || q.phase !== 'open'} onClick={() => void send({ t: 'close' })}>Close now</button>
            <HoldButton label="REOPEN" testId="q-reopen" disabled={disabled || q.phase === 'none'} onConfirm={() => void send({ t: 'reopen', confirm: 'REOPEN' })} />
          </div>
        </>
      ) : <div className="muted">No question on this scene.</div>}
      <div className="row">
        <button data-testid="q-hide" disabled={disabled} onClick={() => void send({ t: 'hide', on: !view.hide })}>{view.hide ? 'Show results' : 'Hide results'}</button>
        <button data-testid="q-phones" disabled={disabled} onClick={() => void send({ t: 'phones', mode: view.phones === 'auto' ? 'passive' : 'auto' })}>
          {view.phones === 'auto' ? 'Phones → passive' : 'Phones → questions'}
        </button>
        <button disabled={disabled} onClick={() => void send({ t: 'next', scene: true })}>Skip scene</button>
        <button data-testid="q-final" disabled={disabled} onClick={() => void send({ t: 'goto', scene: 'circle', beat: 0 })}>Jump to finale</button>
      </div>
      <div className="row">
        <label className="inline"><input type="checkbox" data-testid="q-landscape" checked={view.flags.landscape} disabled={disabled} onChange={(e) => void send({ t: 'flag', key: 'landscape', on: e.target.checked })} /> optional “Out there” question</label>
        {[0, 1, 2].map((i) => (
          <button key={i} disabled={disabled} onClick={() => void send({ t: 'focus', i: view.focus === i ? null : i })}>{view.focus === i ? `Unfocus ${i + 1}` : `Focus ${i + 1}`}</button>
        ))}
      </div>
    </div>
  );
}

export function Rehearsal({ onRun, disabled }: { onRun: (scenario: string, n: number, seed: string, profile: string) => void; disabled?: boolean }) {
  const [scenario, setScenario] = useState<string>('expected');
  const [profile, setProfile] = useState<string>('expected');
  const [n, setN] = useState(32);
  const [seed, setSeed] = useState('rehearsal');
  return (
    <div className="panel" data-testid="rehearsal">
      <h3>Rehearsal (synthetic data)</h3>
      <div className="row">
        <select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
          {SCENARIOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Discussion profile">
          {PROFILES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="number" min={0} max={200} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Class size" style={{ width: 80 }} />
        <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" style={{ width: 120 }} />
        <button className="primary" disabled={disabled} onClick={() => onRun(scenario, n, seed || 'rehearsal', profile)}>Run rehearsal</button>
      </div>
      <div className="muted">Sizes 12 / 30 / 60 cover the rehearsal matrix. Projector shows REHEARSAL · SYNTHETIC DATA. REWIND to clear.</div>
    </div>
  );
}

const SLOTS = ['felt', 'switch', 'mirrors', 'chooser'] as const;
const blank = (): ConceptQuote => ({ text: '', source: '', page: '' });

export function ConceptEditor({ socket, sessionId, leaseId, initial }: { socket: Socket; sessionId: string; leaseId: string; initial: Concept }) {
  const [slots, setSlots] = useState<Record<string, ConceptQuote>>(() => Object.fromEntries(SLOTS.map((k) => [k, initial.slots?.[k] ?? blank()])));
  const [c, setC] = useState<Concept>(() => ({ title: initial.title, quotes: initial.quotes.length ? initial.quotes : [{ text: '', source: '', page: '' }] }));
  const [saved, setSaved] = useState('');
  const save = async () => {
    const filled = Object.fromEntries(Object.entries(slots).filter(([, q]) => q.text.trim()));
    const r = await call(socket, 'pres.concept', { sessionId, leaseId, concept: { ...c, quotes: c.quotes.filter((q) => q.text.trim()), slots: filled } });
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
      <div className="muted">Part 3 textbook slots (left empty = the term is shown without a quote):</div>
      {SLOTS.map((k) => (
        <div key={k} className="row">
          <span className="mono" style={{ width: 70 }}>{k}</span>
          <textarea placeholder="Quote" value={slots[k].text} maxLength={400} onChange={(e) => setSlots({ ...slots, [k]: { ...slots[k], text: e.target.value } })} aria-label={`${k} quote`} />
          <input placeholder="Source" value={slots[k].source} maxLength={120} onChange={(e) => setSlots({ ...slots, [k]: { ...slots[k], source: e.target.value } })} aria-label={`${k} source`} />
          <input placeholder="p." value={slots[k].page} maxLength={20} onChange={(e) => setSlots({ ...slots, [k]: { ...slots[k], page: e.target.value } })} style={{ width: 60 }} aria-label={`${k} page`} />
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
