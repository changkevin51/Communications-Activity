import type { OtherPlayer } from '../../shared/protocol';
import { sigilPath } from '../../shared/identity/sigil';

const W = 340;
const PAD = 20;
const C = W / 2;
const Y = 70;

type Props = { me: number; span: number; others: OtherPlayer[]; shown: number; needle: boolean };

export function Dial({ me, span, others, shown, needle }: Props) {
  const lo = me - span / 2;
  const hi = me + span / 2;
  const x = (s: number) => PAD + ((s - lo) / (hi - lo)) * (W - 2 * PAD);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) ticks.push(t);
  return (
    <svg className="dial" viewBox={`0 0 ${W} 140`} role="img" aria-label="Tuner dial">
      <line x1={PAD} x2={W - PAD} y1={Y} y2={Y} stroke="var(--hair)" className="fade-in" />
      {ticks.map((t) => {
        const major = t % 50 === 0;
        return (
          <g key={t} className="fade-in">
            <line x1={x(t)} x2={x(t)} y1={Y - (major ? 10 : 5)} y2={Y + (major ? 10 : 5)} stroke={major ? 'var(--mute)' : 'var(--hair)'} />
            {major && t % 100 === 0 && (
              <text x={x(t)} y={Y + 24} textAnchor="middle">{t}</text>
            )}
          </g>
        );
      })}
      {others.slice(0, shown).map((o, i) => {
        const raw = x(o.score);
        const pinned = raw < PAD ? 'l' : raw > W - PAD ? 'r' : null;
        const px = Math.min(W - PAD, Math.max(PAD, raw));
        return (
          <g key={o.codename} className="rise" data-testid={`station-${i}`}>
            <circle cx={px} cy={Y} r={5} fill="var(--paper)" />
            {pinned && <text x={px + (pinned === 'l' ? 8 : -8)} y={Y + 4} textAnchor="middle">{pinned === 'l' ? '‹' : '›'}</text>}
            <g transform={`translate(${px - 12} ${Y - 44 - (i % 2) * 8}) scale(0.24)`}>
              <path d={sigilPath(o.sigil)} fill="none" stroke={`hsl(${o.sigil.hue} 90% 66%)`} strokeWidth={8} />
            </g>
          </g>
        );
      })}
      {needle && (
        <g className="rise">
          <line x1={C} x2={C} y1={Y - 36} y2={Y + 30} stroke="var(--signal)" strokeWidth={3} />
          <text x={C} y={Y + 46} textAnchor="middle" style={{ fill: 'var(--paper)' }}>YOU · {me}</text>
        </g>
      )}
    </svg>
  );
}
