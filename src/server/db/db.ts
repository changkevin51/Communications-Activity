import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema';

export type Db = {
  raw: DatabaseSync;
  tx<T>(fn: () => T): T;
  get<T>(sql: string, ...params: SqlParam[]): T | undefined;
  all<T>(sql: string, ...params: SqlParam[]): T[];
  run(sql: string, ...params: SqlParam[]): { changes: number };
  close(): void;
};

export type SqlParam = string | number | null;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  migrate(raw);
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  return {
    raw,
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    get<T>(sql: string, ...params: SqlParam[]) {
      return stmt(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, ...params: SqlParam[]) {
      return stmt(sql).all(...params) as T[];
    },
    run(sql: string, ...params: SqlParam[]) {
      const r = stmt(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    close() {
      raw.close();
    },
  };
}

function migrate(raw: DatabaseSync) {
  const row = raw.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    raw.exec(MIGRATIONS[v]);
    raw.exec(`PRAGMA user_version = ${v + 1}`);
    raw.exec('COMMIT');
  }
}
