import type { Namespace } from 'socket.io';
import type { Db } from './db/db';
import { buildView } from './views';
import { hostView } from './services/host';

export class Hub {
  participantNs?: Namespace;
  hostNs?: Namespace;
  private connections = new Map<string, number>();
  private hostTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private db: Db,
    private hostDebounceMs = 250,
  ) {}

  connected(pid: string) {
    this.connections.set(pid, (this.connections.get(pid) ?? 0) + 1);
  }

  disconnected(pid: string) {
    const n = (this.connections.get(pid) ?? 1) - 1;
    if (n <= 0) this.connections.delete(pid);
    else this.connections.set(pid, n);
  }

  connectedSet(): Set<string> {
    return new Set(this.connections.keys());
  }

  pushViews(pids: string[]) {
    const now = Date.now();
    for (const pid of pids) {
      const view = buildView(this.db, pid, now);
      if (view) this.participantNs?.to(`p:${pid}`).emit('view', view);
    }
  }

  pushHost(sessionId: string) {
    if (this.hostTimers.has(sessionId)) return;
    this.hostTimers.set(
      sessionId,
      setTimeout(() => {
        this.hostTimers.delete(sessionId);
        const v = hostView(this.db, sessionId, this.connectedSet());
        if (v) this.hostNs?.to(`h:${sessionId}`).emit('hostView', v);
      }, this.hostDebounceMs),
    );
  }

  close() {
    for (const t of this.hostTimers.values()) clearTimeout(t);
    this.hostTimers.clear();
  }
}
