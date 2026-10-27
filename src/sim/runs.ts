import { CONFIG, type Level } from '../config';
import { clamp, pointAlong, polylineLength, type Vec2 } from './geometry';
import { heightAt, inBounds, type Terrain } from './terrain';

export type Difficulty = Level;

export interface RunProfile {
  readonly length: number;
  readonly vertical: number;
  readonly steepestGrade: number;
  readonly difficulty: Difficulty;
}

export interface Run {
  readonly id: number;
  readonly name: string;
  readonly points: readonly Vec2[];
  readonly profile: RunProfile;
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
  if (length === 0) return { length: 0, vertical: 0, steepestGrade: 0, difficulty: 0 };
  const samples = Math.ceil(length / CONFIG.runs.sampleStep);
  const step = length / samples;
  const heights = Array.from({ length: samples + 1 }, (_, i) => heightAt(t, pointAlong(points, i * step)));
  const window = clamp(Math.round(CONFIG.runs.steepnessWindow / step), 1, samples);
  let steepestGrade = 0;
  for (let i = 0; i + window <= samples; i++) {
    steepestGrade = Math.max(steepestGrade, (heights[i]! - heights[i + window]!) / (window * step));
  }
  return { length, vertical: heights[0]! - heights[samples]!, steepestGrade, difficulty: gradeToDifficulty(steepestGrade) };
}

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
export function funFor(run: Run, skill: Level, skiersOnRun: number, weatherFun: readonly number[] = [1, 1, 1, 1]): number {
  const gap = run.profile.difficulty - skill;
  const match = gap > 0 ? 0.4 : CONFIG.runs.belowSkillFun ** -gap;
  return clamp(rateRun(run, skiersOnRun).fun * match * weatherFun[run.profile.difficulty]!, 0, 10);
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
