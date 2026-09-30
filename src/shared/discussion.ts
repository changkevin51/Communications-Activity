export const PROMPT_VERSION = 'prompt@1';

export type PromptId = 'felt' | 'switch' | 'landscape' | 'mirrors';
export const PROMPT_IDS: readonly PromptId[] = ['felt', 'switch', 'landscape', 'mirrors'];

export type Part3Scene = 'bridge' | 'felt' | 'switch' | 'landscape' | 'mirrors' | 'chooser' | 'circle';
export const PART3_SCENES: readonly Part3Scene[] = ['bridge', 'felt', 'switch', 'landscape', 'mirrors', 'chooser', 'circle'];

/** ask: phones take answers · reveal: frozen result · discuss: result + talking point · show: projector only · concept: optional quote slot */
export type Role = 'ask' | 'reveal' | 'discuss' | 'show' | 'concept';

export const ROLES: Record<Part3Scene, readonly Role[]> = {
  bridge: ['show'],
  felt: ['ask', 'reveal', 'discuss', 'concept'],
  switch: ['ask', 'reveal', 'discuss', 'concept'],
  landscape: ['ask', 'reveal', 'discuss'],
  mirrors: ['show', 'ask', 'reveal', 'discuss', 'concept'],
  chooser: ['show', 'show', 'discuss', 'concept'],
  circle: ['show', 'show', 'show'],
};

export const PROMPT_OF: Partial<Record<Part3Scene, PromptId>> = { felt: 'felt', switch: 'switch', landscape: 'landscape', mirrors: 'mirrors' };

export const isPart3 = (s: string): s is Part3Scene => (PART3_SCENES as readonly string[]).includes(s);
export const roleAt = (s: string, beat: number): Role | null => (isPart3(s) ? ROLES[s][beat] ?? null : null);
export const askBeat = (s: Part3Scene) => ROLES[s].indexOf('ask');

/** Answers below this are never shown as a distribution. */
export const MIN_SHOW = 5;
/** Multi-select categories below this are shown as "fewer than 3". */
export const MIN_CELL = 3;
/** Answers arriving this long after a freeze are stored as late and never change the result. */
export const LATE_GRACE_MS = 1500;

export type PromptKind = 'single' | 'multi' | 'sliders';
export type AnswerValue = { c: string } | { cs: string[] } | { v: number[] } | { skip: true };

export type PromptResult = {
  version: typeof PROMPT_VERSION;
  prompt: PromptId;
  run: number;
  source: 'live' | 'test' | 'demo';
  n: number;
  skipped: number;
  eligible: number;
  small: boolean;
  counts: { id: string; n: number | null }[] | null;
  sliders: { id: string; median: number; q1: number; q3: number; min: number; max: number }[] | null;
};

export type QuestionPhase = 'none' | 'open' | 'frozen';

export type ScreenQuestion = {
  prompt: PromptId;
  run: number | null;
  phase: QuestionPhase;
  count: number;
  eligible: number;
  result: PromptResult | null;
};

export type PresenterQuestion = ScreenQuestion & {
  skipped: number;
  late: number;
  openedAt: number | null;
  runs: number;
  split: { id: string; n: number }[];
};

export type Part3Flags = { landscape: boolean };
export const DEFAULT_FLAGS: Part3Flags = { landscape: false };

export const PROFILES = ['expected', 'onesided', 'split', 'low', 'unexpected', 'optionalzero'] as const;
export type Profile = (typeof PROFILES)[number];
