/** Every tunable number in the game. Distances are metres, times are game seconds, money is dollars. */

export type LiftType = 'ropeTow' | 'chairlift' | 'gondola';
/** 0 = green / beginner, 1 = blue / intermediate, 2 = black / advanced, 3 = double black / expert. */
export type Level = 0 | 1 | 2 | 3;

export interface LiftSpec {
  readonly label: string;
  readonly baseCost: number;
  readonly costPerMetre: number;
  readonly speed: number;
  readonly capacityPerHour: number;
  readonly upkeepPerDay: number;
  readonly maxLength: number;
  /** Steepest average grade (rise / horizontal run) the lift can climb. */
  readonly maxGrade: number;
}

export const CONFIG = {
  loop: {
    ticksPerSecond: 10,
    gameSecondsPerTick: 3,
    speeds: [0, 1, 2, 4],
    maxTicksPerFrame: 40,
  },
  terrain: {
    size: 160,
    cellSize: 10,
    peakHeight: 520,
    ridgeHeight: 70,
    detailHeight: 14,
    /** Fraction of the map height where the flat base area begins. */
    baseLine: 0.82,
    treelineFraction: 0.5,
    rockGrade: 0.9,
  },
  runs: {
    /** Upper grade limits for green, blue and black; anything steeper is double black. */
    gradeLimits: [0.25, 0.4, 0.6],
    /** Steepness is measured over this many metres so single bumps don't decide a run's colour. */
    steepnessWindow: 20,
    sampleStep: 5,
    minLength: 60,
    minDropPerPoint: 1,
  },
  lifts: {
    ropeTow: { label: 'Rope tow', baseCost: 8_000, costPerMetre: 40, speed: 3, capacityPerHour: 700, upkeepPerDay: 150, maxLength: 400, maxGrade: 0.35 },
    chairlift: { label: 'Chairlift', baseCost: 80_000, costPerMetre: 250, speed: 2.5, capacityPerHour: 1800, upkeepPerDay: 900, maxLength: 1600, maxGrade: 1.0 },
    gondola: { label: 'Gondola', baseCost: 300_000, costPerMetre: 600, speed: 5, capacityPerHour: 2400, upkeepPerDay: 2500, maxLength: 3000, maxGrade: 1.5 },
  } satisfies Record<LiftType, LiftSpec>,
  liftRules: {
    minLength: 40,
    minRise: 5,
    /** Lift lines must stay this far from every other lift line. */
    clearance: 12,
  },
  network: {
    /** A run connects to a lift station within this distance. */
    connectRadius: 40,
  },
  calendar: {
    openHour: 9,
    lastArrivalHour: 14,
    closeHour: 16,
    /** Stragglers are sent home this long after closing. */
    sweepAfterClose: 3600,
  },
  economy: {
    startingCash: 500_000,
    ticketPrice: 59,
    removalRefund: 0.5,
  },
  skiers: {
    arrivalsPerHour: 240,
    maxOnMountain: 500,
    /** Arrivals scale with the number of runs, up to this many. */
    runsForFullDemand: 6,
    skillMix: [0.3, 0.4, 0.2, 0.1],
    skiSpeed: [4, 7, 10, 13],
    scaredSpeedFactor: 0.5,
    walkSpeed: 1.3,
    leaveSpeed: 4,
    cashRange: [40, 400],
    startHappiness: [65, 90],
    energyPerHour: 6,
    energyPerVerticalMetre: 0.015,
    tiredEnergy: 15,
    fedUpHappiness: 25,
    queueTolerance: 300,
    queueHappinessPerMinute: 1.5,
    bestRunJoy: 10,
    scaredPenalty: 15,
    rideDownPenalty: 10,
    /** Chance a skier with nothing comfortable tries a run one level above their skill. */
    braveChance: 0.3,
  },
} as const;
