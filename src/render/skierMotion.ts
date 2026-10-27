import { CONFIG, type FeatureType } from '../config';
import { pointAlong, vec, type Vec2 } from '../sim/geometry';
import type { Run } from '../sim/runs';
import type { Skier, SkillLevel } from '../sim/skiers';

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
  readonly stance: Stance;
  /** Carvers leave pencil-thin edge lines; skidders smear the snow. */
  readonly carving: boolean;
}

/**
 * How a skier skis. Skill makes each turn cleaner (less wobble) and widens the choice of turns: every
 * beginner snowploughs, while pros and olympians pick between race turns, freeride lines and a tuck.
 * Lengths and widths in metres; `rhythm` is how long they linger at a turn's edge before darting through
 * the fall line; `shape` below 1 squares the swing off into the Z of a skidded turn.
 */
interface Style {
  readonly length: number;
  readonly width: number;
  readonly rhythm: number;
  readonly shape: number;
  readonly wobble: number;
  /** Size of the snow thrown off each turn: skids throw lots, clean carves very little. */
  readonly spray: number;
  readonly stance: Stance;
  readonly carves: boolean;
}

/** How the skis sit: a V for the snowplough, side by side, or tucked tight for speed. */
export type Stance = 'wedge' | 'parallel' | 'tuck';

const STYLES = {
  snowplough: { length: 30, width: 5, rhythm: 0.45, shape: 1, wobble: 0.8, spray: 1.3, stance: 'wedge', carves: false },
  stemChristie: { length: 26, width: 6, rhythm: 0.4, shape: 0.8, wobble: 0.5, spray: 1.2, stance: 'parallel', carves: false },
  skidded: { length: 22, width: 6, rhythm: 0.35, shape: 0.55, wobble: 0.4, spray: 1.5, stance: 'parallel', carves: false },
  carve: { length: 20, width: 5, rhythm: 0.25, shape: 1, wobble: 0.15, spray: 0.8, stance: 'parallel', carves: true },
  shortTurns: { length: 10, width: 3, rhythm: 0.2, shape: 0.8, wobble: 0.1, spray: 1, stance: 'parallel', carves: false },
  giantSlalom: { length: 30, width: 7, rhythm: 0.15, shape: 1, wobble: 0.05, spray: 0.5, stance: 'parallel', carves: true },
  slalom: { length: 9, width: 2.5, rhythm: 0.1, shape: 1, wobble: 0.03, spray: 0.6, stance: 'parallel', carves: true },
  freeride: { length: 40, width: 4, rhythm: 0.1, shape: 1, wobble: 0.05, spray: 0.7, stance: 'parallel', carves: true },
  tuck: { length: 60, width: 1.5, rhythm: 0.05, shape: 1, wobble: 0, spray: 0.3, stance: 'tuck', carves: true },
} as const satisfies Record<string, Style>;

/** The styles each level can ski: one for beginners, two for intermediates and experts, three for pros, four for olympians. */
const SKILL_STYLES: Record<SkillLevel, readonly Style[]> = {
  0: [STYLES.snowplough],
  1: [STYLES.skidded, STYLES.stemChristie],
  2: [STYLES.carve, STYLES.shortTurns],
  3: [STYLES.giantSlalom, STYLES.slalom, STYLES.freeride],
  4: [STYLES.giantSlalom, STYLES.slalom, STYLES.freeride, STYLES.tuck],
};

/**
 * The style a skier uses on this run. Experts read the terrain: short turns on steep runs, carves on
 * gentler ones. Everyone else keeps the style that's theirs (by id) all day.
 */
