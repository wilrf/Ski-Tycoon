import { CONFIG } from '../config';
import { dist, type Vec2 } from './geometry';
import type { Lift } from './lifts';
import type { Run } from './runs';
import { TerrainType, typeAt, type Terrain } from './terrain';

/**
 * Connections are spatial, not stored: a run starts at any lift whose top station is close to its first
 * point, and ends at any lift whose bottom station is close to its last point. The base area is one hub,
 * so every lift that starts in it is reachable from anywhere in it.
 */
export interface Mountain {
  readonly terrain: Terrain;
  readonly lifts: readonly Lift[];
  readonly runs: readonly Run[];
}

export const isBase = (m: Mountain, p: Vec2): boolean => typeAt(m.terrain, p) === TerrainType.Base;

export const liftsFrom = (m: Mountain, p: Vec2): Lift[] =>
  m.lifts.filter((l) => dist(l.bottom, p) <= CONFIG.network.connectRadius || (isBase(m, p) && isBase(m, l.bottom)));

export const runsFromLift = (m: Mountain, lift: Lift): Run[] =>
  m.runs.filter((r) => dist(r.points[0]!, lift.top) <= CONFIG.network.connectRadius);

const runEnd = (run: Run): Vec2 => run.points[run.points.length - 1]!;

/** A run is skiable only if it finishes somewhere a skier can carry on from: a lift or the base. */
export const leadsSomewhere = (m: Mountain, run: Run): boolean => isBase(m, runEnd(run)) || liftsFrom(m, runEnd(run)).length > 0;
