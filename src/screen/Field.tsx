import { useEffect, useRef } from 'react';
import type { Motion } from '../shared/reveal';
import { H, W, type Target } from './layout';

type P = { x: number; y: number; r: number; a: number; color: string; trail?: { x: number; y: number } };
const DUR: Record<Motion, number> = { full: 1100, calm: 450, off: 0 };
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function Field({ targets, motion, still, replay }: { targets: Target[]; motion: Motion; still?: boolean; replay: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cur = useRef(new Map<number, P>());
  const anim = useRef<{ from: Map<number, P>; to: Map<number, P>; start: number; dur: number } | null>(null);
  const raf = useRef(0);
  const lastReplay = useRef(replay);

  useEffect(() => {
    const to = new Map<number, P>(targets.map((t) => [t.k, { x: t.x, y: t.y, r: t.r, a: t.a, color: t.color, trail: t.trail }]));
    let from = new Map(cur.current);
    if (lastReplay.current !== replay) {
      lastReplay.current = replay;
      from = new Map([...to].map(([k, p]) => [k, { ...p, y: p.trail ? p.trail.y : p.y + 40, a: 0, trail: p.trail ? { ...p.trail } : undefined }]));
    }
    for (const [k, p] of to) if (!from.has(k)) from.set(k, { ...p, a: 0 });
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = still ? 0 : DUR[reduce && motion === 'full' ? 'calm' : motion];
    anim.current = { from, to, start: performance.now(), dur };
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const frame = (now: number) => {
      const a = anim.current!;
      const n = a.to.size;
      let done = true;
      const next = new Map<number, P>();
      let i = 0;
      for (const [k, t] of a.to) {
        const f = a.from.get(k) ?? t;
        const delay = a.dur ? Math.min(300, (i++ / Math.max(1, n)) * 300) : 0;
        const raw = a.dur ? Math.min(1, Math.max(0, (now - a.start - delay) / a.dur)) : 1;
        if (raw < 1) done = false;
        const e = ease(raw);
        next.set(k, {
          x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, r: f.r + (t.r - f.r) * e, a: f.a + (t.a - f.a) * e, color: t.color,
          trail: t.trail ? { x: t.trail.x, y: t.trail.y } : undefined,
        });
      }
      cur.current = next;
      ctx.clearRect(0, 0, W, H);
      for (const p of next.values()) {
        if (p.a <= 0.005) continue;
        if (p.trail) {
          ctx.globalAlpha = p.a * 0.45;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.trail.x, p.trail.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!done) raf.current = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [targets, motion, still, replay]);

  return <canvas ref={ref} className="field" width={W} height={H} aria-hidden="true" />;
}
