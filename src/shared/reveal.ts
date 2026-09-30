export const REVEAL_VERSION = 'reveal@1';

export type WorldKey = 'up' | 'neutral' | 'down';
export const WORLDS: readonly WorldKey[] = ['up', 'neutral', 'down'];

export type SceneId =
  | 'lobby' | 'playing' | 'hold' | 'onegame' | 'selfrating' | 'cut' | 'samescore'
  | 'worlds' | 'movement' | 'compare' | 'mechanism' | 'concept' | 'end';

export type Source = 'live' | 'test' | 'demo';
export type Motion = 'full' | 'calm' | 'off';

export type Mark = { k: number; score: number; r1: number | null; r2: number | null; world: WorldKey | null };

export type WorldStats = {
  n: number;
  nPaired: number;
  meanScore: number | null;
  meanR1: number | null;
  meanR2: number | null;
  meanDelta: number | null;
  medianDelta: number | null;
  moved: { up: number; down: number; same: number };
  small: boolean;
};

export type SameScoreMember = { world: WorldKey; score: number; peers: { score: number; real: boolean }[] };
export type SameScoreDemo = { mode: 'real' | 'example' | 'illustration'; focal: number; members: SameScoreMember[]; generated: number };

export type Pattern = 'expected' | 'partial' | 'flat' | 'reversed' | 'mixed' | 'thin';
export type Warning = { code: string; text: string };

export type RevealData = {
  version: typeof REVEAL_VERSION;
  source: Source;
  scenario: string | null;
  n: { eligible: number; rated1: number; assigned: number; paired: number; stillFinishing: number };
  scoreAxis: { lo: number; hi: number; ticks: number[] };
  marks: Mark[];
  scores: { mean: number | null; median: number | null; min: number | null; max: number | null; ties: number };
  selfRating: { ok: boolean; mean: number | null; corr: 'none' | 'weak' | 'clear' | null };
  worlds: Record<WorldKey, WorldStats>;
  samescore: SameScoreDemo | null;
  mechanism: { peersShown: number; realShown: number; generatedShown: number; perPerson: 3 };
  pattern: Pattern;
  warnings: Warning[];
};

export type SnapshotRow = {
  k: number;
  kind: 'human' | 'bot';
  score: number;
  r1: number | null;
  r2: number | null;
  world: WorldKey | null;
  stratum: number | null;
  peers: { score: number; real: boolean }[];
  dwellMs: number | null;
};

export type ConceptQuote = { text: string; source: string; page: string };
export type Concept = { title: string; quotes: ConceptQuote[] };

export type LiveCounts = { joined: number; started: number; playing: number; rating: number; done: number; code: string };

export type ScreenState = {
  rev: number;
  mode: 'live' | 'test';
  serverNow: number;
  changedAt: number;
  scene: SceneId;
  beat: number;
  beats: number;
  nonce: number;
  hold: boolean;
  plain: boolean;
  motion: Motion;
  source: Source | null;
  scenario: string | null;
  dataHash: string | null;
  live?: LiveCounts;
  concept?: Concept;
  late?: number;
};

export type StripItem = { scene: SceneId; beats: number; skip: string | null };

export type PresenterView = ScreenState & {
  sessionId: string;
  code: string;
  phase: 'open' | 'released' | 'closed';
  auto: boolean;
  screenKey: string;
  lease: { controller: string | null };
  readiness: { joined: number; started: number; playing: number; rating: number; done: number; phones: number; projectors: number };
  health: {
    counts: SnapshotCounts;
    n: RevealData['n'];
    worlds: Record<WorldKey, { n: number; nPaired: number }>;
    pattern: Pattern;
    warnings: Warning[];
  } | null;
  strip: StripItem[];
  conceptConfig: Concept;
  notes: string[];
};

export type SnapshotCounts = {
  joined: number; started: number; scored: number; ratedBefore: number; assigned: number; done: number;
  flagged: number;
  excluded: { removed: number; invalid: number; noScore: number; stillPlaying: number };
};

