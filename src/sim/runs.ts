import { CONFIG, type FeatureType, type Level, type Skill } from '../config';
import { clamp, pointAlong, polylineLength, type Vec2 } from './geometry';
import { heightAt, inBounds, type Terrain } from './terrain';

export type Difficulty = Level;

/** The run colour a skier is at home on: pros and olympians both belong on double blacks. */
export const runLevel = (skill: Skill): Level => (skill === 4 ? 3 : skill);

export interface RunProfile {
  readonly length: number;
  readonly vertical: number;
  readonly steepestGrade: number;
  readonly difficulty: Difficulty;
  /** Radians of turning per 100 m, counted only where the run is dropping, not traversing. */
  readonly curviness: number;
}

/** Something built onto a run, `at` metres down it. */
export interface RunFeature {
  readonly type: FeatureType;
  readonly at: number;
}

export interface Run {
  readonly id: number;
  readonly name: string;
  readonly points: readonly Vec2[];
  readonly profile: RunProfile;
  features: RunFeature[];
}

/** Each rating is 0 to 10. */
export interface RunRatings {
  readonly fun: number;
  readonly difficulty: number;
  readonly crowding: number;
}

export function gradeToDifficulty(grade: number): Difficulty {
  const i = CONFIG.runs.gradeLimits.findIndex((limit) => grade <= limit);
  return (i === -1 ? 3 : i) as Difficulty;
}

/** Difficulty comes from the steepest downhill stretch, averaged over a short window. */
export function profileRun(t: Terrain, points: readonly Vec2[]): RunProfile {
  const length = polylineLength(points);
  if (length === 0) return { length: 0, vertical: 0, steepestGrade: 0, difficulty: 0, curviness: 0 };
  const samples = Math.ceil(length / CONFIG.runs.sampleStep);
  const step = length / samples;
  const heights = Array.from({ length: samples + 1 }, (_, i) => heightAt(t, pointAlong(points, i * step)));
  const window = clamp(Math.round(CONFIG.runs.steepnessWindow / step), 1, samples);
  let steepestGrade = 0;
  for (let i = 0; i + window <= samples; i++) {
    steepestGrade = Math.max(steepestGrade, (heights[i]! - heights[i + window]!) / (window * step));
  }
  return { length, vertical: heights[0]! - heights[samples]!, steepestGrade, difficulty: gradeToDifficulty(steepestGrade), curviness: curviness(t, points, length) };
}

/** How much a run turns while it drops. Headings are taken every `window` metres so hand wobble doesn't count. */
function curviness(t: Terrain, points: readonly Vec2[], length: number): number {
  const window = CONFIG.runs.steepnessWindow;
  const steps = Math.floor(length / window);
  if (steps < 2) return 0;
  const at = Array.from({ length: steps + 1 }, (_, i) => pointAlong(points, i * window));
  let turning = 0;
  for (let i = 2; i <= steps; i++) {
    const a = at[i - 2]!, b = at[i - 1]!, c = at[i]!;
    if ((heightAt(t, a) - heightAt(t, c)) / (2 * window) < CONFIG.runs.curveMinGrade) continue;
    const turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    turning += Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  }
  return (turning / length) * 100;
}

/**
 * Extra fun from a run's curves and features for a skier of this level, before the cap that keeps a dull
 * run from being rescued by a jump. Skiers skip features that aren't for them, so these never hurt.
 */
export function featureFun(run: Run, skill: Skill): number {
  const curves = clamp(run.profile.curviness / CONFIG.runs.fullCurviness, 0, 1) * CONFIG.runs.curveFun;
  const built = run.features.reduce((sum, f) => sum + CONFIG.features[f.type].appeal[skill], 0) * CONFIG.featureRules.funPerAppeal;
  return Math.min(CONFIG.featureRules.maxFun, curves + built);
}

