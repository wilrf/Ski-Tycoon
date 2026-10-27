import { vec, type Vec2 } from '../src/sim/geometry';
import { createRng } from '../src/sim/rng';
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
