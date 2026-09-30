import { useEffect, useState } from 'react';

const query = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export async function requestWakeLock(): Promise<() => void> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl) return () => {};
    const s = await wl.request('screen');
    return () => void s.release().catch(() => {});
  } catch {
    return () => {};
  }
}
