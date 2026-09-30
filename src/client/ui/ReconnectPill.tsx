export function ReconnectPill({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pill" role="status">
      Reconnecting…
    </div>
  );
}
