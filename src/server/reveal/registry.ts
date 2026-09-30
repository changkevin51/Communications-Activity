import type { RevealData, SceneId } from '../../shared/reveal';
import { compareCopy, fmt } from '../../shared/revealCopy';

const NOTES: Record<SceneId, string[]> = {
  lobby: ['Get everyone joined. Auto-follow moves to "playing" when someone starts.'],
  playing: ['Progress only — no scores. Close joins before BEGIN.'],
  hold: ['Pre-flight: close joins, projector connected, then BEGIN (hold, or Enter twice).'],
  onegame: ['"Everyone played the same game." Don\'t mention comparison yet.', 'The spread is real and normal.', 'Every score was calculated by the server.'],
  selfrating: ['Dots rise to first self-ratings.', 'Room average rating. Feelings only loosely follow performance.'],
  cut: ['Pause. Let it land.', 'Ask: "Who looked at the other players\' scores after the game?" 5–10 s of silence.'],
  samescore: ['Three people, almost the same score.', 'Each had a different room.', 'Higher · similar · lower. "That\'s what I saw!"', 'Same score. Different context. Different meaning.'],
  worlds: ['Everyone was sorted into one of three rooms.', 'The groups were matched on score — pre-empts "they just did worse".', 'The textbook vocabulary.'],
  movement: ['Before ratings on the left rail.', 'Watch each lane move.', 'Variation: trails go both ways.', 'The group tendency.'],
  compare: ['One shared chart, zoomed in (thumbnail shows the full scale).', 'The result in words — descriptive, not causal.', 'One class. Talk about sample size and replication.'],
  mechanism: ['The pipeline. The only difference was who you saw.', 'Full disclosure of generated scores.'],
  concept: ['The textbook link.'],
  end: ['Thanks. Data stays anonymous.'],
};

export function notesFor(scene: SceneId, beat: number, data: RevealData | null): string[] {
  const base = NOTES[scene];
  const out = [base[Math.min(beat, base.length - 1)]];
  if (!data) return out;
  if (scene === 'movement' && beat >= 2) {
    out.push(`Mean change: up ${fmt(data.worlds.up.meanDelta, 'delta')} · similar ${fmt(data.worlds.neutral.meanDelta, 'delta')} · down ${fmt(data.worlds.down.meanDelta, 'delta')}.`);
  }
  if ((scene === 'movement' && beat === 3) || (scene === 'compare' && beat === 0)) out.push(`Coming up: "${compareCopy(data).headline}" (pattern: ${data.pattern}).`);
  if (scene === 'samescore' && data.samescore && data.samescore.mode !== 'real') out.push(`Same-score is in ${data.samescore.mode} mode.`);
  if (scene === 'onegame' && data.n.eligible === 0) out.push('Snapshot is empty — RESNAP when people finish.');
  return out;
}
