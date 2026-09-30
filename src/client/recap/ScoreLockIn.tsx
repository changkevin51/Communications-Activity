import { useEffect, useState } from 'react';
import { useReducedMotion } from '../ui/motion';

export function ScoreLockIn({ score, onLocked }: { score: number; onLocked?: () => void }) {
  const reduced = useReducedMotion();
  const target = String(score);
  const [locked, setLocked] = useState(reduced ? target.length : 0);
  const [spin, setSpin] = useState(target);
  useEffect(() => {
    if (reduced) {
      onLocked?.();
      return;
    }
    const spinT = setInterval(() => setSpin(target.replace(/\d/g, () => String(Math.floor(Math.random() * 10)))), 50);
    const timers = target.split('').map((_, i) => setTimeout(() => setLocked(i + 1), 700 + i * 380));
    const done = setTimeout(() => {
      clearInterval(spinT);
      onLocked?.();
    }, 700 + target.length * 380);
    return () => {
      clearInterval(spinT);
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [target, reduced]);
  return (
    <div className={`odometer${reduced ? ' fade-in' : ''}`} aria-label={`Score ${score}`} data-testid="score">
      {target.split('').map((d, i) => (
        <span key={i} className={i < locked ? 'locked' : ''} aria-hidden="true">
          {i < locked ? d : spin[i]}
        </span>
      ))}
    </div>
  );
}
