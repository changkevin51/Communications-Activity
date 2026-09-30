import { useSyncExternalStore } from 'react';
import type { Connection, ConnState } from './connection';

export function useConn(conn: Connection): ConnState {
  return useSyncExternalStore(conn.subscribe, conn.getState);
}
