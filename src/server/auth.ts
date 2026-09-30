import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(sha256(given));
  const b = Buffer.from(sha256(expected));
  return timingSafeEqual(a, b);
}
