import { describe, expect, it } from 'vitest';
import { SCENES } from '../../src/shared/reveal';
import { derive } from '../../src/server/reveal/derive';
import { demoRows } from '../../src/server/reveal/demo';
import { notesFor } from '../../src/server/reveal/notes';

function data(scenario: 'expected' | 'reversed' | 'none') {
  const { rows, stillFinishing } = demoRows(scenario, 30, 'notes');
  return derive(rows, { source: 'demo', scenario, stillFinishing });
}

const spoken = (notes: string[]) => notes.filter((n) => n.startsWith('SAY:') || n.startsWith('PARTNER:') || n.startsWith('ASK:')).join('\n');

describe('presenter notes', () => {
  it('covers every scene beat', () => {
    for (const s of SCENES) {
      for (let b = 0; b < s.beats; b++) {
        const notes = notesFor(s.id, b, null);
        expect(notes.length, `${s.id}/${b}`).toBeGreaterThan(0);
        expect(notes.every((n) => n.trim().length > 0), `${s.id}/${b}`).toBe(true);
      }
    }
  });

  it('follows the live pattern and does not claim the class proved an effect', () => {
    const expected = data('expected');
    const exp = notesFor('compare', 1, expected);
    expect(expected.pattern).toBe('expected');
    expect(exp.some((n) => n.startsWith('IF EXPECTED'))).toBe(true);
    expect(exp.some((n) => n.startsWith('IF REVERSED'))).toBe(false);
    expect(exp.join('\n')).toMatch(/Do not say we proved/);
    expect(spoken(exp)).not.toMatch(/\bproved\b/i);

    const reversed = data('reversed');
    const rev = notesFor('compare', 1, reversed);
    expect(reversed.pattern).toBe('reversed');
    expect(rev.some((n) => n.startsWith('IF REVERSED'))).toBe(true);
    expect(rev.some((n) => n.startsWith('IF EXPECTED'))).toBe(false);

    const flat = data('none');
    expect(flat.pattern).toBe('flat');
    expect(notesFor('compare', 1, flat).some((n) => n.startsWith('IF FLAT'))).toBe(true);
  });

  it('keeps the game on social comparison, not reflected appraisal', () => {
    const notes = notesFor('mirrors', 3, null).join('\n');
    expect(notes).toMatch(/not reflected appraisal/i);
    expect(notes).toMatch(/significant other/i);
    expect(notesFor('worlds', 2, null).join('\n')).toMatch(/inside social comparison/i);
  });

  it('discloses generated same-score illustrations instead of calling them classmates', () => {
    const d = data('expected');
    d.samescore = {
      mode: 'illustration',
      focal: 740,
      generated: 0,
      members: d.samescore?.members ?? [],
    };
    const notes = notesFor('samescore', 0, d).join('\n');
    expect(notes).toMatch(/Illustration only/);
    expect(spoken(notesFor('samescore', 0, d))).not.toMatch(/real players from this room/);
  });

  it('warns when assist rewrote the snapshot', () => {
    const notes = notesFor('compare', 1, data('expected'), { assist: { shaped: 12, filled: 0, assigned: 3, added: 2 } });
    expect(notes.join('\n')).toMatch(/Assist/);
    expect(notes.join('\n')).toMatch(/synthetic/);
  });
});
