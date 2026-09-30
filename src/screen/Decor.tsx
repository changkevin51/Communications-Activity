import type { RevealData, SceneId, WorldKey } from '../shared/reveal';
import { WORLDS } from '../shared/reveal';
import { WORLD_ACADEMIC, WORLD_COLOR, WORLD_GLYPH, WORLD_PLAIN, fmt } from '../shared/revealCopy';
import { H, LANES, SAFE, W, laneX, ratingY, scale, scoreX } from './layout';

const PAPER = '#F4F1EA';
const MUTE = '#8F93A3';

function ScoreAxis({ d, y = 760 }: { d: RevealData; y?: number }) {
  const x = scoreX(d);
  return (
    <g>
      <line x1={x(d.scoreAxis.lo)} x2={x(d.scoreAxis.hi)} y1={y} y2={y} stroke={MUTE} strokeWidth={2} />
      {d.scoreAxis.ticks.map((t) => (
        <text key={t} x={x(t)} y={y + 44} fill={MUTE} fontSize={26} textAnchor="middle" className="mono">{t}</text>
      ))}
      <text x={x(d.scoreAxis.hi)} y={y + 84} fill={MUTE} fontSize={22} textAnchor="end" className="mono">SCORE</text>
    </g>
  );
}

function Marker({ x, y0, y1, label }: { x: number; y0: number; y1: number; label: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={y0} y2={y1} stroke="#FF4F1F" strokeWidth={3} strokeDasharray="8 8" />
      <text x={x} y={y0 - 14} fill="#FF4F1F" fontSize={28} textAnchor="middle" className="mono">{label}</text>
    </g>
  );
}

function LaneHeads({ academic, y = 250 }: { academic: boolean; y?: number }) {
  return (
    <g>
      {LANES.map((w) => (
        <text key={w} x={laneX(w)} y={y} fill={WORLD_COLOR[w]} fontSize={34} textAnchor="middle" className="display">
          {WORLD_GLYPH[w]} {academic ? WORLD_ACADEMIC[w] : WORLD_PLAIN[w]}
        </text>
      ))}
    </g>
  );
}

