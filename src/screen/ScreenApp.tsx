import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { RevealData, ScreenState } from '../shared/reveal';
import { Stage } from './Stage';

declare const __TEST_HOOKS__: boolean;
type Hooks = { state?: ScreenState; data?: RevealData | null; frames: number[] };

function credentials() {
  const code = (location.pathname.split('/')[2] ?? '').toUpperCase();
  const m = /k=([^&]+)/.exec(location.hash);
  const store = `ss.screen.${code}`;
  if (m) {
    sessionStorage.setItem(store, decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname);
  }
  return { code, key: sessionStorage.getItem(store) ?? '' };
}

export function ScreenApp() {
  const [st, setSt] = useState<ScreenState | null>(null);
  const [data, setData] = useState<RevealData | null>(null);
  const [online, setOnline] = useState(false);
  const [denied, setDenied] = useState(false);
  const hashRef = useRef<string | null>(null);

  useEffect(() => {
    const { code, key } = credentials();
    const s = io('/s', { auth: { code, key }, transports: ['websocket', 'polling'] });
    const cache = new Map<string, RevealData>();
    const hooks: Hooks | null = __TEST_HOOKS__ ? ((window as unknown as { __screen: Hooks }).__screen = { frames: [] }) : null;
    let last = 0;
    s.on('connect', () => (setOnline(true), setDenied(false)));
    s.on('disconnect', (reason) => {
      setOnline(false);
      if (reason === 'io server disconnect') setTimeout(() => s.connect(), 1000);
    });
    s.on('connect_error', (e) => {
      if (e.message === 'UNAUTHORIZED') setDenied(true);
    });
    s.on('screen', async (next: ScreenState) => {
      if (next.rev < last) return;
      last = next.rev;
      const h = next.dataHash;
      if (h && h !== hashRef.current) {
        let d = cache.get(h);
        if (!d) {
          const res = (await s.timeout(8000).emitWithAck('need', { hash: h }).catch(() => null)) as { ok: boolean; data: RevealData } | null;
          if (res?.ok) cache.set(h, (d = res.data));
        }
        if (next.rev < last) return;
        hashRef.current = h;
        setData(d ?? null);
        if (hooks) hooks.data = d ?? null;
      } else if (!h) {
        hashRef.current = null;
        setData(null);
        if (hooks) hooks.data = null;
      }
      setSt(next);
      if (hooks) hooks.state = next;
    });
    let raf = 0;
    if (hooks) {
      let prev = performance.now();
      const tick = (t: number) => {
        hooks.frames.push(t - prev);
        if (hooks.frames.length > 2000) hooks.frames.splice(0, 1000);
        prev = t;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => (cancelAnimationFrame(raf), void s.close());
  }, []);

  if (denied && !st)
    return (
      <div className="screen-msg">
        <div className="kicker">SIGNAL SHIFT</div>
        <div className="h-mid">This projector link is not valid.</div>
        <p>Open it again from the presenter console.</p>
      </div>
    );
  if (!st) return <div className="screen-msg"><div className="kicker">SIGNAL SHIFT</div><div className="h-mid">Connecting…</div></div>;
  return (
    <>
      <Stage st={st} data={data} />
      <div className={`conn ${online ? 'on' : 'off'}`} data-testid="conn" aria-label={online ? 'connected' : 'reconnecting'} />
    </>
  );
}
