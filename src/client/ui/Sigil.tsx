import { useEffect, useRef } from 'react';
import { sigilPath, type Sigil as SigilT } from '../../shared/identity/sigil';
import { useReducedMotion } from './motion';

type Props = { sigil: SigilT; size?: number; trace?: boolean; morph?: boolean; stroke?: number; className?: string };

export function Sigil({ sigil, size = 96, trace, morph, stroke = 2.4, className }: Props) {
  const ref = useRef<SVGPathElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!morph || reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      ref.current?.setAttribute('d', sigilPath(sigil, 100, 200, ((t - t0) / 4000) * Math.PI));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [morph, reduced, sigil]);
  return (
    <svg className={`sigil${trace && !reduced ? ' trace' : ''} ${className ?? ''}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path ref={ref} d={sigilPath(sigil)} pathLength={1} stroke={`hsl(${sigil.hue} 90% 66%)`} strokeWidth={stroke} />
    </svg>
  );
}
