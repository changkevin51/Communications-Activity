import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Socket } from 'socket.io-client';
import { SCENES, isPreReveal, nextPos, sceneSpec, type NavCtx, type PresenterView, type SceneId } from '../../shared/reveal';
import { Stage } from '../../screen/Stage';
import { call } from '../api';
import { usePresenter, type Cmd } from './usePresenter';
import { Rehearsal, ConceptEditor, HoldButton, QuestionPanel } from './Panels';
import '../../screen/screen.css';

const NOTE_LABELS = [
  'DO NOT SAY', 'POINT OUT', 'IF EXPECTED', 'IF REVERSED', 'IF MIXED', 'IF WEAK', 'IF FLAT', 'IF THIN', 'IF OBVIOUS', 'IF NOT',
  'FOLLOW-UP', 'TRANSITION', 'PARTNER', 'CAUTION', 'PAUSE', 'NOTE', 'GOAL', 'LIVE', 'SAY', 'ASK', 'WAIT',
];

function noteKind(label: string | undefined): string {
  if (!label) return 'plain';
  if (label.startsWith('IF ')) return 'if';
  return label.toLowerCase().replace(/[^a-z]+/g, '-');
}

function NoteList({ notes }: { notes: string[] }) {
  return (
    <ul className="notes" data-testid="notes">
      {notes.map((n, i) => {
        const label = NOTE_LABELS.find((l) => n.startsWith(`${l}:`));
        const body = label ? n.slice(label.length + 1).trim() : n;
        return (
          <li key={i} className={`note note-${noteKind(label)}`}>
            {label ? <span className="note-label">{label}</span> : null}
            <span className="note-body">{body}</span>
          </li>
        );
      })}
    </ul>
  );
}

const SHORTCUTS: [string, string][] = [
  ['→ ↓ Space PgDn', 'Next beat'], ['← ↑ PgUp', 'Previous beat'], ['Shift+→ / Shift+←', 'Next / previous scene'],
  ['B or .', 'Hold (blackout)'], ['R', 'Replay beat'], ['F', 'Plain mode'], ['G', 'Focus scene strip'],
  ['Enter Enter', 'BEGIN REVEAL (from pre-reveal)'], ['?', 'This overlay'],
];