/** The feature this skier likes most on the run, or 'curves' when the shape is what they enjoyed. */
export function favouriteFeature(run: Run, skill: Skill): FeatureType | 'curves' | null {
  const best = run.features.reduce<RunFeature | null>((b, f) => (CONFIG.features[f.type].appeal[skill] > (b ? CONFIG.features[b.type].appeal[skill] : 0) ? f : b), null);
  if (best && CONFIG.features[best.type].appeal[skill] >= 0.5) return best.type;
  return run.profile.curviness >= CONFIG.runs.fullCurviness / 2 ? 'curves' : null;
}

/** Why this feature can't go `at` metres down the run, or null if it can. */
export function featureProblem(run: Run, type: FeatureType, at: number): string | null {
  const { maxPerRun, spacing } = CONFIG.featureRules;
  if (run.features.length >= maxPerRun) return `A run holds at most ${maxPerRun} features.`;
  if (type === 'tunnel' && run.features.some((f) => f.type === 'tunnel')) return 'This run already has a tunnel.';
  if (at < spacing || at > run.profile.length - spacing) return `Keep features at least ${spacing} m from the top and bottom of the run.`;
  if (run.features.some((f) => Math.abs(f.at - at) < spacing)) return `Features need ${spacing} m of space between them.`;
  return null;
}

export const featureUpkeep = (run: Run): number => run.features.reduce((sum, f) => sum + CONFIG.features[f.type].upkeepPerDay, 0);
export const featureInvestment = (run: Run): number => run.features.reduce((sum, f) => sum + CONFIG.features[f.type].cost, 0);

/** Why `p` can't be the next point after `prev`, or null if it can. */
export function runPointProblem(t: Terrain, prev: Vec2 | undefined, p: Vec2): string | null {
  if (!inBounds(t, p)) return 'That point is off the map.';
  if (prev && heightAt(t, p) > heightAt(t, prev) - CONFIG.runs.minDropPerPoint) return 'Runs must go downhill. Pick a lower point.';
  return null;
}

export function runProblems(t: Terrain, points: readonly Vec2[]): string[] {
  if (points.length < 2) return ['A run needs at least two points.'];
  const problems = points.map((p, i) => runPointProblem(t, points[i - 1], p)).filter((p): p is string => p !== null);
  if (polylineLength(points) < CONFIG.runs.minLength) problems.push(`Runs must be at least ${CONFIG.runs.minLength} m long.`);
  else if (heightAt(t, points[0]!) - heightAt(t, points[points.length - 1]!) < CONFIG.runs.minVertical) problems.push(`Runs need at least ${CONFIG.runs.minVertical} m of vertical drop.`);
  return problems;
}

/**
 * How much a skier of this level enjoys the run, 0 to 10. A run at their level is the most fun; each level
 * below it is duller (experts get bored on greens), and a run above it is mostly fear.
 */
export function funFor(run: Run, skill: Skill, skiersOnRun: number, weatherFun: readonly number[] = [1, 1, 1, 1]): number {
  const gap = run.profile.difficulty - runLevel(skill);
  const match = gap > 0 ? 0.4 : CONFIG.runs.belowSkillFun ** -gap;
  const base = rateRun(run, skiersOnRun).fun * match * weatherFun[run.profile.difficulty]!;
  // A skier out of their depth is too busy surviving to enjoy the berms.
  const extra = gap > 0 ? 0 : Math.min(featureFun(run, skill), base);
  return clamp(base + extra, 0, 10);
}

export function rateRun(run: Run, skiersOnRun: number): RunRatings {
  const { length, vertical, steepestGrade } = run.profile;
  // Five skiers per 100 m of trail is busy; ten is shoulder to shoulder.
  const crowding = clamp(skiersOnRun / Math.max(1, length / 100), 0, 10);
  return {
    fun: clamp(2 + Math.min(5, vertical / 60) + Math.min(3, length / 400) - crowding * 0.3, 0, 10),
    difficulty: clamp((steepestGrade / 0.8) * 10, 0, 10),
    crowding,
  };
}
