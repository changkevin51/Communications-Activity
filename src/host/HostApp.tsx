import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { call, connectHost, type SessionItem } from './api';
import { SessionPanel } from './SessionPanel';
import { Presenter } from './presenter/Presenter';

const presentId = () => /present=([A-Za-z0-9_-]+)/.exec(location.hash)?.[1] ?? null;

const KEY = 'ss.host.key';

export function HostApp() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY) ?? '');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [present, setPresent] = useState<string | null>(presentId);
  useEffect(() => {
    const on = () => setPresent(presentId());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = async (s: Socket) => {
    const r = await call<{ sessions: SessionItem[] }>(s, 'sessions');
    if (r.ok) setSessions(r.sessions);
  };

  const login = (k: string) => {
    socket?.close();
    const s = connectHost(k);
    s.on('connect', () => {
      localStorage.setItem(KEY, k);
      setError('');
      setSocket(s);
      void refresh(s);
    });
    s.on('connect_error', (e) => {
      if (e.message === 'UNAUTHORIZED') {
        setError('Wrong key');
        s.close();
        setSocket(null);
      }
    });
  };

  useEffect(() => {
    if (key) login(key);
  }, []);

  if (!socket) {
    return (
      <div className="wrap">
        <h1>Signal Shift · Host</h1>
        <form className="row" onSubmit={(e) => (e.preventDefault(), login(key))}>
          <input type="password" placeholder="Admin key" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Admin key" />
          <button className="primary" type="submit">Log in</button>
          <span className="err">{error}</span>
        </form>
      </div>
    );
  }

  if (present) return <Presenter socket={socket} sessionId={present} onExit={() => (history.replaceState(null, '', location.pathname), setActive(present), setPresent(null))} />;

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1>Signal Shift · Host</h1>
        <button onClick={() => (localStorage.removeItem(KEY), socket.close(), setSocket(null), setKey(''))}>Log out</button>
      </div>
      <div className="grid">
        <div>
          <NewSession socket={socket} onCreated={(id) => (void refresh(socket), setActive(id))} />
          <div className="panel sessions">
            <h3>Sessions</h3>
            {sessions.map((s) => (
              <button key={s.id} className={s.id === active ? 'active' : ''} onClick={() => setActive(s.id)}>
                <b className="mono">{s.code}</b> {s.label} <span className="muted">· {s.mode} · {s.phase} · {s.players}</span>
              </button>
            ))}
            {!sessions.length && <div className="muted">No sessions yet.</div>}
          </div>
        </div>
        <div>
          {active ? (
            <SessionPanel key={active} socket={socket} sessionId={active} adminKey={key} onDeleted={() => (setActive(null), void refresh(socket))} onChanged={() => void refresh(socket)} />
          ) : (
            <div className="panel muted">Select or create a session.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewSession({ socket, onCreated }: { socket: Socket; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'live' | 'test'>('test');
  const [adv, setAdv] = useState(false);
  const [studyScale, setStudyScale] = useState(1);
  const [countdownMs, setCountdownMs] = useState(3500);
  const [assignMode, setAssignMode] = useState<'release' | 'instant'>('release');
  const [ghostPolicy, setGhostPolicy] = useState<'fill' | 'off'>('fill');
  const [err, setErr] = useState('');
  const create = async () => {
    const r = await call<{ session: { id: string } }>(socket, 'create', { label, mode, config: { studyScale, countdownMs, assignMode, ghostPolicy } });
    if (r.ok) {
      setLabel('');
      onCreated(r.session.id);
    } else setErr(r.reason);
  };
  return (
    <div className="panel">
      <h3>New session</h3>
      <div className="row">
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'live' | 'test')} aria-label="Mode">
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
        <button className="primary" onClick={() => void create()}>Create</button>
      </div>
      <button style={{ marginTop: 8 }} onClick={() => setAdv(!adv)}>{adv ? 'Hide' : 'Advanced'}</button>
      {adv && (
        <div className="row" style={{ marginTop: 8 }}>
          <label>studyScale<input type="number" step="0.05" min="0.3" max="3" value={studyScale} onChange={(e) => setStudyScale(Number(e.target.value))} /></label>
          <label>countdownMs<input type="number" step="500" min="0" max="15000" value={countdownMs} onChange={(e) => setCountdownMs(Number(e.target.value))} /></label>
          <label>assignMode<select value={assignMode} onChange={(e) => setAssignMode(e.target.value as 'release' | 'instant')}><option>release</option><option>instant</option></select></label>
          <label>ghostPolicy<select value={ghostPolicy} onChange={(e) => setGhostPolicy(e.target.value as 'fill' | 'off')}><option>fill</option><option>off</option></select></label>
        </div>
      )}
      <div className="err">{err}</div>
    </div>
  );
}