export function Presenter({ socket, sessionId, onExit }: { socket: Socket; sessionId: string; onExit: () => void }) {
  const { view, data, send, lease, toast, setToast } = usePresenter(socket, sessionId);
  const [help, setHelp] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const lastEnter = useRef(0);
  const [qr, setQr] = useState<string | null>(null);
  const controlling = !!view && (view.lease.controller === null || view.lease.controller === lease);
  const screenUrl = view ? `${location.origin}/screen/${view.code}#k=${encodeURIComponent(view.screenKey)}` : '';
  const consoleUrl = `${location.origin}/host#present=${sessionId}`;

  useEffect(() => {
    void QRCode.toDataURL(consoleUrl, { margin: 1, width: 220 }).then(setQr, () => {});
  }, [consoleUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const v = view;
      if (!v) return;
      const k = e.key;
      let cmd: Cmd | ((x: PresenterView) => Cmd) | null = null;
      if (k === '?') return setHelp((h) => !h);
      if (k === 'Escape') return setHelp(false);
      if (k === 'g' || k === 'G') return strip.current?.querySelector<HTMLButtonElement>('button.cur')?.focus();
      if (k === 'Enter' && el?.tagName !== 'BUTTON') {
        if (!isPreReveal(v.scene)) return;
        const now = Date.now();
        if (now - lastEnter.current < 2000) {
          lastEnter.current = 0;
          cmd = { t: 'begin', confirm: 'BEGIN' };
        } else {
          lastEnter.current = now;
          setToast('Press Enter again within 2 s to BEGIN REVEAL.');
          return;
        }
      } else if ((k === 'ArrowRight' && e.shiftKey)) cmd = { t: 'next', scene: true };
      else if ((k === 'ArrowLeft' && e.shiftKey)) cmd = { t: 'prev', scene: true };
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(k)) cmd = { t: 'next' };
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) cmd = { t: 'prev' };
      else if (k === 'b' || k === 'B' || k === '.') cmd = (x: PresenterView) => ({ t: 'hold', on: !x.hold });
      else if (k === 'r' || k === 'R') cmd = { t: 'replay' };
      else if (k === 'f' || k === 'F') cmd = (x: PresenterView) => ({ t: 'plain', on: !x.plain });
      if (!cmd) return;
      e.preventDefault();
      if (e.repeat) return;
      void send(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, send, setToast]);

  const ctx: NavCtx | null = useMemo(() => (view ? { data, concept: view.conceptConfig, flags: view.flags } : null), [view, data]);
  const next = view && ctx ? nextPos({ scene: view.scene, beat: view.beat }, ctx) : null;

  if (!view || !ctx) return <div className="wrap">Opening presenter…</div>;
  const nextSt = next ? { ...view, scene: next.scene, beat: next.beat, hold: false, concept: view.conceptConfig } : null;
  const cur = { ...view, concept: view.scene === 'concept' ? view.conceptConfig : view.concept };
  const pre = isPreReveal(view.scene);
  const r = view.readiness;

  return (
    <div className="pres" data-testid="presenter">
      <header className="pres-top">
        <button onClick={onExit}>← Sessions</button>
        <b className="mono">{view.code}</b>
        <span className={`tag ${view.mode}`}>{view.mode.toUpperCase()}</span>
        {view.assist && <span className="tag">ASSIST</span>}
        {view.source === 'demo' && <span className="tag demo">REHEARSAL · {view.scenario}</span>}
        <span className="muted">{sceneSpec(view.scene).title} · beat {view.beat + 1}/{view.beats}{view.hold ? ' · HOLD' : ''}{view.plain ? ' · PLAIN' : ''}</span>
        <span className="grow" />
        <span className={view.readiness.projectors ? 'ok' : 'err'} data-testid="projectors">Projector {view.readiness.projectors ? `connected (${view.readiness.projectors})` : 'not connected'}</span>
        {controlling ? <span className="ok">You have control</span> : (
          <button className="primary" onClick={() => void send({ t: 'take' })}>Take control</button>
        )}
        <button onClick={() => setHelp(true)} aria-label="Shortcuts">?</button>
      </header>
      {toast && <div className="toast" role="status">{toast}</div>}
      <div className="pres-main">
        <section className="pres-now">
          <div className="label">ON SCREEN</div>
          <Stage st={cur} data={data} still />
          <div className="pad">
            <button className="big" onClick={() => void send({ t: 'prev' })} disabled={!controlling}>◀ Prev</button>
            <button className="big primary" onClick={() => void send({ t: 'next' })} disabled={!controlling || (pre && view.scene === 'hold')}>Next ▶</button>
          </div>
          <div className="row">
            <button onClick={() => void send({ t: 'hold', on: !view.hold })} disabled={!controlling}>{view.hold ? 'Unhold' : 'Hold (B)'}</button>
            <button onClick={() => void send({ t: 'replay' })} disabled={!controlling}>Replay (R)</button>
            <button onClick={() => void send({ t: 'plain', on: !view.plain })} disabled={!controlling}>{view.plain ? 'Animated' : 'Plain (F)'}</button>
            <select value={view.motion} onChange={(e) => void send({ t: 'motion', motion: e.target.value })} disabled={!controlling} aria-label="Motion">
              <option value="full">motion: full</option><option value="calm">motion: calm</option><option value="off">motion: off</option>
            </select>
            {pre && (
              <label className="inline"><input type="checkbox" checked={view.auto} onChange={(e) => void send({ t: 'auto', on: e.target.checked })} disabled={!controlling} /> auto-follow</label>
            )}
          </div>
        </section>
        <section className="pres-side">
          <div className="label">NEXT</div>
          {nextSt ? <Stage st={nextSt} data={data} still width={360} /> : <div className="muted next-none">{pre ? 'BEGIN REVEAL to continue' : 'End of show'}</div>}
          <div className="label">NOTES</div>
          <NoteList notes={view.notes} />
          <div className="reveal-actions">
            {pre ? (
              <HoldButton label="BEGIN REVEAL" testId="begin" disabled={!controlling} onConfirm={() => void send({ t: 'begin', confirm: 'BEGIN' })} />
            ) : (
              <>
                <HoldButton label="RESNAP" testId="resnap" disabled={!controlling} onConfirm={() => void send({ t: 'resnap', confirm: 'RESNAP' })} />
                <HoldButton label="REWIND" testId="rewind" disabled={!controlling} onConfirm={() => void send({ t: 'rewind', confirm: 'REWIND' })} />
              </>
            )}
          </div>
        </section>
      </div>
      <div className="pres-strip" ref={strip} data-testid="strip">
        {view.strip.map((s) => (
          <button
            key={s.scene}
            className={`${s.scene === view.scene ? 'cur' : ''} ${s.skip ? 'skip' : ''}`}
            title={s.skip ?? sceneSpec(s.scene).title}
            disabled={!controlling || !!s.skip || (isPreReveal(s.scene) !== pre)}
            onClick={() => void send({ t: 'goto', scene: s.scene, beat: 0 })}
          >
            {sceneSpec(s.scene).title}
            <small>{s.skip ? 'skipped' : `${s.beats} beat${s.beats > 1 ? 's' : ''}`}</small>
          </button>
        ))}
      </div>
      <div className="pres-panels">
        <div className="panel">
          <h3>Readiness</h3>
          <div className="mono">joined {r.joined} · started {r.started} · playing {r.playing} · rating {r.rating} · done {r.done}</div>
          <div className="mono muted">phones connected {r.phones} · phase {view.phase}</div>
          {!view.released && (
            <button
              className="primary"
              data-testid="release-phones"
              disabled={!controlling}
              onClick={() => confirm('Release waiting phones? They will see the three scores.') && void call(socket, 'release', { sessionId }).then((res) => { if (!res.ok) setToast(res.reason); })}
            >
              Release phones
            </button>
          )}
          {pre && view.phase !== 'closed' && <div className="warn">Close joins before BEGIN REVEAL.</div>}
        </div>
        <div className="panel" data-testid="health">
          <h3>Data health</h3>
          {view.health ? (
            <>
              <div className="mono">eligible {view.health.n.eligible} · rated twice {view.health.n.paired} · pattern {view.health.pattern}</div>
              <div className="mono muted">
                {(['up', 'neutral', 'down'] as const).map((w) => `${w} ${view.health!.worlds[w].n}/${view.health!.worlds[w].nPaired}`).join(' · ')}
              </div>
              <div className="mono muted">
                excluded: removed {view.health.counts.excluded.removed} · invalid {view.health.counts.excluded.invalid} · no score {view.health.counts.excluded.noScore} · still playing {view.health.counts.excluded.stillPlaying}
              </div>
              {view.late ? <div className="muted">{view.late} finished after the snapshot (RESNAP to include).</div> : null}
              {view.assist && view.source !== 'demo' && (
                <div className="mono muted">
                  {view.health.counts.assist
                    ? `assist: adjusted ${view.health.counts.assist.shaped + view.health.counts.assist.filled} ratings · gave ${view.health.counts.assist.assigned} a room · added ${view.health.counts.assist.added} players`
                    : 'assist: real data used as-is'}
                </div>
              )}
              {view.health.warnings.map((w) => <div key={w.code} className="warn">{w.text}</div>)}
            </>
          ) : <div className="muted">No snapshot yet. BEGIN REVEAL freezes the data.</div>}
        </div>
        <div className="panel">
          <h3>Projector</h3>
          <input readOnly value={screenUrl} aria-label="Projector link" onFocus={(e) => e.target.select()} />
          <div className="row">
            <button onClick={() => void navigator.clipboard?.writeText(screenUrl)}>Copy link</button>
            <a href={screenUrl} target="_blank" rel="noreferrer"><button>Open projector</button></a>
            <button disabled={!controlling} onClick={() => confirm('Rotate the projector key? Open projectors will disconnect.') && void call(socket, 'pres.rotateKey', { sessionId, leaseId: lease })}>Rotate key</button>
          </div>
        </div>
        <div className="panel">
          <h3>Phone backup</h3>
          <div className="muted">Scan to control from a phone (log in with the admin key, then Take control).</div>
          {qr && <img src={qr} alt="Presenter console QR" width={140} height={140} />}
        </div>
        {!pre && <QuestionPanel view={view} disabled={!controlling} send={send} />}
        {view.mode === 'test' && <Rehearsal disabled={!controlling} onRun={(scenario, n, seed, profile) => void send({ t: 'demo', scenario, n, seed, profile })} />}
        <ConceptEditor socket={socket} sessionId={sessionId} leaseId={lease} initial={view.conceptConfig} />
      </div>
      {help && (
        <div className="overlay" onClick={() => setHelp(false)} data-testid="help">
          <div className="panel">
            <h3>Shortcuts</h3>
            <table><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

export type { PresenterView, SceneId };
export const SCENE_COUNT = SCENES.length;
