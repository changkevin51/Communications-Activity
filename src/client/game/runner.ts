import type { Round, RoundSpec } from '../../shared/game/types';
import { CUE_MS, FEEDBACK_MS, GAP_MS } from '../../shared/game/specs';
import { glyphSvg } from './glyph';
import { attachInput } from './input';

declare const __TEST_HOOKS__: boolean;

export type Phase = 'cue' | 'study' | 'mask' | 'test' | 'feedback' | 'gap';
export type RoundOutcome =
  | { interrupted: false; tapped: number | null; rtMs: number | null; studyMs: number; maskMs: number; correct: boolean }
  | { interrupted: true };

export type RunOpts = { studyScale: number; onPhase?: (p: Phase) => void; showFeedback?: boolean };

function build(el: HTMLElement, round: Round) {
  const n = round.grid * round.grid;
  let html = '';
  for (let i = 0; i < n; i++) {
    const hook = __TEST_HOOKS__ && i === round.target ? ' data-changed="1"' : '';
    html += `<div class="cell" data-cell="${i}"${hook}><div class="la">${glyphSvg(round.A[i])}</div><div class="lm"></div><div class="lb">${glyphSvg(round.B[i])}</div></div>`;
  }
  el.style.setProperty('--grid', String(round.grid));
  el.innerHTML = html;
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

async function waitUntil(t: number, abort: () => boolean): Promise<number> {
  for (;;) {
    const now = await nextFrame();
    if (abort()) return now;
    if (now >= t) return now;
  }
}

export async function runRound(el: HTMLElement, spec: RoundSpec, round: Round, opts: RunOpts): Promise<RoundOutcome> {
  let hidden = document.visibilityState === 'hidden';
  const onVis = () => {
    if (document.visibilityState === 'hidden') hidden = true;
  };
  document.addEventListener('visibilitychange', onVis);
  const setPhase = (p: Phase) => {
    el.dataset.phase = p;
    opts.onPhase?.(p);
  };
  try {
    setPhase('cue');
    build(el, round);
    const t0 = await nextFrame();
    await waitUntil(t0 + CUE_MS, () => hidden);
    if (hidden) return { interrupted: true };

    setPhase('study');
    const studyStart = await nextFrame();
    await waitUntil(studyStart + spec.studyMs * opts.studyScale, () => hidden);
    if (hidden) return { interrupted: true };

    setPhase('mask');
    const maskStart = await nextFrame();
    const studyMs = Math.round(maskStart - studyStart);
    await waitUntil(maskStart + spec.maskMs, () => hidden);
    if (hidden) return { interrupted: true };

    setPhase('test');
    const onset = await nextFrame();
    const maskMs = Math.round(onset - maskStart);
    const tap = await new Promise<{ cell: number; rt: number } | null | 'hidden'>((resolve) => {
      let done = false;
      const finish = (v: { cell: number; rt: number } | null | 'hidden') => {
        if (done) return;
        done = true;
        detach();
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', vis);
        resolve(v);
      };
      const detach = attachInput(el, onset, (cell, rt) => finish({ cell, rt }));
      const timer = Number.isFinite(spec.timeoutMs) ? setTimeout(() => finish(null), spec.timeoutMs) : undefined;
      const vis = () => document.visibilityState === 'hidden' && finish('hidden');
      document.addEventListener('visibilitychange', vis);
    });
    if (tap === 'hidden') return { interrupted: true };

    const correct = tap !== null && tap.cell === round.target;
    const cells = el.querySelectorAll<HTMLElement>('.cell');
    if (opts.showFeedback !== false) {
      if (tap) cells[tap.cell]?.classList.add(correct ? 'hit' : 'miss');
      if (!correct) cells[round.target]?.classList.add('truth');
      if (!tap) el.dataset.timeout = '1';
    }
    setPhase('feedback');
    const fb = await nextFrame();
    await waitUntil(fb + FEEDBACK_MS, () => false);
    delete el.dataset.timeout;
    setPhase('gap');
    el.innerHTML = '';
    const g = await nextFrame();
    await waitUntil(g + GAP_MS, () => false);
    return {
      interrupted: false,
      tapped: tap ? tap.cell : null,
      rtMs: tap ? Math.min(60000, Math.max(0, Math.round(tap.rt))) : null,
      studyMs: Math.min(60000, studyMs),
      maskMs: Math.min(60000, maskMs),
      correct,
    };
  } finally {
    document.removeEventListener('visibilitychange', onVis);
  }
}