function styleOf(s: Skier, run: Run): Style {
  const styles = SKILL_STYLES[s.skill];
  if (s.skill === 2) return run.profile.difficulty >= 2 ? STYLES.shortTurns : STYLES.carve;
  return styles[s.id % styles.length]!;
}

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
/** Puffs per turn; bigger sprays (see each style's `spray`) throw a few more. */
const sprayCount = (size: number): number => Math.round(4 + size * 4);
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
  const style = styleOf(s, run), k = (Math.PI * 2) / style.length, theta = d * k + turnPhase(s);
  const turn = Math.floor((theta - SPRAY_AT) / Math.PI);
  const back = (theta - SPRAY_AT - turn * Math.PI) / k;
  const side = d - back > 0 ? sideAt(s, run, d - back, scared) : 0;
  // No spray while running straight at a jump; otherwise it leaves the outside of the turn, the side the skier swung out to.
  if (back < SPRAY_FADE && side !== 0) {
    const { t, n } = frameAt(run, d - back), out = Math.sign(side);
    const angle = Math.atan2(n.y * out + t.y * 0.4, n.x * out + t.x * 0.4);
    const size = style.spray * (scared ? 1.3 : 1);
    spray(puffs, poseAt(s, run, d - back, scared).pos, angle, 0.6, sprayCount(size), size, back / SPRAY_FADE, s.id * 131 + turn);
  }

  // The hockey stop at the bottom throws a growing fan of snow ahead, downhill of the sideways skis.
  const stop = styleOf(s, run).stance === 'wedge' ? 0 : stopping(run, d);
  if (stop > 0) {
    const { t } = frameAt(run, d);
    spray(puffs, poseAt(s, run, d, scared).pos, Math.atan2(t.y, t.x), 0.9, 10, 1.4 * stop, 0.35, s.id * 389 + run.id);
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

/** Spacing and reach of the fresh line drawn behind a skier, in metres. */
const TRAIL_STEP = 1.5;
const TRAIL_LENGTH = 25;

/**
 * Where a skier has just been, newest first, like the wet streak behind a raindrop: their own carved
 * line, worked out again from the turn maths rather than stored.
 */
export function trailPoses(s: Skier, runs: readonly Run[], alpha: number): SkierPose[] {
  const on = onRun(s, runs, alpha);
  if (!on) return [];
  const poses: SkierPose[] = [];
  for (let back = 0; back <= TRAIL_LENGTH && on.d - back >= 0; back += TRAIL_STEP) poses.push(poseAt(s, on.run, on.d - back, on.scared));
  return poses;
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
const turnPhase = (s: Skier): number => (s.id * 2.399) % (Math.PI * 2);

/** Direction of travel down the run line at `d`, and the normal to its left. */
function frameAt(run: Run, d: number): { here: Vec2; t: Vec2; n: Vec2 } {
  // Measured over the metre ahead, or the last metre at the very bottom of the run.
  const from = Math.max(0, Math.min(d, run.profile.length - 1));
  const here = pointAlong(run.points, d), a = pointAlong(run.points, from), b = pointAlong(run.points, Math.min(run.profile.length, from + 1));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = vec((b.x - a.x) / len, (b.y - a.y) / len);
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

/**
 * How far to the side of the run line the skier is at `d`, in metres. The warped phase keeps every turn's
 * edge and fall-line crossing in place but changes the pace between them: quick across the fall line,
 * slow at the turn's edge. Less skilled skiers also wobble off their line.
 */
function sideAt(s: Skier, run: Run, d: number, scared: boolean): number {
  const style = styleOf(s, run), theta = (d * Math.PI * 2) / style.length + turnPhase(s);
  const swing = Math.sin(theta + (style.rhythm / 2) * Math.sin(2 * theta));
  const shaped = Math.sign(swing) * Math.pow(Math.abs(swing), style.shape);
  const wobble = style.wobble * Math.sin(d * 1.7 + s.id) * Math.sin(d * 0.63 + s.id * 3);
  return (shaped * style.width + wobble) * jumpAt(s, run, d).straighten * (scared ? 1.3 : 1) * (1 - stopping(run, d));
}

function poseAt(s: Skier, run: Run, d: number, scared: boolean): SkierPose {
  const at = (x: number): Vec2 => {
    const { here, n } = frameAt(run, x), side = sideAt(s, run, x, scared);
    return vec(here.x + n.x * side, here.y + n.y * side);
  };
  const pos = at(d), behind = at(Math.max(0, d - 0.5)), ahead = at(Math.min(run.profile.length, d + 0.5)), { t } = frameAt(run, d);
  // Into the stop, the skis swing across the hill, to the left or right as each skier prefers. Beginners
  // can't hockey stop: they push their snowplough wider instead.
  const style = styleOf(s, run), stop = style.stance === 'wedge' ? 0 : stopping(run, d);
  const swing = (s.id % 2 === 0 ? 1 : -1) * (Math.PI / 2) * stop * stop * (3 - 2 * stop);
  return {
    pos,
    // Settling into the stop, the line straightens back to the run's direction before the skis swing across.
    heading: Math.atan2((1 - stop) * (ahead.y - behind.y) + stop * t.y, (1 - stop) * (ahead.x - behind.x) + stop * t.x) + swing,
    air: jumpAt(s, run, d).air,
    stance: stop > 0.3 ? 'parallel' : style.stance,
    carving: style.carves && !scared,
  };
}

/** Skiers finish a run with a hockey stop over this many metres: skis swung sideways, snow sprayed ahead. */
const STOP_LENGTH = 6;
/** 0 until the last few metres of a run, rising to 1 at the bottom. */
const stopping = (run: Run, d: number): number => Math.max(0, 1 - (run.profile.length - d) / STOP_LENGTH);
