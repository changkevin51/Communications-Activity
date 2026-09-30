import type { HostView } from './api';

const f = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

export function Internals({ view, onRemove }: { view: HostView; onRemove: (id: string) => void }) {
  const i = view.internals;
  return (
    <div style={{ marginTop: 12 }}>
      <h3>Summary by condition</h3>
      <div className="scroll">
        <table>
          <thead><tr><th>condition</th><th>n</th><th>mean score</th><th>mean r1</th><th>mean r2</th><th>mean Δ</th><th>done</th></tr></thead>
          <tbody>
            {i.summary.map((s) => (
              <tr key={s.condition}><td>{s.condition}</td><td>{s.n}</td><td>{f(s.meanScore)}</td><td>{f(s.meanR1)}</td><td>{f(s.meanR2)}</td><td>{f(s.meanDelta)}</td><td>{s.done}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Generated fill: {i.ghosts.count} · exposures generated {i.ghosts.exposures} / real {i.ghosts.realExposures}
        {i.thresholds && <> · thresholds {Object.entries(i.thresholds).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v) : v}`).join(' ')}</>}
      </p>
      <h3>Participants</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>codename</th><th>kind</th><th>stage</th><th>score</th><th>r1</th><th>r2</th><th>Δ</th><th>cond</th><th>stratum</th><th>batch</th><th>peers</th><th>flags</th><th /></tr>
          </thead>
          <tbody>
            {i.participants.map((p) => (
              <tr key={p.id}>
                <td>{p.codename}</td><td>{p.kind}</td><td>{p.stage}</td><td>{f(p.score)}</td><td>{f(p.r1)}</td><td>{f(p.r2)}</td><td>{f(p.delta)}</td>
                <td>{p.condition ?? '—'}</td><td>{f(p.stratum)}</td><td>{p.batch ?? '—'}</td>
                <td className="mono">{p.peers.map((x) => `${x.score}${x.kind === 'ghost' ? '*' : ''}`).join(' ')}</td>
                <td>{p.flags.join(', ')}</td>
                <td>{p.stage !== 'removed' && <button onClick={() => onRemove(p.id)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
