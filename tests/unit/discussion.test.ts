import { describe, expect, it } from 'vitest';
import { aggregate, assertPublicPrompt, validAnswer } from '../../src/server/discussion/aggregate';
import { demoAnswers } from '../../src/server/discussion/demo';
import { PROMPTS } from '../../src/shared/discussionContent';
import { PROFILES, PROMPT_IDS, ROLES, type AnswerValue } from '../../src/shared/discussion';
import { SCENES, beatsFor, nextPos, type NavCtx, type Pos } from '../../src/shared/reveal';
import { part3Frame } from '../../src/screen/part3Copy';

const SENSITIVE = /\b(income|money|mental|romantic|dating|body|weight|family|religion|ethnic|gender|sexual)\b/i;

describe('Part 3 content', () => {
  it('every prompt is well-formed and avoids sensitive topics', () => {
    for (const id of PROMPT_IDS) {
      const p = PROMPTS[id];
      expect(p.id).toBe(id);
      expect(ROLES[p.scene]).toContain('ask');
      expect(p.skipLabel.length).toBeGreaterThan(0);
      const text = [p.title, p.body, ...(p.choices ?? []).map((c) => c.label), ...(p.sliders ?? []).map((x) => x.label)].join(' ');
      expect(text).not.toMatch(SENSITIVE);
      if (p.kind === 'sliders') expect(p.sliders!.length).toBeGreaterThanOrEqual(2);
      else expect(new Set(p.choices!.map((c) => c.id)).size).toBe(p.choices!.length);
    }
    expect(PROMPTS.felt.choices!.map((c) => c.label)).toEqual(['Yes, noticeably', 'A little', 'Not really', "I didn't really look at them"]);
    expect(PROMPTS.switch.sliders).toHaveLength(3);
    expect(PROMPTS.mirrors.sliders).toHaveLength(2);
  });

  it('landscape is off by default and the walk reaches end', () => {
    const c: NavCtx = { data: null, concept: { title: '', quotes: [] } };
    const walk = (ctx: NavCtx) => {
      const seen: string[] = [];
      for (let p: Pos | null = { scene: 'bridge', beat: 0 }; p; p = nextPos(p, ctx)) seen.push(p.scene);
      return seen;
    };
    expect(walk(c)).not.toContain('landscape');
    expect(walk({ ...c, flags: { landscape: true } })).toContain('landscape');
    expect(walk(c).at(-1)).toBe('end');
    expect(beatsFor('felt', c)).toBe(3);
    expect(beatsFor('felt', { ...c, concept: { title: '', quotes: [], slots: { felt: { text: 'q', source: 's', page: '1' } } } })).toBe(4);
    expect(SCENES.findIndex((s) => s.id === 'bridge')).toBeGreaterThan(SCENES.findIndex((s) => s.id === 'mechanism'));
  });
});

describe('answer validation', () => {
  it('accepts well-shaped answers only', () => {
    expect(validAnswer(PROMPTS.felt, { c: 'yes' })).toBe(true);
    expect(validAnswer(PROMPTS.felt, { c: 'nope' })).toBe(false);
    expect(validAnswer(PROMPTS.felt, { v: [1, 2] })).toBe(false);
    expect(validAnswer(PROMPTS.switch, { v: [10, 50, 90] })).toBe(true);
    expect(validAnswer(PROMPTS.switch, { v: [10, 50] })).toBe(false);
    expect(validAnswer(PROMPTS.switch, { v: [10, 50, 101] })).toBe(false);
    expect(validAnswer(PROMPTS.landscape, { cs: ['school', 'coop'] })).toBe(true);
    expect(validAnswer(PROMPTS.landscape, { cs: ['school', 'school'] })).toBe(false);
    expect(validAnswer(PROMPTS.landscape, { cs: ['none', 'school'] })).toBe(false);
    expect(validAnswer(PROMPTS.landscape, { cs: ['school', 'coop', 'sport', 'gaming'] })).toBe(false);
    expect(validAnswer(PROMPTS.mirrors, { skip: true })).toBe(true);
  });
});

describe('aggregate', () => {
  it('suppresses everything below five answers', () => {
    const r = aggregate('felt', 1, 'live', [{ c: 'yes' }, { c: 'no' }, { skip: true }], 10);
    expect(r.small).toBe(true);
    expect(r.counts).toBeNull();
    expect(r.n).toBe(2);
    expect(r.skipped).toBe(1);
  });
  it('counts single choice and is order-independent', () => {
    const vs: AnswerValue[] = ['yes', 'yes', 'little', 'no', 'didnt', 'little', 'yes'].map((c) => ({ c }));
    const a = aggregate('felt', 1, 'live', vs, 7);
    const b = aggregate('felt', 1, 'live', [...vs].reverse(), 7);
    expect(a).toEqual(b);
    expect(a.counts).toEqual([{ id: 'yes', n: 3 }, { id: 'little', n: 2 }, { id: 'no', n: 1 }, { id: 'didnt', n: 1 }]);
  });
  it('nulls small multi-select cells', () => {
    const vs: AnswerValue[] = [...Array(6)].map(() => ({ cs: ['school'] }));
    vs.push({ cs: ['gaming'] });
    const r = aggregate('landscape', 1, 'live', vs, 7);
    expect(r.counts!.find((c) => c.id === 'school')!.n).toBe(6);
    expect(r.counts!.find((c) => c.id === 'gaming')!.n).toBeNull();
    expect(r.counts!.find((c) => c.id === 'sport')!.n).toBe(0);
  });
  it('summarises sliders without any per-person vectors', () => {
    const vs: AnswerValue[] = [[20, 50, 80], [30, 60, 90], [10, 40, 70], [25, 55, 85], [15, 45, 75]].map((v) => ({ v }));
    const r = aggregate('switch', 1, 'live', vs, 5);
    expect(r.sliders!.map((s) => s.median)).toEqual([20, 50, 80]);
    expect(Object.keys(r)).not.toContain('vectors');
    expect(() => assertPublicPrompt({ ...r, vectors: [[1, 2, 3]] })).toThrow();
    expect(() => assertPublicPrompt({ ...r, pid: 'x' })).toThrow();
    expect(assertPublicPrompt(r)).toEqual(r);
  });
});

describe('rehearsal answers', () => {
  it('are deterministic and valid for every profile, prompt and size', () => {
    for (const profile of PROFILES)
      for (const prompt of PROMPT_IDS)
        for (const n of [12, 30, 60]) {
          const a = demoAnswers(prompt, profile, n, 'seed');
          expect(demoAnswers(prompt, profile, n, 'seed')).toEqual(a);
          for (const v of a.values) expect(validAnswer(PROMPTS[prompt], v)).toBe(true);
          const r = assertPublicPrompt(aggregate(prompt, 1, 'demo', a.values, a.eligible));
          if (profile === 'optionalzero' && prompt === 'landscape') expect(r.n).toBe(0);
          const f = part3Frame({ scene: PROMPTS[prompt].scene, beat: ROLES[PROMPTS[prompt].scene].indexOf('reveal'), q: { prompt, run: 1, phase: 'frozen', count: r.n, eligible: n, result: r } }, null);
          expect(JSON.stringify(f)).not.toMatch(/NaN|undefined|null|Infinity/);
        }
  });
});