function SameScore({ d, beat }: { d: RevealData; beat: number }) {
  const ss = d.samescore;
  if (!ss) return null;
  return (
    <g>
      {ss.members.map((m, i) => {
        const cx = SAFE.x0 + ((SAFE.x1 - SAFE.x0) * (i * 2 + 1)) / 6;
        return (
          <g key={m.world}>
            <rect x={cx - 230} y={330} width={460} height={560} fill="none" stroke={beat >= 2 ? WORLD_COLOR[m.world] : 'rgba(244,241,234,.25)'} strokeWidth={2} />
            <text x={cx} y={400} fill={MUTE} fontSize={26} textAnchor="middle" className="mono">{beat >= 1 ? `ROOM ${'ABC'[i]}` : 'PLAYER'}</text>
            <text x={cx} y={500} fill={PAPER} fontSize={110} textAnchor="middle" className="display">{fmt(m.score)}</text>
            {beat >= 2 && (
              <>
                <text x={cx} y={580} fill={WORLD_COLOR[m.world]} fontSize={28} textAnchor="middle" className="display">{WORLD_GLYPH[m.world]} {WORLD_PLAIN[m.world]}</text>
                {m.peers.map((p, j) => (
                  <text key={j} x={cx} y={660 + j * 64} fill={PAPER} fontSize={48} textAnchor="middle" className="mono" opacity={0.85}>{fmt(p.score)}</text>
                ))}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Compare({ d, beat }: { d: RevealData; beat: number }) {
  const vals = WORLDS.map((w) => d.worlds[w].meanDelta ?? 0);
  const ext = Math.max(4, ...vals.map((v) => Math.abs(v))) * 1.25;
  const y = scale(-ext, ext, beat >= 1 ? 900 : 860, beat >= 1 ? 560 : 360);
  const zero = y(0);
  return (
    <g>
      <line x1={SAFE.x0 + 120} x2={SAFE.x1 - 120} y1={zero} y2={zero} stroke={MUTE} strokeWidth={2} />
      <text x={SAFE.x0 + 110} y={zero + 8} fill={MUTE} fontSize={24} textAnchor="end" className="mono">0</text>
      {WORLDS.map((w: WorldKey) => {
        const v = d.worlds[w].meanDelta;
        const cx = laneX(w);
        const top = v === null ? zero : y(v);
        return (
          <g key={w}>
            <rect x={cx - 110} y={Math.min(top, zero)} width={220} height={Math.max(3, Math.abs(top - zero))} fill={WORLD_COLOR[w]} opacity={0.9} />
            <text x={cx} y={v !== null && v < 0 ? Math.max(top, zero) + 60 : Math.min(top, zero) - 22} fill={PAPER} fontSize={52} textAnchor="middle" className="display">{fmt(v, 'delta')}</text>
            <text x={cx} y={H - 70} fill={WORLD_COLOR[w]} fontSize={26} textAnchor="middle" className="display">{WORLD_GLYPH[w]} {WORLD_PLAIN[w]}</text>
            {d.worlds[w].small && <text x={cx} y={H - 38} fill={MUTE} fontSize={20} textAnchor="middle" className="mono">SMALL GROUP</text>}
          </g>
        );
      })}
    </g>
  );
}

function Slopes({ d }: { d: RevealData }) {
  const y = ratingY(930, 390);
  return (
    <g>
      {WORLDS.map((w) => {
        const s = d.worlds[w];
        if (s.meanR1 === null || s.meanR2 === null) return null;
        const cx = laneX(w);
        return (
          <g key={w}>
            <line x1={cx - 160} x2={cx + 160} y1={y(s.meanR1)} y2={y(s.meanR2)} stroke={WORLD_COLOR[w]} strokeWidth={8} strokeLinecap="round" />
            <text x={cx} y={y(Math.max(s.meanR1, s.meanR2)) - 36} fill={PAPER} fontSize={56} textAnchor="middle" className="display">{fmt(s.meanDelta, 'delta')}</text>
          </g>
        );
      })}
    </g>
  );
}

export function Decor({ scene, beat, d }: { scene: SceneId; beat: number; d: RevealData | null }) {
  if (!d) return null;
  let body: React.ReactNode = null;
  if (scene === 'onegame') {
    const x = scoreX(d);
    body = (
      <>
        <ScoreAxis d={d} />
        {beat >= 1 && d.scores.mean !== null && <Marker x={x(d.scores.mean)} y0={330} y1={740} label={`AVG ${fmt(d.scores.mean)}`} />}
      </>
    );
  } else if (scene === 'selfrating' && d.selfRating.ok) {
    const y = ratingY(880, 260);
    body = (
      <>
        <ScoreAxis d={d} y={910} />
        {[0, 50, 100].map((v) => (
          <text key={v} x={SAFE.x0 + 40} y={y(v) + 8} fill={MUTE} fontSize={24} className="mono">{v}</text>
        ))}
        {beat >= 1 && d.selfRating.mean !== null && (
          <line x1={SAFE.x0 + 80} x2={SAFE.x1 - 80} y1={y(d.selfRating.mean)} y2={y(d.selfRating.mean)} stroke="#FF4F1F" strokeWidth={3} strokeDasharray="10 8" />
        )}
      </>
    );
  } else if (scene === 'worlds') {
    body = beat === 0 ? <LaneHeads academic={false} y={300} /> : (
      <g>
        {LANES.map((w, i) => (
          <g key={w}>
            <text x={SAFE.x0} y={390 + i * 220} fill={WORLD_COLOR[w]} fontSize={28} className="display">{WORLD_GLYPH[w]} {beat >= 2 ? WORLD_ACADEMIC[w] : WORLD_PLAIN[w]}</text>
            <text x={SAFE.x0} y={430 + i * 220} fill={MUTE} fontSize={24} className="mono">n={d.worlds[w].n} · avg {fmt(d.worlds[w].meanScore)}</text>
          </g>
        ))}
      </g>
    );
  } else if (scene === 'movement' && d.n.paired >= 3) {
    body = (
      <>
        <LaneHeads academic={false} y={340} />
        {beat === 3 && <Slopes d={d} />}
      </>
    );
  } else if (scene === 'samescore') body = <SameScore d={d} beat={beat} />;
  else if (scene === 'compare') body = <Compare d={d} beat={beat} />;
  if (!body) return null;
  return (
    <svg className="decor" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {body}
    </svg>
  );
}
