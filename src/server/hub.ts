import type { Namespace } from 'socket.io';
import type { Db } from './db/db';
import { buildView } from './views';
import { hostView } from './services/host';
import { autoFollow, presenterView, releaseLease, screenState } from './services/presentation';

export const LEASE_GRACE_MS = 30_000;

export class Hub {
  participantNs?: Namespace;
  hostNs?: Namespace;
  screenNs?: Namespace;
  private connections = new Map<string, number>();
  private hostTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private screens = new Map<string, number>();
  private leases = new Map<string, number>();
  private leaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private db: Db,
    private hostDebounceMs = 250,
    private leaseGraceMs = LEASE_GRACE_MS,
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

  screenConnected(sessionId: string, delta: 1 | -1) {
    const n = (this.screens.get(sessionId) ?? 0) + delta;
    if (n <= 0) this.screens.delete(sessionId);
    else this.screens.set(sessionId, n);
    this.pushPresenter(sessionId);
  }

  leaseHeld(sessionId: string, leaseId: string) {
    const key = `${sessionId}:${leaseId}`;
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1);
    const t = this.leaseTimers.get(key);
    if (t) clearTimeout(t);
    this.leaseTimers.delete(key);
  }

  leaseDropped(sessionId: string, leaseId: string) {
    const key = `${sessionId}:${leaseId}`;
    const n = (this.leases.get(key) ?? 1) - 1;
    if (n > 0) return void this.leases.set(key, n);
    this.leases.delete(key);
    this.leaseTimers.set(
      key,
      setTimeout(() => {
        this.leaseTimers.delete(key);
        if (this.leases.has(key)) return;
        releaseLease(this.db, sessionId, leaseId);
        this.pushPresenter(sessionId);
      }, this.leaseGraceMs),
    );
  }

  phones(sessionId: string): number {
    const ids = this.db.all<{ id: string }>("SELECT id FROM participants WHERE session_id = ? AND kind = 'human' AND removed_at IS NULL", sessionId);
    return ids.filter((r) => this.connections.has(r.id)).length;
  }

  presenter(sessionId: string) {
    return presenterView(this.db, sessionId, Date.now(), { phones: this.phones(sessionId), projectors: this.screens.get(sessionId) ?? 0 });
  }

  pushViews(pids: string[]) {
    const now = Date.now();
    for (const pid of pids) {
      const view = buildView(this.db, pid, now);
      if (view) this.participantNs?.to(`p:${pid}`).emit('view', view);
    }
  }

  pushSessionViews(sessionId: string) {
    this.pushViews(this.db.all<{ id: string }>("SELECT id FROM participants WHERE session_id = ? AND kind = 'human'", sessionId).map((r) => r.id));
  }

  pushPresenter(sessionId: string) {
    const v = this.presenter(sessionId);
    if (v) this.hostNs?.to(`h:${sessionId}`).emit('presenterView', v);
  }

  pushPresentation(sessionId: string) {
    const st = screenState(this.db, sessionId, Date.now());
    if (st) this.screenNs?.to(`s:${sessionId}`).emit('screen', st);
    this.pushPresenter(sessionId);
  }

  pushHost(sessionId: string) {
    if (this.hostTimers.has(sessionId)) return;
    this.hostTimers.set(
      sessionId,
      setTimeout(() => {
        this.hostTimers.delete(sessionId);
        const v = hostView(this.db, sessionId, this.connectedSet());
        if (v) this.hostNs?.to(`h:${sessionId}`).emit('hostView', v);
        autoFollow(this.db, sessionId, Date.now());
        this.pushPresentation(sessionId);
      }, this.hostDebounceMs),
    );
  }

  close() {
    for (const t of this.hostTimers.values()) clearTimeout(t);
    for (const t of this.leaseTimers.values()) clearTimeout(t);
    this.hostTimers.clear();
    this.leaseTimers.clear();
  }
}
