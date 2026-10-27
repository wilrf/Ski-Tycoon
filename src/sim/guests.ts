import { CONFIG, type Skill } from '../config';
import { clamp } from './geometry';
import { nextFloat, pickWeighted, type Rng } from './rng';
import type { Skier } from './skiers';

/**
 * A person who has skied here. Skiers are today's visit; guests are who comes back. A good day raises
 * loyalty, a bad one drops it, and practice at their own level moves them up a level for next time.
 */
export interface Guest {
  readonly id: number;
  readonly name: string;
  skill: Skill;
  /** 0 to 1 toward the next skill level. */
  progress: number;
  /** 0 to 100: how likely they are to come back. */
  loyalty: number;
  visits: number;
  /** Set when they moved up a level on their last visit, so they can say so next time. */
  movedUp: boolean;
}

const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Jamie', 'Avery', 'Quinn', 'Dana', 'Robin', 'Kai', 'Noa', 'Lee', 'Sky', 'Remy', 'Ari', 'Jules', 'Sasha', 'Toni', 'Mika', 'Rowan', 'Emery', 'Blake', 'Drew', 'Hollis', 'Ellis', 'Marley', 'Reese'];
const LAST = 'ABCDEFGHJKLMNPRSTVW';

const SKILLS: readonly Skill[] = [0, 1, 2, 3, 4];

export function newGuest(id: number, rng: Rng, skillPull: readonly number[]): Guest {
  const first = FIRST[Math.floor(nextFloat(rng) * FIRST.length)]!;
  const last = LAST[Math.floor(nextFloat(rng) * LAST.length)]!;
  return {
    id,
    name: `${first} ${last}.`,
    skill: pickWeighted(rng, SKILLS, (s) => CONFIG.skiers.skillMix[s] * skillPull[s]!) ?? 0,
    progress: 0,
    loyalty: CONFIG.guests.startLoyalty,
    visits: 0,
    movedUp: false,
  };
}

/** Which regulars come today: each one rolls against their loyalty, scaled by price and weather. */
export function regularsComing(guests: readonly Guest[], rng: Rng, demand: number, skillPull: readonly number[]): number[] {
  return guests
    .filter((g) => nextFloat(rng) < clamp((g.loyalty / 100) * CONFIG.guests.returnRate * demand * Math.sqrt(skillPull[g.skill]!), 0, 0.95))
    .map((g) => g.id);
}

/** Updates a guest from how their visit went. Returns true if they moved up a level. */
export function recordVisit(g: Guest, s: Skier, happy: boolean): boolean {
  const { progressPerRun, progressPerStretch } = CONFIG.guests;
  g.visits++;
  g.loyalty = clamp(g.loyalty + (s.happiness - 55) * 0.5 + (happy ? 5 : -15) + s.apresLoyalty, 0, 100);
  // Nobody moves up in a single day, however much they ski.
  g.progress += Math.min(CONFIG.guests.maxProgressPerVisit, s.practice * progressPerRun + s.stretches * progressPerStretch);
  g.movedUp = g.progress >= 1 && g.skill < CONFIG.guests.maxTaughtSkill;
  if (g.movedUp) {
    g.skill = (g.skill + 1) as Skill;
    g.progress = 0;
  }
  return g.movedUp;
}

/** Keeps the guest list bounded by forgetting the least loyal. */
export function trimGuests(guests: Guest[]): Guest[] {
  if (guests.length <= CONFIG.guests.poolSize) return guests;
  return [...guests].sort((a, b) => b.loyalty - a.loyalty).slice(0, CONFIG.guests.poolSize);
}
