import { useEffect, useMemo, useState } from 'react';
import { CODE_RE } from '../shared/code';
import type { Ack } from '../shared/protocol';
import { Connection } from './net/connection';
import { useConn } from './net/useView';
import { getItem, setItem } from './storage';
import { ReconnectPill } from './ui/ReconnectPill';
import { Join } from './screens/Join';
import { Identity } from './screens/Identity';
import { Tutorial } from './screens/Tutorial';
import { Game, type GameResult } from './screens/Game';
import { Result } from './screens/Result';
import { Rating } from './screens/Rating';
import { Calibrating } from './screens/Calibrating';
import { Recap } from './screens/Recap';
import { Done } from './screens/Done';
import { Problem } from './screens/Problem';
import { Prompt } from './screens/Prompt';

function codeFromPath(): string | null {
  const seg = location.pathname.replace(/^\/+|\/+$/g, '').toUpperCase();
  return CODE_RE.test(seg) ? seg : null;
}

export function App() {
  const [code, setCode] = useState<string | null>(codeFromPath);
  if (!code) {
    return (
      <Join
        onCode={(c) => {
          history.replaceState(null, '', `/${c}`);
          setCode(c);
        }}
      />
    );
  }
  return <Room key={code} code={code} onLeave={() => (history.replaceState(null, '', '/'), setCode(null))} />;
}

function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  const conn = useMemo(() => new Connection(code), [code]);
  const { status, view } = useConn(conn);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const localKey = `ss.l.${code}`;
  const [local, setLocal] = useState(() => getItem(localKey) ?? '');
  const [, force] = useState(0);
  const step = (s: string) => {
    setItem(localKey, s);
    setLocal(s);
  };

  useEffect(() => {
    if (!view?.recap) return;
    const ms = view.recap.revealAt - conn.serverNow();
    if (ms <= 0) return;
    const t = setTimeout(() => force((n) => n + 1), ms + 20);
    return () => clearTimeout(t);
  }, [view?.recap, conn]);

  const send = async (event: string, payload: unknown) => {
    setBusy(true);
    const res: Ack = await conn.send(event, payload);
    setBusy(false);
    if (!res.ok && res.reason !== 'WRONG_STAGE') setProblem(true);
    return res;
  };

  if (status === 'no_room') return <Problem title="No such room." body={`We couldn't find room ${code}. Check the code on the screen.`} action="Try another code" onAction={onLeave} />;
  if (status === 'closed' && !view) return <Problem title="Room closed." body="This room isn't taking new players right now." action="Try another code" onAction={onLeave} />;
  if (!view) return <Problem title="Tuning in…" body="Finding the signal." />;
  const pill = <ReconnectPill show={status === 'offline'} />;
  if (problem) return <Problem title="Signal dropped." body="Something went wrong on our side. Tap to try again." action="Retry" onAction={() => location.reload()} />;

  const st = view.me.stage;
  let screen;
  if (st === 'removed') screen = <Problem title="Signal ended." body="This run was reset by the host." />;
  else if (st === 'joined') {
    if (local !== 'tutorial') screen = <Identity codename={view.me.codename} sigil={view.me.sigil} onNext={() => step('tutorial')} />;
    else screen = <Tutorial seed={view.game!.seed} busy={busy} onDone={(practice) => void send('start', { practice })} />;
  } else if (st === 'playing') {
    screen = <Game seed={view.game!.seed} studyScale={view.game!.studyScale} onDone={(r: GameResult) => void send('finish', r)} />;
  } else if (st === 'scored') {
    if (local !== 'rate1') screen = <Result view={view} onNext={() => step('rate1')} />;
    else screen = <Rating key="before" view={view} busy={busy} onSubmit={(v) => void send('rate', { phase: 'before', ...v })} />;
  } else if (st === 'rated_before') screen = <Calibrating view={view} serverNow={() => conn.serverNow()} />;
  else if (st === 'assigned') {
    if (view.recap && view.recap.revealAt > conn.serverNow()) screen = <Calibrating view={view} serverNow={() => conn.serverNow()} />;
    else screen = <Recap view={view} busy={busy} onDone={(dialDwellMs) => void send('seen', { dialDwellMs })} />;
  } else if (st === 'recap_seen') screen = <Rating key="after" view={view} busy={busy} onSubmit={(v) => void send('rate', { phase: 'after', ...v })} />;
  else screen = <Done view={view} />;
  const pr = view.room.prompt;
  if (pr && !pr.answered && (st === 'done' || st === 'joined')) screen = <Prompt key={`${pr.id}:${pr.run}`} view={view} prompt={pr} send={(e, p) => conn.send(e, p)} />;
  return (
    <>
      {pill}
      {view.room.screen && view.room.screen !== 'end' && st !== 'done' && st !== 'removed' && (
        <div className="late-banner mono" role="status" data-testid="late-banner">The main screen has started. Finish when you're ready.</div>
      )}
      {screen}
    </>
  );
}
