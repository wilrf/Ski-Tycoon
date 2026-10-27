import { CONFIG, type BuildingType } from '../config';
import { dist, type Vec2 } from './geometry';
import type { Lift } from './lifts';
import { isBase, type Mountain } from './network';
import { inBounds } from './terrain';

/** Somewhere skiers stop to eat and rest: a lodge in the base area, or a hut at a lift's top station. */
export interface Building {
  readonly id: number;
  readonly name: string;
  readonly type: BuildingType;
  readonly pos: Vec2;
}

/** The lift whose top station a hut serves, if it's close enough to one. */
export const hutLift = (m: Mountain, p: Vec2): Lift | undefined =>
  m.lifts.find((l) => dist(l.top, p) <= CONFIG.meals.hutReach);

/** Every reason a building can't go at p, ignoring money and stars, which the world checks. */
export function buildingProblems(m: Mountain, type: BuildingType, p: Vec2): string[] {
  if (!inBounds(m.terrain, p)) return ['That spot is off the map.'];
  if (type === 'lodge' && !isBase(m, p)) return ['A base lodge has to go in the flat base area.'];
  if (type === 'hut' && !hutLift(m, p)) return ['A mountain hut has to sit next to a lift’s top station.'];
  return [];
}

/** Buildings a skier standing at p can walk into: lodges from the base, huts at the lift top they're on. */
export const buildingsNear = (m: Mountain, buildings: readonly Building[], p: Vec2): Building[] =>
  buildings.filter((b) => (b.type === 'lodge' ? isBase(m, p) : dist(b.pos, p) <= CONFIG.meals.hutReach * 1.5));
