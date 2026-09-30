import { useEffect, useRef, useState } from 'react';
import { generateRound } from '../../shared/game/generate';
import { ROUND_COUNT, SPECS, TIER_BREAKS } from '../../shared/game/specs';
import type { RoundSubmission } from '../../shared/game/scoring';
import { runRound, type Phase } from '../game/runner';
import { getJson, getItem, setItem, setJson } from '../storage';

export type GameResult = { rounds: RoundSubmission[]; interruptions: number; restarted?: boolean };
type Saved = { rounds: RoundSubmission[]; replays: Record<number, number>; interruptions: number; restarted?: boolean };

const LABEL: Partial<Record<Phase, string>> = { study: 'Memorize', mask: '—', test: 'What changed?' };
const MAX_REPLAYS = 2;

export function Game({ seed, studyScale, onDone }: { seed: string; studyScale: number; onDone: (r: GameResult) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState('');
  const [done, setDone] = useState(0);
  const [interstitial, setInterstitial] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const resume = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `ss.g.${seed}`;
    const startedKey = `ss.gs.${seed}`;
    let saved = getJson<Saved>(key);
    if (!saved) {
      saved = { rounds: [], replays: {}, interruptions: 0 };
      if (getItem(startedKey)) saved.restarted = true;
      setItem(startedKey, '1');
    }
    const st = saved;
    const save = () => setJson(key, st);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      if (!st.rounds.length) {
        for (const n of ['3', '2', '1']) {
          setInterstitial(n);
          await sleep(500);
        }
        setInterstitial(null);
      }
      while (st.rounds.length < ROUND_COUNT && !cancelled) {
        const idx = st.rounds.length;
        setDone(idx);
        if (idx in TIER_BREAKS && st.rounds.length && !st.replays[idx]) {
          setInterstitial(TIER_BREAKS[idx]);
          await sleep(700);
          setInterstitial(null);
        }
        const replays = st.replays[idx] ?? 0;
        const variant = replays + (st.restarted ? 10 : 0);
        const spec = SPECS[idx];
        const out = await runRound(board.current!, spec, generateRound(seed, idx, variant), {
          studyScale,
          onPhase: (p) => setLabel(LABEL[p] ?? ''),
        });
        if (cancelled) return;
        if (out.interrupted) {
          st.interruptions++;
          if (replays >= MAX_REPLAYS) {
            st.rounds.push({ idx, variant, tapped: null, rtMs: null, studyMs: 0, maskMs: 0 });
          } else {
            st.replays[idx] = replays + 1;
          }
          save();
          if (board.current) board.current.innerHTML = '';
          setPaused(true);
          await new Promise<void>((r) => (resume.current = r));
          setPaused(false);
          continue;
        }
        st.rounds.push({ idx, variant, tapped: out.tapped, rtMs: out.rtMs, studyMs: out.studyMs, maskMs: out.maskMs });
        save();
      }
      if (!cancelled) {
        setDone(ROUND_COUNT);
        onDone({ rounds: st.rounds, interruptions: st.interruptions, restarted: st.restarted });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seed, studyScale]);

  return (
    <main className="screen">
      <div className="rail" aria-hidden="true">
        {Array.from({ length: ROUND_COUNT }, (_, i) => <i key={i} className={i < done ? 'on' : ''} />)}
      </div>
      <div className="topline mono" style={{ marginTop: 10 }}>
        <span data-testid="round">Round {String(Math.min(done + 1, ROUND_COUNT)).padStart(2, '0')}/{ROUND_COUNT}</span>
        <span>Signal</span>
      </div>
      <div className="body">
        <div className="phase-label" aria-live="off">{label}</div>
        <div ref={board} className="board" data-testid="board" />
      </div>
      <div style={{ height: 'calc(var(--bar-h) + var(--safe-b))' }} />
      {interstitial && (
        <div className="overlay" aria-live="polite">
          <div className="big-count">{interstitial}</div>
        </div>
      )}
      {paused && (
        <button type="button" className="overlay" onClick={() => resume.current?.()} data-testid="resume">
          <div className="display h2">Paused</div>
          <div className="mono">Tap to resume</div>
        </button>
      )}
    </main>
  );
}
