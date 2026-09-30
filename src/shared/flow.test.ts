import { describe, expect, it } from 'vitest';
import { atOrPast, canTransition } from './flow';

describe('flow', () => {
  it('allows forward single steps only', () => {
    expect(canTransition('joined', 'playing')).toBe(true);
    expect(canTransition('joined', 'scored')).toBe(false);
    expect(canTransition('done', 'joined')).toBe(false);
    expect(canTransition('assigned', 'done')).toBe(true);
  });
  it('atOrPast', () => {
    expect(atOrPast('scored', 'playing')).toBe(true);
    expect(atOrPast('joined', 'playing')).toBe(false);
  });
});
