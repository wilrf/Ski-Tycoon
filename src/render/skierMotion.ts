import { CONFIG, type FeatureType } from '../config';
import { pointAlong, vec, type Vec2 } from '../sim/geometry';
import type { Run } from '../sim/runs';
import type { Skier } from '../sim/skiers';

/**
 * How a skier looks on a run, which the simulation doesn't model: it moves skiers straight down the run's
 * line, and the map draws them carving S-turns around it and flying off jumps. Purely cosmetic and
 * deterministic, so it never changes where the simulation thinks a skier is.
 */
export interface SkierPose {
  readonly pos: Vec2;
  readonly heading: number;
  /** Metres above the snow; above zero the skier is in the air over a jump. */
  readonly air: number;
}

/** Turn shape by skill: beginners make long, wide turns; experts make short, quick ones. Metres. */
const TURN_LENGTH = [34, 26, 19, 14, 12] as const;
const TURN_WIDTH = [6.5, 6, 5, 4, 3.5] as const;
/** Distance skiers straighten out over before a jump so they hit it square. Metres. */
const RUN_IN = 12;
const JUMPS: Partial<Record<FeatureType, { readonly length: number; readonly peak: number }>> = {
  smallJump: { length: 9, peak: 1.4 },
  mediumJump: { length: 15, peak: 2.6 },
  largeJump: { length: 24, peak: 4.2 },
};

/** Where a skiing skier is drawn this frame, or null for anyone not on a run. */
export function skiingPose(s: Skier, runs: readonly Run[], alpha: number): SkierPose | null {
  const state = s.state;
  if (state.kind !== 'skiing') return null;
  const run = runs.find((r) => r.id === state.runId);
  if (!run) return null;
  const { skiSpeed, scaredSpeedFactor } = CONFIG.skiers;
  const speed = skiSpeed[s.skill] * (state.scared ? scaredSpeedFactor : 1);
  // The state holds the distance after this tick; step back to where the frame sits between ticks.
  const d = Math.max(0, Math.min(run.profile.length, state.distance - speed * CONFIG.loop.gameSecondsPerTick * (1 - alpha)));

  // Jumps a skier's level enjoys get hit straight on; others are skied around like the simulation says.
  let straighten = 1, air = 0;
  for (const f of run.features) {
    const jump = JUMPS[f.type];
    if (!jump || CONFIG.features[f.type].appeal[s.skill] <= 0) continue;
    const into = d - f.at;
    if (into >= 0 && into <= jump.length) {
      const t = into / jump.length;
      air = 4 * t * (1 - t) * jump.peak;
      straighten = 0;
    } else if (into < 0 && into > -RUN_IN) straighten = Math.min(straighten, -into / RUN_IN);
    else if (into > jump.length && into < jump.length + RUN_IN) straighten = Math.min(straighten, (into - jump.length) / RUN_IN);
  }

  const here = pointAlong(run.points, d), ahead = pointAlong(run.points, Math.min(run.profile.length, d + 1));
  const len = Math.hypot(ahead.x - here.x, ahead.y - here.y) || 1;
  const t = vec((ahead.x - here.x) / len, (ahead.y - here.y) / len), n = vec(-t.y, t.x);
  // Each skier starts their turns at their own point in the rhythm so a crowd doesn't move in lockstep.
  const k = (Math.PI * 2) / TURN_LENGTH[s.skill], phase = (s.id * 2.399) % (Math.PI * 2);
  const width = TURN_WIDTH[s.skill] * straighten * (state.scared ? 1.3 : 1);
  const side = Math.sin(d * k + phase) * width, drift = Math.cos(d * k + phase) * width * k;
  return {
    pos: vec(here.x + n.x * side, here.y + n.y * side),
    heading: Math.atan2(t.y + n.y * drift, t.x + n.x * drift),
    air,
  };
}
