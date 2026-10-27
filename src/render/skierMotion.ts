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
/**
 * How much skiers linger at the edge of each turn and then dart through the fall line, like a raindrop
 * that pauses and runs. Beginners hesitate before committing to the next turn; experts flow.
 */
const RHYTHM = [0.45, 0.35, 0.25, 0.15, 0.1] as const;
/** Distance skiers straighten out over before a jump so they hit it square. Metres. */
const RUN_IN = 12;
const JUMPS: Partial<Record<FeatureType, { readonly length: number; readonly peak: number }>> = {
  smallJump: { length: 9, peak: 1.4 },
  mediumJump: { length: 15, peak: 2.6 },
  largeJump: { length: 24, peak: 4.2 },
};

/** Where a skiing skier is drawn this frame, or null for anyone not on a run. */
export function skiingPose(s: Skier, runs: readonly Run[], alpha: number): SkierPose | null {
  const on = onRun(s, runs, alpha);
  return on && poseAt(s, on.run, on.d, on.scared);
}

/** A soft ball of snow thrown up by a turn or a landing, in world metres. */
export interface Puff {
  readonly pos: Vec2;
  readonly radius: number;
  readonly alpha: number;
}

/** Spray dies away over this many metres of skiing, so it slows in slow motion and freezes on pause. */
const SPRAY_FADE = 4;
/** Where in each turn the ski is loaded hardest: just past the fall line, in the lower half of the turn. */
const SPRAY_AT = Math.PI / 2 + Math.PI / 6;
/** Beginners skid and throw big, scrappy puffs; experts carve and throw a thin fan. */
const SPRAY_SIZE = [1.5, 1.15, 0.8, 0.55, 0.5] as const;
const SPRAY_COUNT = [9, 8, 6, 5, 5] as const;
const LANDING_COUNT = 12;
/** Figures are drawn well over life size so they read on the map; spray is scaled to match them. */
const FIGURE_SCALE = 2.8;

/** The snow a skier is kicking up this frame: the last turn's spray and any jump landing, fading as they ski on. */
export function snowPuffs(s: Skier, runs: readonly Run[], alpha: number): Puff[] {
  const on = onRun(s, runs, alpha);
  if (!on) return [];
  const { run, d, scared } = on;
  const puffs: Puff[] = [];

  // The most recent hard-loaded point in the turn rhythm, and how far the skier has gone since.
  const k = turnRate(s), theta = d * k + turnPhase(s);
  const turn = Math.floor((theta - SPRAY_AT) / Math.PI);
  const back = (theta - SPRAY_AT - turn * Math.PI) / k;
  const side = d - back > 0 ? sideAt(s, run, d - back, scared) : 0;
  // No spray while running straight at a jump; otherwise it leaves the outside of the turn, the side the skier swung out to.
  if (back < SPRAY_FADE && side !== 0) {
    const { t, n } = frameAt(run, d - back), out = Math.sign(side);
    const angle = Math.atan2(n.y * out + t.y * 0.4, n.x * out + t.x * 0.4);
    const size = SPRAY_SIZE[s.skill] * (scared ? 1.3 : 1);
    spray(puffs, poseAt(s, run, d - back, scared).pos, angle, 0.6, SPRAY_COUNT[s.skill], size, back / SPRAY_FADE, s.id * 131 + turn);
  }

  // A ring of snow where a skier lands a jump.
  for (const f of run.features) {
    const jump = JUMPS[f.type];
    if (!jump || CONFIG.features[f.type].appeal[s.skill] <= 0) continue;
    const since = d - (f.at + jump.length);
    if (since >= 0 && since < SPRAY_FADE) spray(puffs, poseAt(s, run, f.at + jump.length, scared).pos, 0, Math.PI, LANDING_COUNT, 1.4, since / SPRAY_FADE, s.id * 977 + f.at);
  }
  return puffs;
}