export type SceneSpec = {
  id: SceneId;
  beats: number;
  needsSnapshot: boolean;
  optional: boolean;
  title: string;
};

export const SCENES: readonly SceneSpec[] = [
  { id: 'lobby', beats: 1, needsSnapshot: false, optional: false, title: 'Tune in' },
  { id: 'playing', beats: 1, needsSnapshot: false, optional: false, title: 'Signal in progress' },
  { id: 'hold', beats: 1, needsSnapshot: false, optional: false, title: 'Stand by' },
  { id: 'onegame', beats: 3, needsSnapshot: true, optional: false, title: 'One game' },
  { id: 'selfrating', beats: 2, needsSnapshot: true, optional: false, title: 'Self-rating' },
  { id: 'cut', beats: 2, needsSnapshot: true, optional: false, title: 'The cut' },
  { id: 'samescore', beats: 4, needsSnapshot: true, optional: true, title: 'Same score' },
  { id: 'worlds', beats: 3, needsSnapshot: true, optional: false, title: 'Three worlds' },
  { id: 'movement', beats: 4, needsSnapshot: true, optional: false, title: 'Movement' },
  { id: 'compare', beats: 3, needsSnapshot: true, optional: false, title: 'Compare' },
  { id: 'mechanism', beats: 2, needsSnapshot: true, optional: false, title: 'Mechanism' },
  { id: 'concept', beats: 1, needsSnapshot: false, optional: true, title: 'Concept' },
  { id: 'end', beats: 1, needsSnapshot: false, optional: false, title: 'End' },
];

export const PRE_REVEAL: readonly SceneId[] = ['lobby', 'playing', 'hold'];
export const isPreReveal = (s: SceneId) => PRE_REVEAL.includes(s);
export const sceneIndex = (s: SceneId) => SCENES.findIndex((x) => x.id === s);
export const sceneSpec = (s: SceneId) => SCENES[sceneIndex(s)];

export type NavCtx = { data: RevealData | null; concept: Concept };

export function beatsFor(scene: SceneId, ctx: NavCtx): number {
  const d = ctx.data;
  switch (scene) {
    case 'selfrating':
      return d && d.n.rated1 < 3 ? 1 : 2;
    case 'movement':
      return d && d.n.paired < 3 ? 1 : 4;
    case 'concept':
      return Math.max(1, Math.min(3, ctx.concept.quotes.length));
    default:
      return sceneSpec(scene).beats;
  }
}

export function skipReason(scene: SceneId, ctx: NavCtx): string | null {
  if (scene === 'samescore' && !ctx.data?.samescore) return 'no players to build the example from';
  if (scene === 'concept' && !ctx.concept.quotes.some((q) => q.text.trim())) return 'no quote configured';
  return null;
}

export type Pos = { scene: SceneId; beat: number };

export function nextPos(p: Pos, ctx: NavCtx, sceneJump = false): Pos | null {
  if (!sceneJump && p.beat < beatsFor(p.scene, ctx) - 1) return { scene: p.scene, beat: p.beat + 1 };
  for (let i = sceneIndex(p.scene) + 1; i < SCENES.length; i++) {
    const s = SCENES[i].id;
    if (isPreReveal(s) !== isPreReveal(p.scene)) return null;
    if (!skipReason(s, ctx)) return { scene: s, beat: 0 };
  }
  return null;
}

export function prevPos(p: Pos, ctx: NavCtx, sceneJump = false): Pos | null {
  if (!sceneJump && p.beat > 0) return { scene: p.scene, beat: p.beat - 1 };
  for (let i = sceneIndex(p.scene) - 1; i >= 0; i--) {
    const s = SCENES[i].id;
    if (isPreReveal(s) !== isPreReveal(p.scene)) return null;
    if (!skipReason(s, ctx)) return { scene: s, beat: sceneJump ? 0 : beatsFor(s, ctx) - 1 };
  }
  return null;
}

export const EMPTY_CONCEPT: Concept = { title: '', quotes: [] };
