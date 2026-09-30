import { expect, it } from 'vitest';
import { openDb } from './db';

it('opens and migrates in memory', () => {
  const db = openDb(':memory:');
  expect(db.get<{ n: number }>('SELECT 1 AS n')?.n).toBe(1);
  expect(db.all('SELECT name FROM sqlite_master WHERE type = ?', 'table').length).toBeGreaterThan(5);
});
