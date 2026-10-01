import type { RevealData } from '../shared/reveal';
import { roleAt, type Part3Scene, type PromptResult } from '../shared/discussion';
import { PIPELINE, PROMPTS } from '../shared/discussionContent';
import { bars, feelWord } from './part3Copy';
import type { StageState } from './Stage';

function SplitBar({ r, focus }: { r: PromptResult; focus: number | null | undefined }) {
  const bs = bars(r);
  return (
    <div className="p3-bars" data-testid="p3-bars">
      {bs.map((b, i) => (
        <div key={b.id} className={`p3-bar ${focus === i ? 'focus' : focus !== null && focus !== undefined ? 'dim' : ''}`}>
          <div className="p3-bar-label mono">{b.label}</div>
          <div className="p3-bar-track"><span style={{ width: `${Math.max(0, b.pct)}%` }} /></div>
          <div className="p3-bar-val mono">{b.pct < 0 ? '—' : `${b.pct}%`}</div>
        </div>
      ))}
    </div>
  );
}

function Rooms({ r, pin, focus }: { r: PromptResult; pin?: string; focus: number | null | undefined }) {
  const spec = PROMPTS[r.prompt];
  const anchors = spec.anchors ?? ['Not good at all', 'Really good'];
  return (
    <div className="p3-rooms" data-testid="p3-rooms">
      <div className="p3-rooms-q">
        {pin && <span className="p3-pin mono">{pin}</span>}
        <div className="p3-rooms-body">{spec.body}</div>
      </div>
      <div className="p3-rows">
        {(r.sliders ?? []).map((s, i) => {
          const sl = spec.sliders?.find((x) => x.id === s.id);
          const labelStyle = { left: `${s.median}%` };
          return (
            <div key={s.id} className={`p3-row ${focus === i ? 'focus' : focus !== null && focus !== undefined ? 'dim' : ''}`} data-testid="p3-row">
              <div className="p3-row-title">
                <div>{sl?.label ?? s.id}</div>
                {sl?.sub && <div className="p3-row-sub mono">{sl.sub}</div>}
              </div>
              <div className="p3-slider-scale">
                <div className="p3-feel-word display" style={labelStyle}>{feelWord(s.median)}</div>
                <div className="p3-slider-track">
                  <span className="p3-slider-range" style={{ left: `${s.q1}%`, width: `${Math.max(0, s.q3 - s.q1)}%` }} />
                  <span className="p3-slider-thumb" style={labelStyle} />
                </div>
                <div className="p3-slider-number mono" style={labelStyle}>{Math.round(s.median)}/100</div>
                <div className="p3-row-anchors mono"><span>{anchors[0]}</span><span>{anchors[1]}</span></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p3-slider-legend mono"><span>● MIDDLE ANSWER</span><span>▬ WHERE THE MIDDLE HALF OF THE CLASS SLID</span></div>
    </div>
  );
}

function Pipeline({ beat }: { beat: number }) {
  const today = PIPELINE.today;
  const feed = PIPELINE.feed;
  return (
    <div className="p3-pipe" data-testid="p3-pipe">
      {today.map((t, i) => (
        <div key={i} className={`p3-box ${beat >= 1 && i === 1 ? 'swap' : ''}`}>
          <span>{beat >= 1 ? feed[i] : t}</span>
        </div>
      ))}
      {beat >= 2 && <div className="p3-examples mono">{PIPELINE.examples.join(' · ')}</div>}
    </div>
  );
}

export function Part3Viz({ st }: { st: StageState; d: RevealData | null }) {
  const scene = st.scene as Part3Scene;
  const role = roleAt(scene, st.beat);
  if (scene === 'chooser' && role !== 'concept') return <Pipeline beat={st.beat} />;
  const r = st.q?.result;
  if (st.hide || !r || r.small || (role !== 'reveal' && role !== 'discuss')) return null;
  if (r.counts) return <SplitBar r={r} focus={st.focus} />;
  if (r.sliders) return <Rooms r={r} pin={scene === 'switch' ? '78%' : scene === 'mirrors' ? 'B+' : undefined} focus={st.focus} />;
  return null;
}
