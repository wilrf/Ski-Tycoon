import { CONFIG } from '../config';
import { isBase, leadsSomewhere, runsFromLift } from './network';
import { nextFloat, nextRange, type Rng } from './rng';
import type { DayStats, Resort } from './world';

export type RequestKind = 'skiClub' | 'skiSchool' | 'proSkier' | 'bigVertical' | 'busyDay' | 'happyDay' | 'shortLines' | 'lunchRush';

/** A goal someone has asked the resort for, with a deadline and a cash reward. */
export interface Request {
  readonly id: number;
  readonly kind: RequestKind;
  readonly target: number;
  /** The last day it can be met on. */
  readonly deadline: number;
  readonly reward: number;
  status: 'active' | 'done' | 'failed';
}

interface Template {
  /** Rolls the target for a resort with this many stars. */
  readonly target: (rng: Rng, stars: number) => number;
  /** Whether the goal is met; stats is only given at the end of a day, for goals about a day's skiing. */
  readonly met: (resort: Resort, stats: DayStats | null, target: number) => boolean;
  /** Bigger asks pay more. */
  readonly rewardFactor: number;
}

const skiable = (resort: Resort) => resort.runs.filter((r) => leadsSomewhere(resort, r));
const day = (check: (s: DayStats, target: number) => boolean) => (_: Resort, s: DayStats | null, target: number): boolean => s !== null && check(s, target);

export const TEMPLATES: Readonly<Record<RequestKind, Template>> = {
  skiClub: {
    target: (rng) => (nextFloat(rng) < 0.5 ? 2 : 3),
    met: (r, _, n) => r.lifts.some((l) => runsFromLift(r, l).filter((run) => run.profile.difficulty === 1 && leadsSomewhere(r, run)).length >= n),
    rewardFactor: 1,
  },
  skiSchool: {
    target: () => 2,
    met: (r, _, n) => r.lifts.some((l) => isBase(r, l.bottom) && runsFromLift(r, l).filter((run) => run.profile.difficulty === 0 && leadsSomewhere(r, run)).length >= n),
    rewardFactor: 0.8,
  },
  proSkier: {
    target: (rng) => (nextFloat(rng) < 0.5 ? 0.6 : 0.7),
    met: (r, _, grade) => skiable(r).some((run) => run.profile.steepestGrade >= grade),
    rewardFactor: 1.5,
  },
  bigVertical: {
    target: (rng, stars) => Math.round((150 + stars * 50 + nextFloat(rng) * 50) / 10) * 10,
    met: (r, _, v) => skiable(r).some((run) => run.profile.vertical >= v),
    rewardFactor: 1.2,
  },
  busyDay: {
    target: (rng, stars) => Math.round((300 + stars * 120 + nextFloat(rng) * 100) / 50) * 50,
    met: day((s, n) => s.arrivals >= n),
    rewardFactor: 1.2,
  },
  happyDay: {
    target: () => 0.85,
    met: day((s, share) => s.arrivals >= 150 && s.leftHappy / Math.max(1, s.leftHappy + s.leftUnhappy) >= share),
    rewardFactor: 1,
  },
  shortLines: {
    target: () => 300,
    met: day((s, wait) => s.arrivals >= 200 && s.maxWait < wait),
    rewardFactor: 1.2,
  },
  lunchRush: {
    target: (rng, stars) => Math.round((80 + stars * 40 + nextFloat(rng) * 40) / 10) * 10,
    met: day((s, n) => s.meals >= n),
    rewardFactor: 0.8,
  },
};

const KINDS = Object.keys(TEMPLATES) as RequestKind[];

/** Offers a new request unlike any in `recent`. */
export function offerRequest(id: number, rng: Rng, today: number, stars: number, recent: readonly Request[]): Request {
  const options = KINDS.filter((k) => !recent.some((r) => r.kind === k));
  const kind = options[Math.floor(nextFloat(rng) * options.length)] ?? 'busyDay';
  const t = TEMPLATES[kind];
  const { baseReward, deadlineDays } = CONFIG.requests;
  const reward = Math.round((baseReward * (1 + stars * 0.5) * t.rewardFactor) / 5000) * 5000;
  return { id, kind, target: t.target(rng, stars), deadline: today + Math.round(nextRange(rng, deadlineDays)), reward, status: 'active' };
}

export const requestMet = (r: Request, resort: Resort, stats: DayStats | null): boolean => TEMPLATES[r.kind].met(resort, stats, r.target);