/** Adds `count` puffs fanned `spread` radians either side of `angle`, `age` 0 (fresh) to 1 (gone). */
function spray(out: Puff[], from: Vec2, angle: number, spread: number, count: number, size: number, age: number, seed: number): void {
  const burst = 1 - (1 - age) * (1 - age);
  size *= FIGURE_SCALE;
  for (let i = 0; i < count; i++) {
    const a = angle + (noise(seed, i, 1) * 2 - 1) * spread;
    const reach = (0.5 + noise(seed, i, 2) * 1.3) * size * burst;
    out.push({
      pos: vec(from.x + Math.cos(a) * reach, from.y + Math.sin(a) * reach),
      radius: (0.18 + noise(seed, i, 3) * 0.25) * size * (0.6 + 0.6 * burst),
      alpha: 0.85 * Math.pow(1 - age, 1.5),
    });
  }
}

/** A repeatable 0 to 1 value, so each puff keeps its shape from frame to frame. */
const noise = (seed: number, i: number, j: number): number => {
  const x = Math.sin(seed * 12.9898 + i * 78.233 + j * 37.719) * 43758.5453;
  return x - Math.floor(x);
};

/** The run a skier is on and how far down it the frame sits, stepped back between ticks. */
function onRun(s: Skier, runs: readonly Run[], alpha: number): { run: Run; d: number; scared: boolean } | null {
  const state = s.state;
  if (state.kind !== 'skiing') return null;
  const run = runs.find((r) => r.id === state.runId);
  if (!run) return null;
  const { skiSpeed, scaredSpeedFactor } = CONFIG.skiers;
  const speed = skiSpeed[s.skill] * (state.scared ? scaredSpeedFactor : 1);
  // The state holds the distance after this tick; step back to where the frame sits between ticks.
  const d = Math.max(0, Math.min(run.profile.length, state.distance - speed * CONFIG.loop.gameSecondsPerTick * (1 - alpha)));
  return { run, d, scared: state.scared };
}

/** Each skier starts their turns at their own point in the rhythm so a crowd doesn't move in lockstep. */
const turnRate = (s: Skier): number => (Math.PI * 2) / TURN_LENGTH[s.skill];
const turnPhase = (s: Skier): number => (s.id * 2.399) % (Math.PI * 2);

/** Direction of travel down the run line at `d`, and the normal to its left. */
function frameAt(run: Run, d: number): { here: Vec2; t: Vec2; n: Vec2 } {
  const here = pointAlong(run.points, d), ahead = pointAlong(run.points, Math.min(run.profile.length, d + 1));
  const len = Math.hypot(ahead.x - here.x, ahead.y - here.y) || 1;
  const t = vec((ahead.x - here.x) / len, (ahead.y - here.y) / len);
  return { here, t, n: vec(-t.y, t.x) };
}

/** Jumps a skier's level enjoys get hit straight on; others are skied around like the simulation says. */
function jumpAt(s: Skier, run: Run, d: number): { straighten: number; air: number } {
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
  return { straighten, air };
}

/** Warped turn phase: the same turn edges and fall-line crossings, but quick across the fall line and slow at the edge. */
const warp = (s: Skier, theta: number): number => theta + (RHYTHM[s.skill] / 2) * Math.sin(2 * theta);

/** How far to the side of the run line the skier is at `d`, in metres. */
function sideAt(s: Skier, run: Run, d: number, scared: boolean): number {
  const width = TURN_WIDTH[s.skill] * jumpAt(s, run, d).straighten * (scared ? 1.3 : 1);
  return Math.sin(warp(s, d * turnRate(s) + turnPhase(s))) * width;
}

function poseAt(s: Skier, run: Run, d: number, scared: boolean): SkierPose {
  const { straighten, air } = jumpAt(s, run, d);
  const { here, t, n } = frameAt(run, d);
  const k = turnRate(s), theta = d * k + turnPhase(s), a = RHYTHM[s.skill];
  const width = TURN_WIDTH[s.skill] * straighten * (scared ? 1.3 : 1);
  const psi = warp(s, theta);
  const side = Math.sin(psi) * width, drift = Math.cos(psi) * width * k * (1 + a * Math.cos(2 * theta));
  return {
    pos: vec(here.x + n.x * side, here.y + n.y * side),
    heading: Math.atan2(t.y + n.y * drift, t.x + n.x * drift),
    air,
  };
}
