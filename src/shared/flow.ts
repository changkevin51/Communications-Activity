export const STAGES = ['joined', 'playing', 'scored', 'rated_before', 'assigned', 'recap_seen', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export function stageIndex(s: Stage): number {
  return STAGES.indexOf(s);
}

export function atOrPast(current: Stage, target: Stage): boolean {
  return stageIndex(current) >= stageIndex(target);
}

const NEXT: Record<Stage, Stage | null> = {
  joined: 'playing',
  playing: 'scored',
  scored: 'rated_before',
  rated_before: 'assigned',
  assigned: 'recap_seen',
  recap_seen: 'done',
  done: null,
};

export function canTransition(from: Stage, to: Stage): boolean {
  if (NEXT[from] === to) return true;
  return from === 'assigned' && to === 'done';
}

export const PHASES = ['open', 'released', 'closed'] as const;
export type Phase = (typeof PHASES)[number];
