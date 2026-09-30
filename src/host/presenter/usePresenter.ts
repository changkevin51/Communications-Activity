import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { PresenterView, RevealData } from '../../shared/reveal';
import { call } from '../api';

export type Cmd = Record<string, unknown> & { t: string };

function leaseId() {
  let id = sessionStorage.getItem('ss.lease');
  if (!id) {
    id = `lease-${crypto.getRandomValues(new Uint32Array(3)).join('')}`;
    sessionStorage.setItem('ss.lease', id);
  }
  return id;
}

export function usePresenter(socket: Socket, sessionId: string) {
  const lease = useRef(leaseId()).current;
  const [view, setView] = useState<PresenterView | null>(null);
  const [data, setData] = useState<RevealData | null>(null);
  const [toast, setToast] = useState('');
  const viewRef = useRef<PresenterView | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const execRef = useRef<(c: Cmd | null) => Promise<boolean>>(async () => false);

  const accept = useCallback((v: PresenterView | null) => {
    if (!v || v.sessionId !== sessionId) return;
    if (viewRef.current && v.rev < viewRef.current.rev) return;
    viewRef.current = v;
    setView(v);
  }, [sessionId]);

  const open = useCallback(async () => {
    const r = await call<{ view: PresenterView }>(socket, 'pres.open', { sessionId, leaseId: lease });
    if (r.ok) {
      viewRef.current = null;
      accept(r.view);
    } else setToast(r.reason);
  }, [socket, sessionId, lease, accept]);

  useEffect(() => {
    const onView = (v: PresenterView) => accept(v);
    socket.on('presenterView', onView);
    socket.on('connect', open);
    void open();
    return () => {
      socket.off('presenterView', onView);
      socket.off('connect', open);
    };
  }, [socket, open, accept]);

  const hash = view?.dataHash ?? null;
  useEffect(() => {
    if (!hash) return setData(null);
    let live = true;
    void call<{ hash: string | null; data: RevealData | null }>(socket, 'pres.data', { sessionId }).then((r) => {
      if (live && r.ok && r.hash === hash) setData(r.data);
    });
    return () => void (live = false);
  }, [hash, socket, sessionId]);

  const send = useCallback(
    (cmd: Cmd | ((v: PresenterView) => Cmd)) => {
      if (pending.current >= 3) return Promise.resolve(false);
      pending.current++;
      const run = chain.current
        .then(() => execRef.current(typeof cmd === 'function' ? (viewRef.current ? cmd(viewRef.current) : null) : cmd))
        .finally(() => pending.current--);
      chain.current = run.catch(() => false);
      return run;
    },
    [],
  );

  const exec = async (cmd: Cmd | null) => {
      const v = viewRef.current;
      if (!v || !cmd) return false;
      try {
        const payload = cmd.t === 'take' ? cmd : { ...cmd, rev: v.rev };
        const r = await call<{ view: PresenterView; changed: boolean }>(socket, 'pres.cmd', { sessionId, leaseId: lease, cmd: payload });
        if (r.ok) {
          accept(r.view);
          return true;
        }
        const msg: Record<string, string> = {
          STALE: 'Someone else moved the show — refreshed.',
          NOT_CONTROLLER: 'Another console has control. Take control to drive.',
          NO_SNAPSHOT: 'BEGIN REVEAL first (hold the button, or Enter twice).',
          GUARD: 'That scene is not available.',
          LIVE_SESSION: 'Rehearsal data only works in test sessions.',
          RATE_LIMIT: 'Slow down a little.',
        };
        setToast(msg[r.reason] ?? r.reason);
        if (r.reason === 'STALE') await open();
        return false;
      } catch {
        return false;
      }
  };

  execRef.current = exec;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return { view, data, send, lease, toast, setToast, socket };
}
