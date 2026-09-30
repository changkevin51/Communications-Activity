import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { RevealData, ScreenState } from '../shared/reveal';
import { compareCopy, fmt, footnote, onegameCaption, selfRatingCaption, worldsCaption, mechanismLine } from '../shared/revealCopy';
import { H, W } from './layout';
import { Field } from './Field';
import { Decor } from './Decor';
import { targetsFor } from './targets';
import { plainFrame } from './plain';

export type StageState = Pick<ScreenState, 'scene' | 'beat' | 'nonce' | 'hold' | 'plain' | 'motion' | 'source' | 'mode' | 'live' | 'concept' | 'late'>;

const DECOR_SCENES = ['onegame', 'selfrating', 'samescore', 'worlds', 'movement', 'compare'];

export function captionFor(st: StageState, d: RevealData | null): string | null {
  if (!d) return null;
  const b = st.beat;
  switch (st.scene) {
    case 'onegame':
      return b === 0 ? onegameCaption(d) : b === 1 ? `Average ${fmt(d.scores.mean)} · middle ${fmt(d.scores.median)}` : 'Every score was calculated by the server from the same rounds.';
    case 'selfrating':
      return !d.selfRating.ok ? 'Not enough ratings yet to show.' : b === 0 ? 'Each dot: your score (across) and your first self-rating (up).' : `Average self-rating ${fmt(d.selfRating.mean, 'r1')} / 100. ${selfRatingCaption(d) ?? ''}`.trim();
    case 'samescore':
      return b >= 3 ? 'Same score. Different context. Different meaning.' : d.samescore?.mode === 'illustration' ? 'An illustration.' : d.samescore?.mode === 'example' ? 'An example built from this room’s real scores.' : null;
    case 'worlds':
      return b >= 1 ? worldsCaption(d) : null;
    case 'movement':
      return d.n.paired < 3 ? `${d.n.paired} people rated twice.` : b === 0 ? 'Rating 0–100, before seeing anyone.' : null;
    case 'compare':
      return b === 0 ? 'Average change in self-rating, points out of 100.' : b === 1 ? compareCopy(d).support : `One class, ${d.n.paired} people. A real study would repeat this many times.`;
    case 'mechanism':
      return b >= 1 ? mechanismLine(d) : null;
    default:
      return null;
  }
}

function useQr(text: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: 520, color: { dark: '#0B0C10', light: '#F4F1EA' } }).then((u) => live && setSrc(u), () => {});
    return () => void (live = false);
  }, [text]);
  return src;
}

function Watermark({ st }: { st: StageState }) {
  const text = st.source === 'demo' ? 'REHEARSAL · SYNTHETIC DATA' : st.mode === 'test' ? 'TEST SESSION' : null;
  return text ? <div className="watermark" data-testid="watermark">{text}</div> : null;
}

function Frame({ st, d, origin, still }: { st: StageState; d: RevealData | null; origin: string; still?: boolean }) {
  const pf = plainFrame(st, d);
  const targets = useMemo(() => (st.plain ? [] : targetsFor(st.scene, st.beat, d)), [st.scene, st.beat, st.plain, d]);
  const joinUrl = st.live ? `${origin}/${st.live.code}` : null;
  const qr = useQr(st.scene === 'lobby' ? joinUrl : null);
  const decor = !st.plain && DECOR_SCENES.includes(st.scene) && d;
  const note = d && !['lobby', 'playing', 'hold', 'end', 'concept'].includes(st.scene) ? footnote(d) : null;

  if (st.scene === 'lobby') {
    return (
      <div className="frame lobby">
        <div className="kicker">SIGNAL SHIFT</div>
        <div className="lobby-grid">
          <div>
            <div className="h-huge">TUNE IN</div>
            <div className="join mono">{joinUrl?.replace(/^https?:\/\//, '')}</div>
            <div className="code mono" data-testid="room-code">{st.live?.code}</div>
            <div className="count mono">{fmt(st.live?.joined ?? 0)} joined</div>
          </div>
          {qr && !st.plain && <img className="qr-img" src={qr} alt="Join QR code" />}
        </div>
      </div>
    );
  }
  if (st.scene === 'playing') {
    const l = st.live;
    const total = Math.max(1, l?.started ?? 0);
    return (
      <div className="frame">
        <div className="kicker">{pf.kicker}</div>
        <div className="h-big">SIGNAL IN PROGRESS</div>
        <div className="progress">
          <span style={{ width: `${((l?.done ?? 0) / total) * 100}%` }} className="p-done" />
          <span style={{ width: `${((l?.rating ?? 0) / total) * 100}%` }} className="p-rating" />
        </div>
        <div className="lines mono">{pf.lines[0]}</div>
      </div>
    );
  }
  const textOnly = !decor;
  return (
    <div className={`frame ${textOnly ? 'text-only' : ''} scene-${st.scene}`}>
      {!st.plain && <Field targets={targets} motion={st.motion} still={still} replay={st.nonce} />}
      {decor && <Decor scene={st.scene} beat={st.beat} d={d} />}
      <div className="head">
        {pf.kicker && <div className="kicker">{pf.kicker}</div>}
        <div className={textOnly ? 'h-big' : 'h-mid'} data-testid="headline">{pf.headline}</div>
        {textOnly && pf.lines.map((l, i) => <div key={i} className="lines">{l}</div>)}
        {!textOnly && captionFor(st, d) && <div className="caption">{captionFor(st, d)}</div>}
      </div>
      {note && <div className="footnote mono">{note}</div>}
    </div>
  );
}

export function Stage({ st, data, width, still, origin }: { st: StageState; data: RevealData | null; width?: number; still?: boolean; origin?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ s: width ? width / W : 1, w: width ?? W, h: width ? (width * H) / W : H });
  useLayoutEffect(() => {
    if (width) return setFit({ s: width / W, w: width, h: (width * H) / W });
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const s = Math.min(el.clientWidth / W, el.clientHeight / H) || 1;
      setFit({ s, w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const o = origin ?? (typeof location !== 'undefined' ? location.origin : '');
  return (
    <div ref={box} className={`stage-box ${width ? 'preview' : ''}`} style={width ? { width, height: fit.h } : undefined}>
      <div
        className={`stage motion-${st.motion}`}
        data-scene={st.scene}
        data-beat={st.beat}
        style={{ width: W, height: H, transform: `translate(${(fit.w - W * fit.s) / 2}px, ${(fit.h - H * fit.s) / 2}px) scale(${fit.s})` }}
      >
        <Frame st={st} d={data} origin={o} still={still} />
        <Watermark st={st} />
        {st.hold && <div className="hold" data-testid="hold" />}
      </div>
    </div>
  );
}
