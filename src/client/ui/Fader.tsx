import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Props = { onChange: (value: number, adjustments: number) => void; label: string };

const STEP: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };

export function Fader({ onChange, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<number | null>(null);
  const adjustments = useRef(0);
  const dragging = useRef(false);

  const commit = (v: number) => {
    const r = Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
    setValue(r);
    onChange(r, adjustments.current);
  };
  const fromEvent = (e: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    commit((1 - (e.clientY - rect.top) / rect.height) * 100);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    adjustments.current++;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromEvent(e);
  };
  const key = (e: KeyboardEvent) => {
    const base = value ?? 50;
    let next: number | null = null;
    if (e.key in STEP) next = base + STEP[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 100;
    if (next === null) return;
    e.preventDefault();
    adjustments.current++;
    commit(next);
  };

  return (
    <div className="fader-wrap">
      <div className="mono">Extremely well</div>
      <div
        ref={ref}
        className="fader"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? 'Not set' : `${Math.round(value)} out of 100`}
        onPointerDown={down}
        onPointerMove={(e) => dragging.current && fromEvent(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={key}
        data-testid="fader"
      >
        <div className="track" />
        <div className="mid" />
        {value !== null && (
          <>
            <div className="fill" style={{ height: `${value}%` }} />
            <div className="thumb" style={{ top: `${100 - value}%` }} />
          </>
        )}
      </div>
      <div className="mono">Not well at all</div>
    </div>
  );
}
