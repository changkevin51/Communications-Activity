const SLOP = 12;

export function attachInput(el: HTMLElement, onset: number, commit: (cell: number, rtMs: number) => void): () => void {
  let active: { id: number; cell: number; x: number; y: number; rt: number } | null = null;

  const cellAt = (e: PointerEvent): number | null => {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-cell]');
    if (!target || !el.contains(target)) return null;
    return Number(target.dataset.cell);
  };

  const down = (e: PointerEvent) => {
    if (!e.isPrimary || e.timeStamp <= onset || active) return;
    const cell = cellAt(e);
    if (cell === null) return;
    active = { id: e.pointerId, cell, x: e.clientX, y: e.clientY, rt: e.timeStamp - onset };
    el.querySelector(`[data-cell="${cell}"]`)?.classList.add('pressed');
  };
  const clear = () => {
    el.querySelectorAll('.pressed').forEach((c) => c.classList.remove('pressed'));
    active = null;
  };
  const move = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return;
    if (Math.hypot(e.clientX - active.x, e.clientY - active.y) > SLOP) clear();
  };
  const up = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    const cell = cellAt(e);
    const moved = Math.hypot(e.clientX - a.x, e.clientY - a.y);
    clear();
    if (cell === a.cell && moved <= SLOP) commit(a.cell, a.rt);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', clear);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', clear);
  };
}
