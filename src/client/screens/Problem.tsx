import { BarButton } from '../ui/BarButton';

export function Problem({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <main className="screen fade-in">
      <div className="topline mono"><span>Signal Shift</span><span>No signal</span></div>
      <div className="body">
        <h1 className="display h1">{title}</h1>
        <p className="lede">{body}</p>
      </div>
      {action ? <BarButton onClick={onAction}>{action}</BarButton> : <div style={{ height: 'calc(var(--bar-h) + var(--safe-b))' }} />}
    </main>
  );
}
