import { vec, type Vec2 } from '../src/sim/geometry';
import type { Level, LiftType } from '../src/config';
import { planLift, type Lift } from '../src/sim/lifts';
import { createRng } from '../src/sim/rng';
import { createSkier, type Skier, type SkierContext } from '../src/sim/skiers';
import type { Mountain } from '../src/sim/network';
import type { Run } from '../src/sim/runs';
import { profileRun, type Difficulty } from '../src/sim/runs';
import { terrainFromHeights, type Terrain } from '../src/sim/terrain';

/** A 1 km square plane falling toward +y at `grade`, with the lowest 15% flat as the base. */
export const plane = (grade: number): Terrain => terrainFromHeights(100, 10, (p) => Math.max(0, 850 - p.y) * grade);

export const rng = (seed = 1) => createRng(seed);

let nextId = 1000;
export function makeRun(t: Terrain, points: Vec2[], name = 'Test'): Run {
  return { id: nextId++, name, points, profile: profileRun(t, points) };
}

/** A run with a fixed difficulty, for choice tests that don't care about terrain. */
export const runOf = (difficulty: Difficulty): Run => ({
  id: nextId++,
  name: `D${difficulty}`,
  points: [vec(0, 0), vec(0, 100)],
  profile: { length: 100, vertical: 30, steepestGrade: 0.3, difficulty },
});

export function makeLift(t: Terrain, id: number, bottom: Vec2, top: Vec2, type: LiftType = 'chairlift'): Lift {
  const { length, rise, cost } = planLift(t, [], 1e9, type, bottom, top);
  return { id, name: `Lift ${id}`, type, bottom, top, length, rise, queue: [], boardCredit: 0, tier: 0, invested: cost };
}

export const makeSkier = (pos: Vec2, skill: Level = 1, id = 1): Skier =>
  createSkier({ id, guestId: id, name: `Skier ${id}`, skill, cash: 200, happiness: 70, pos });

export const makeContext = (mountain: Mountain, overrides: Partial<SkierContext> = {}): SkierContext => ({
  mountain, buildings: [], occupancy: new Map(), rng: rng(3), closed: false, held: new Set(), exit: vec(500, 990),
  crowd: new Map(), weatherFun: [1, 1, 1, 1], time: 10 * 3600, journal: { tally: {}, quotes: {} }, spend: () => {}, ...overrides,
});
