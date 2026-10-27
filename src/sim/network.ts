import { CONFIG } from '../config';
import { dist, projectOnPolyline, type Vec2 } from './geometry';
import type { Lift } from './lifts';
import type { Run } from './runs';
import { TerrainType, typeAt, type Terrain } from './terrain';

/**
 * Connections are spatial, not stored: a run starts at any lift whose top station is close to its first
 * point, and ends at any lift whose bottom station is close to its last point. The base area is one hub,
 * so every lift that starts in it is reachable from anywhere in it. Runs can also branch off and merge
 * into other runs: a run whose first point is on another run is a branch of it, and a run whose last
 * point lands on another run (rather than a lift or the base) carries on down that run.
 */
export interface Mountain {
  readonly terrain: Terrain;
  readonly lifts: readonly Lift[];
  readonly runs: readonly Run[];
}

/** Where one run joins another: the run, and how far along it the join is. */
export interface Junction {
  readonly run: Run;
  readonly at: number;
}

export const isBase = (m: Mountain, p: Vec2): boolean => typeAt(m.terrain, p) === TerrainType.Base;

export const liftsFrom = (m: Mountain, p: Vec2): Lift[] =>
  m.lifts.filter((l) => dist(l.bottom, p) <= CONFIG.network.connectRadius || (isBase(m, p) && isBase(m, l.bottom)));

export const runsFromLift = (m: Mountain, lift: Lift): Run[] =>
  m.runs.filter((r) => dist(r.points[0]!, lift.top) <= CONFIG.network.connectRadius);

export const runEnd = (run: Run): Vec2 => run.points[run.points.length - 1]!;

/** The run a point sits on, if any, other than `except`. Used for branch starts and merge ends. */
export function runAt(m: Mountain, p: Vec2, except?: Run): Junction | null {
  let best: (Junction & { gap: number }) | null = null;
  for (const run of m.runs) {
    if (run === except) continue;
    const { at, gap } = projectOnPolyline(p, run.points);
    if (gap <= CONFIG.network.mergeRadius && (!best || gap < best.gap)) best = { run, at, gap };
  }
  return best && { run: best.run, at: best.at };
}

interface Graph {
  readonly branches: ReadonlyMap<number, readonly Junction[]>;
  readonly merges: ReadonlyMap<number, Junction>;
  readonly leads: ReadonlyMap<number, boolean>;
}

const endsAtLiftOrBase = (m: Mountain, run: Run): boolean => isBase(m, runEnd(run)) || liftsFrom(m, runEnd(run)).length > 0;

function buildGraph(m: Mountain): Graph {
  const branches = new Map<number, Junction[]>();
  const merges = new Map<number, Junction>();
  for (const run of m.runs) {
    // A run that starts at a lift top isn't also a branch, so skiers don't loop back into it mid-run.
    const atLiftTop = m.lifts.some((l) => dist(run.points[0]!, l.top) <= CONFIG.network.connectRadius);
    const parent = atLiftTop ? null : runAt(m, run.points[0]!, run);
    if (parent) branches.set(parent.run.id, [...(branches.get(parent.run.id) ?? []), { run, at: parent.at }].sort((a, b) => a.at - b.at));
    const merge = endsAtLiftOrBase(m, run) ? null : runAt(m, runEnd(run), run);
    if (merge) merges.set(run.id, merge);
  }
  const leads = new Map<number, boolean>();
  const resolve = (run: Run, seen: Set<number>): boolean => {
    const known = leads.get(run.id);
    if (known !== undefined) return known;
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    const merge = merges.get(run.id);
    const result = endsAtLiftOrBase(m, run) || (merge !== undefined && resolve(merge.run, seen));
    leads.set(run.id, result);
    return result;
  };
  for (const run of m.runs) resolve(run, new Set());
  return { branches, merges, leads };
}

// Skiers ask about the graph every tick, so it's rebuilt only when a lift or run is added or removed.
const cache = new WeakMap<readonly Run[], { key: string; graph: Graph }>();
function graph(m: Mountain): Graph {
  const key = `${m.runs.map((r) => r.id).join(',')}|${m.lifts.map((l) => l.id).join(',')}`;
  const hit = cache.get(m.runs);
  if (hit?.key === key) return hit.graph;
  const built = buildGraph(m);
  cache.set(m.runs, { key, graph: built });
  return built;
}

/** Runs that branch off this one, in order down it. */
export const branchesOf = (m: Mountain, run: Run): readonly Junction[] => graph(m).branches.get(run.id) ?? [];

/** The run this one flows into when it doesn't end at a lift or the base. */
export const mergeOf = (m: Mountain, run: Run): Junction | undefined => graph(m).merges.get(run.id);

/** A run is skiable only if it finishes, directly or through runs it merges into, at a lift or the base. */
export const leadsSomewhere = (m: Mountain, run: Run): boolean => graph(m).leads.get(run.id) ?? false;
