import type { RevealData } from '../shared/reveal';
import { roleAt, type Part3Scene, type PromptResult } from '../shared/discussion';
import { PIPELINE, PROMPTS } from '../shared/discussionContent';
import { bars } from './part3Copy';
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

/** Slider medians and middle-half ranges, one column per context. */
function Rooms({ r, pin, focus }: { r: PromptResult; pin?: string; focus: number | null | undefined }) {
  const spec = PROMPTS[r.prompt];
  return (
    <div className="p3-rooms" data-testid="p3-rooms">
      {pin && <div className="p3-pin mono">{pin}</div>}
      <div className="p3-cols">
        {(r.sliders ?? []).map((s, i) => {
          const sl = spec.sliders?.find((x) => x.id === s.id);
          return (
            <div key={s.id} className={`p3-col ${focus === i ? 'focus' : focus !== null && focus !== undefined ? 'dim' : ''}`}>
              <div className="p3-col-track">
                <span className="p3-iqr" style={{ bottom: `${s.q1}%`, height: `${Math.max(1, s.q3 - s.q1)}%` }} />
                <span className="p3-med" style={{ bottom: `${s.median}%` }} />
              </div>
              <div className="p3-col-val mono">{Math.round(s.median)}</div>
              <div className="p3-col-label mono">{sl?.short ?? s.id}</div>
              {sl?.sub && <div className="p3-col-sub mono">{sl.sub}</div>}
            </div>
          );
        })}
      </div>
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
