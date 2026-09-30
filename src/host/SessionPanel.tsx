import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { call, download, type HostView } from './api';
import { Internals } from './Internals';

type Props = { socket: Socket; sessionId: string; adminKey: string; onDeleted: () => void; onChanged: () => void };

const FUNNEL: [string, string][] = [
  ['joined', 'Joined'], ['playing', 'Playing'], ['scored', 'Scored'], ['rated_before', 'Waiting'],
  ['assigned', 'Assigned'], ['recap_seen', 'Recap seen'], ['done', 'Done'],
];

export function SessionPanel({ socket, sessionId, adminKey, onDeleted, onChanged }: Props) {
  const [view, setView] = useState<HostView | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [internals, setInternals] = useState(false);
  const [msg, setMsg] = useState('');
  const [bots, setBots] = useState({ n: 25, mean: 660, sd: 120 });

  useEffect(() => {
    const on = (v: HostView) => v.session.id === sessionId && setView(v);
    socket.on('hostView', on);
    const watch = () => void call<{ view: HostView }>(socket, 'watch', { sessionId }).then((r) => r.ok && setView(r.view));
    watch();
    socket.on('connect', watch);
    return () => {
      socket.off('hostView', on);
      socket.off('connect', watch);
    };
  }, [socket, sessionId]);

  const total = view?.total;
  const phase = view?.session.phase;
  useEffect(() => {
    if (total !== undefined) onChanged();
  }, [total, phase]);

  const joinUrl = view ? `${location.origin}/${view.session.code}` : '';
  useEffect(() => {
    if (joinUrl) void QRCode.toDataURL(joinUrl, { margin: 2, scale: 12, errorCorrectionLevel: 'M' }).then(setQr);
  }, [joinUrl]);

  if (!view) return <div className="panel muted">Loading…</div>;
  const s = view.session;
  const act = async (event: string, payload: Record<string, unknown> = {}) => {
    const r = await call(socket, event, { sessionId, ...payload });
    setMsg(r.ok ? `${event}: ok` : `${event}: ${r.reason}`);
    onChanged();
    return r;
  };
  const typed = (what: string) => prompt(`Type RESET to ${what} session ${s.code}`) === 'RESET';

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="mono">{s.code} <span className="muted">{s.label} · {s.mode} · {s.phase}</span></h2>
          <button onClick={() => setShowQr(true)}>Show QR</button>
          <button className="primary" data-testid="present" onClick={() => (location.hash = `present=${sessionId}`)}>Present</button>
        </div>
        <div className="row">
          <span className="mono">{joinUrl}</span>
          {qr && <a href={qr} download={`signal-shift-${s.code}.png`}><button>Download PNG</button></a>}
        </div>
      </div>
      <div className="panel">
        <h3>Funnel</h3>
        <div className="funnel">
          {FUNNEL.map(([k, label]) => <div key={k}><span className="muted">{label}</span><b>{view.funnel[k] ?? 0}</b></div>)}
          <div><span className="muted">Connected now</span><b>{view.connected}</b></div>
        </div>
      </div>
      <div className="panel">
        <h3>Release</h3>
        {s.phase === 'open' ? (
          <div className="row">
            <span>{view.waiting} of {view.finished} finished players are waiting ({view.total} joined).</span>
            <button className="primary" onClick={() => confirm(`Release ${view.waiting} waiting players?`) && void act('release')}>Release</button>
          </div>
        ) : (
          <div className="muted">{s.phase === 'released' ? 'Released. Late finishers are assigned automatically.' : 'Room closed.'}</div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          {s.phase === 'closed' ? <button onClick={() => void act('reopen')}>Reopen</button> : <button onClick={() => void act('close')}>Close room</button>}
          <button onClick={() => void download(adminKey, sessionId, 'json', s.code).catch((e: Error) => setMsg(e.message))}>Export JSON</button>
          <button onClick={() => void download(adminKey, sessionId, 'csv', s.code).catch((e: Error) => setMsg(e.message))}>Export CSV</button>
          <button className="danger" onClick={() => typed('reset') && void act('reset', { confirm: 'RESET' })}>Reset session</button>
          <button className="danger" onClick={() => typed('delete') && void act('delete', { confirm: 'RESET' }).then((r) => r.ok && onDeleted())}>Delete session</button>
        </div>
        <div className="muted mono" style={{ marginTop: 8 }}>{msg}</div>
      </div>
      {s.mode === 'test' && (
        <div className="panel">
          <h3>Test tools</h3>
          <div className="row">
            <label>N<input type="number" value={bots.n} min={1} max={200} onChange={(e) => setBots({ ...bots, n: Number(e.target.value) })} /></label>
            <label>mean<input type="number" value={bots.mean} onChange={(e) => setBots({ ...bots, mean: Number(e.target.value) })} /></label>
            <label>sd<input type="number" value={bots.sd} onChange={(e) => setBots({ ...bots, sd: Number(e.target.value) })} /></label>
            <button onClick={() => void act('bots.spawn', bots)}>Spawn bots</button>
            <button onClick={() => void act('bots.advance', { to: 'rated_before' })}>Bots → rated #1</button>
            <button onClick={() => void act('bots.advance', { to: 'done' })}>Bots → done</button>
            <button onClick={() => void act('bots.remove')}>Remove bots</button>
          </div>
        </div>
      )}
      <div className="panel">
        <label style={{ flexDirection: 'row', alignItems: 'center', color: 'var(--paper)' }}>
          <input type="checkbox" checked={internals} onChange={(e) => setInternals(e.target.checked)} /> Show internals
        </label>
        {internals && <Internals view={view} onRemove={(id) => confirm('Remove this participant?') && void call(socket, 'remove', { participantId: id })} />}
      </div>
      {showQr && qr && (
        <div className="qr" onClick={() => setShowQr(false)}>
          <img src={qr} alt={`QR code for ${joinUrl}`} />
          <div className="code mono">{s.code}</div>
          <div className="muted">{joinUrl.replace(/^https?:\/\//, '')}</div>
        </div>
      )}
    </div>
  );
}
