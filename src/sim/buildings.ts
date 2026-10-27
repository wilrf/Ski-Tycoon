import { CONFIG, type BuildingPart, type BuildingPartLevel, type BuildingType } from '../config';
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
  /** How many of CONFIG.lodgeUpgrades a lodge has had built onto it, in order. Huts don't grow. */
  upgrades: number;
  /** Levels owned of each CONFIG.buildingParts entry; missing on older saves. */
  parts?: Partial<Record<BuildingPart, number>>;
}

/** The levels a building of this type can add for the part, or none. */
export const partLevelsFor = (type: BuildingType, part: BuildingPart): readonly BuildingPartLevel[] =>
  (CONFIG.buildingParts[type] as Partial<Record<BuildingPart, readonly BuildingPartLevel[]>>)[part] ?? [];

export const buildingPartsFor = (type: BuildingType): BuildingPart[] =>
  (['kitchen', 'terrace'] as const).filter((p) => partLevelsFor(type, p).length > 0);

/** Every part level built so far, in order. */
const ownedParts = (b: Building): BuildingPartLevel[] =>
  buildingPartsFor(b.type).flatMap((p) => partLevelsFor(b.type, p).slice(0, b.parts?.[p] ?? 0));

export const nextBuildingPart = (b: Building, part: BuildingPart): BuildingPartLevel | undefined =>
  partLevelsFor(b.type, part)[b.parts?.[part] ?? 0];

/** Seats for lunch and après, including every extension and terrace built so far. */
export const seatsOf = (b: Building): number =>
  CONFIG.buildings[b.type].seats + CONFIG.lodgeUpgrades.slice(0, b.upgrades).reduce((sum, u) => sum + u.seats, 0) +
  ownedParts(b).reduce((sum, p) => sum + (p.seats ?? 0), 0);

/** What a meal costs here, and how much happier it leaves a skier, after kitchen upgrades. */
export const mealPriceOf = (b: Building): number => CONFIG.buildings[b.type].mealPrice + ownedParts(b).reduce((sum, p) => sum + (p.mealPrice ?? 0), 0);
export const mealJoyOf = (b: Building): number => CONFIG.meals.joy + ownedParts(b).reduce((sum, p) => sum + (p.mealJoy ?? 0), 0);

/** Everything spent on a building: its own price plus its extensions. */
export const buildingInvested = (b: Building): number =>
  CONFIG.buildings[b.type].cost + CONFIG.lodgeUpgrades.slice(0, b.upgrades).reduce((sum, u) => sum + u.cost, 0) +
  ownedParts(b).reduce((sum, p) => sum + p.cost, 0);

/** The next extension a lodge can have, or undefined for a hut or a lodge that's fully built out. */
export const nextLodgeUpgrade = (b: Building) => (b.type === 'lodge' ? CONFIG.lodgeUpgrades[b.upgrades] : undefined);

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
