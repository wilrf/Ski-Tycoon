/** Every tunable number in the game. Distances are metres, times are game seconds, money is dollars. */

export type LiftType = 'ropeTow' | 'chairlift' | 'gondola';
/** 0 = green / beginner, 1 = blue / intermediate, 2 = black / advanced, 3 = double black / expert. */
export type Level = 0 | 1 | 2 | 3;
/** Skier skill: beginner, intermediate, expert, pro and olympic. Run colours stop at double black (Level 3). */
export type Skill = 0 | 1 | 2 | 3 | 4;
export type PerSkill = readonly [number, number, number, number, number];

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

export interface LiftTier {
  readonly name: string;
  readonly speedFactor: number;
  readonly capacityFactor: number;
  /** Upgrading to this tier costs this fraction of the lift's original price. */
  readonly upgradeCostFactor: number;
  /** Resort stars needed before this tier can be built. */
  readonly stars: number;
  /** Multiplies the rope tow's energy cost; a T-bar takes less grip than a rope. */
  readonly effort: number;
  /** Covered seats: a little happiness per ride, and the lift keeps running in a storm. */
  readonly covered: boolean;
}

export type Weather = 'bluebird' | 'cloudy' | 'powder' | 'storm' | 'warm';

export interface WeatherSpec {
  readonly label: string;
  readonly emoji: string;
  /** Multiplies arrivals. */
  readonly demand: number;
  /** Multiplies how fun a run is, by difficulty. */
  readonly fun: readonly [number, number, number, number];
  /** Multiplies the share of new visitors at each skill level. */
  readonly skillPull: PerSkill;
  /** Exposed lifts stop: the ones whose top is high up and whose seats aren't covered. */
  readonly windHold: boolean;
  /** Relative chances of tomorrow's weather. */
  readonly next: Readonly<Record<Weather, number>>;
}

export type BuildingType = 'lodge' | 'hut';

export type ApresPrice = 'low' | 'medium' | 'high';

export interface ApresTier {
  readonly label: string;
  readonly drinkPrice: number;
  /** Multiplies the share of skiers who stay for après. */
  readonly stay: number;
  /** Added to each après guest's loyalty. */
  readonly loyalty: number;
}

/** An extension built onto a base lodge, adding seats for lunch and après. */
export interface LodgeUpgrade {
  readonly name: string;
  readonly cost: number;
  readonly seats: number;
}

export interface BuildingSpec {
  readonly label: string;
  readonly cost: number;
  readonly seats: number;
  readonly mealPrice: number;
  readonly stars: number;
}

/** Things built onto a run to make it more interesting, from kids' adventure zones to terrain park jumps. */
export type FeatureType = 'rollers' | 'berms' | 'tunnel' | 'smallJump' | 'mediumJump' | 'largeJump';

export interface FeatureSpec {
  readonly label: string;
  /** How a skier names it: "Loved the berms on Raven Ridge". */
  readonly noun: string;
  readonly cost: number;
  /** Cat hours and park crew to keep it shaped. */
  readonly upkeepPerDay: number;
  /** How much beginners, intermediates, experts, pros and olympians like it, 0 to 1. Anyone at 0 rides around it. */
  readonly appeal: PerSkill;
}

export const CONFIG = {
  loop: {
    /** A 7-hour ski day takes about 4 real minutes at 1×. */
    ticksPerSecond: 35,
    gameSecondsPerTick: 3,
    /** Game-speed multipliers for pause, 1×, 3× and 6×. 8× made skiers too frantic to watch. */
    speeds: [0, 1, 3, 6],
    /** At each speed, draw one skier in this many, so fast-forward isn't a swarm. */
    drawEvery: [1, 1, 2, 3],
    maxTicksPerFrame: 80,
    /**
     * Zoomed in, time eases down so one skier can be followed the whole way down a run. Between these
     * zooms the pace falls smoothly to this many game seconds per real second (about 30 m a second for an
     * expert, a few seconds to cross the screen).
     */
    slowMotion: { fromZoom: 0.9, toZoom: 2.4, gameSecondsPerSecond: 3 },
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
    minLength: 150,
    minVertical: 20,
    minDropPerPoint: 1,
    /** Fun multiplier for each level a run sits below the skier's skill. */
    belowSkillFun: 0.65,
    /** Turning is only counted where the ground is at least this steep, so a winding cat track isn't fun. */
    curveMinGrade: 0.1,
    /** Radians of turning per 100 m that earn the full curve bonus: about 70°, a run that swings side to side. */
    fullCurviness: 1.2,
    /** Fun that a well-curved run adds for everyone. */
    curveFun: 1,
  },
  /** Prices are scaled to the game's lifts (a chair starts at $80k), not real dollars. */
  features: {
    rollers: { label: 'Rollers', noun: 'the rollers', cost: 6_000, upkeepPerDay: 100, appeal: [1, 0.6, 0.2, 0.1, 0] },
    berms: { label: 'Berms', noun: 'the berms', cost: 10_000, upkeepPerDay: 150, appeal: [0.8, 1, 0.6, 0.4, 0.3] },
    tunnel: { label: 'Adventure tunnel', noun: 'the tunnel', cost: 25_000, upkeepPerDay: 200, appeal: [1, 0.5, 0.2, 0, 0] },
    smallJump: { label: 'Small jump', noun: 'the small jump', cost: 12_000, upkeepPerDay: 250, appeal: [0.3, 1, 0.5, 0.2, 0.1] },
    mediumJump: { label: 'Medium jump', noun: 'the medium jump', cost: 25_000, upkeepPerDay: 450, appeal: [0, 0.3, 1, 0.6, 0.4] },
    largeJump: { label: 'Large jump', noun: 'the large jump', cost: 50_000, upkeepPerDay: 800, appeal: [0, 0, 0.4, 1, 1] },
  } satisfies Record<FeatureType, FeatureSpec>,
  featureRules: {
    maxPerRun: 4,
    /** Metres between features, and from either end of the run. */
    spacing: 40,
    /** Fun each point of appeal adds. */
    funPerAppeal: 1.5,
    /** Features and curves together add at most this much fun, and never more than the run already has. */
    maxFun: 3,
  },
  lifts: {
    ropeTow: { label: 'Rope tow', baseCost: 8_000, costPerMetre: 40, speed: 3, capacityPerHour: 700, upkeepPerDay: 150, maxLength: 800, maxGrade: 0.35 },
    chairlift: { label: 'Chairlift', baseCost: 80_000, costPerMetre: 250, speed: 2.5, capacityPerHour: 1200, upkeepPerDay: 900, maxLength: 1600, maxGrade: 1.0 },
    gondola: { label: 'Gondola', baseCost: 300_000, costPerMetre: 600, speed: 5, capacityPerHour: 2400, upkeepPerDay: 2500, maxLength: 3000, maxGrade: 1.5 },
  } satisfies Record<LiftType, LiftSpec>,
  /** Each lift starts at tier 0 and upgrades in place, keeping its line and its runs. */
  liftTiers: {
    ropeTow: [
      { name: 'Rope tow', speedFactor: 1, capacityFactor: 1, upgradeCostFactor: 0, stars: 0, effort: 1, covered: false },
      { name: 'T-bar', speedFactor: 1.2, capacityFactor: 1.6, upgradeCostFactor: 0.8, stars: 1, effort: 0.4, covered: false },
    ],
    chairlift: [
      { name: 'Double chair', speedFactor: 1, capacityFactor: 1, upgradeCostFactor: 0, stars: 0, effort: 0, covered: false },
      { name: 'Quad chair', speedFactor: 1, capacityFactor: 1.6, upgradeCostFactor: 0.5, stars: 2, effort: 0, covered: false },
      { name: 'High-speed quad', speedFactor: 2, capacityFactor: 1.6, upgradeCostFactor: 0.8, stars: 3, effort: 0, covered: false },
      { name: 'Six-pack bubble', speedFactor: 2, capacityFactor: 2.4, upgradeCostFactor: 1, stars: 4, effort: 0, covered: true },
    ],
    gondola: [
      { name: '8-seat gondola', speedFactor: 1, capacityFactor: 1, upgradeCostFactor: 0, stars: 0, effort: 0, covered: true },
      { name: '10-seat gondola', speedFactor: 1.2, capacityFactor: 1.5, upgradeCostFactor: 0.6, stars: 4, effort: 0, covered: true },
    ],
  } satisfies Record<LiftType, readonly LiftTier[]>,
  /** Stars needed before a lift type can be built. */
  liftStars: { ropeTow: 0, chairlift: 0, gondola: 3 } satisfies Record<LiftType, number>,
  buildings: {
    lodge: { label: 'Base lodge', cost: 60_000, seats: 120, mealPrice: 18, stars: 0 },
    hut: { label: 'Mountain hut', cost: 140_000, seats: 50, mealPrice: 26, stars: 2 },
  } satisfies Record<BuildingType, BuildingSpec>,
  meals: {
    /** Skiers get hungry at lunchtime or when their energy drops this low, and eat once a day. */
    lunchHour: 12,
    hungryEnergy: 55,
    seconds: 1200,
    energy: 35,
    joy: 6,
    fullPenalty: 4,
    /** A hut must sit this close to a lift's top station. */
    hutReach: 60,
  },
  /**
   * After the lifts close, some skiers head to a base lodge for drinks. Real après runs from lift close
   * until about 8 PM (the Mooserwirt in St. Anton shuts around then); about 31% of Aspen visitors take part.
   */
  apres: {
    /** Bars start pouring for skiers who are done for the day at 2:30 PM, like Cloud Nine and La Folie Douce. */
    openHour: 14.5,
    lastCallHour: 19.5,
    closeHour: 20,
    /**
     * Chance that a skier finishing their day after the bar opens stays, at the medium price and a typical mood.
     * Many skiers tire and leave earlier, so this comes out at about 30% of the day's skiers, as at Aspen.
     */
    stayShare: 0.7,
    /** Happiness at which the share is exactly stayShare; happier skiers stay more, grumpier ones less. */
    typicalHappiness: 70,
    staySeconds: [2700, 7200],
    drinks: [1, 3],
    joy: 4,
    /** Low pulls more guests and loyalty; high earns more a drink but puts 22% off (Sunweb survey). */
    prices: {
      low: { label: 'Low', drinkPrice: 5, stay: 1.25, loyalty: 2 },
      medium: { label: 'Medium', drinkPrice: 8, stay: 1, loyalty: 1 },
      high: { label: 'High', drinkPrice: 12, stay: 0.78, loyalty: -1 },
    } satisfies Record<ApresPrice, ApresTier>,
  },
  /** A base lodge grows in place, in this order. */
  lodgeUpgrades: [
    { name: 'Sun deck', cost: 40_000, seats: 80 },
    { name: 'Après bar wing', cost: 90_000, seats: 100 },
  ] satisfies readonly LodgeUpgrade[],
  liftRules: {
    minLength: 40,
    minRise: 5,
    /** Lift lines must stay this far from every other lift line. */
    clearance: 12,
  },
  network: {
    /** A run connects to a lift station within this distance. */
    connectRadius: 40,
    /** A run's first or last point within this distance of another run branches off or merges into it. */
    mergeRadius: 25,
  },
  calendar: {
    openHour: 9,
    lastArrivalHour: 14.5,
    closeHour: 16,
    /** Stragglers are sent home this long after closing. */
    sweepAfterClose: 3600,
  },
  economy: {
    startingCash: 500_000,
    /** The price skiers think is fair. Charging more brings fewer, grumpier skiers; less brings more, happier ones. */
    fairTicketPrice: 59,
    ticketPriceRange: [19, 149],
    ticketPriceStep: 5,
    /** Lift rides a skier wants in a day, for working out how many skiers the lifts carry comfortably. */
    ridesPerSkierDay: 8,
    /** Arrivals scale with (fair price / price) to this power. */
    priceSensitivity: 0.8,
    /** Happiness lost per dollar over the fair price, or gained per dollar under it. */
    overpricedHappinessPerDollar: 0.3,
    bargainHappinessPerDollar: 0.2,
    removalRefund: 0.5,
  },
  /** The resort's land, bought in bands from the bottom of the map up. fromY is a fraction of the map height. */
  land: [
    { name: 'Lower mountain', fromY: 0.5, cost: 0, stars: 0 },
    { name: 'Mid mountain', fromY: 0.28, cost: 250_000, stars: 2 },
    { name: 'Summit bowl', fromY: 0, cost: 600_000, stars: 4 },
  ],
  ui: {
    /** Taps this close to either end of a run or lift pick the run or lift; in between they pick skiers. */
    endTapMetres: 40,
  },
  review: {
    everyDays: 3,
    magazine: 'Powder Line',
    /** Cash prize the first time the resort reaches each star level. */
    starBonus: 50_000,
    /** Daily skiers for full marks on size, and lift-served vertical for full marks on terrain. */
    fullSizeSkiers: 700,
    fullVertical: 350,
  },
  requests: {
    active: 2,
    deadlineDays: [3, 5],
    baseReward: 40_000,
    reputation: 6,
  },
  guests: {
    poolSize: 1500,
    startLoyalty: 40,
    /** Chance a fully loyal regular comes on a given day, before weather and price. */
    returnRate: 0.45,
    /** Progress toward the next skill level from each comfortable run at their level, and each scary one survived. */
    progressPerRun: 0.05,
    progressPerStretch: 0.15,
    maxProgressPerVisit: 0.4,
    /** Guests can practise their way up to pro, but nobody becomes an olympian on holiday. */
    maxTaughtSkill: 3,
  },
  weather: {
    /** In a storm, exposed lifts whose top is above this fraction of the peak height stop on wind hold. */
    windHoldHeight: 0.45,
    kinds: {
      bluebird: { label: 'Bluebird', emoji: '☀️', demand: 1.2, fun: [1, 1, 1, 1], skillPull: [1, 1, 1, 1, 1], windHold: false, next: { bluebird: 3, cloudy: 3, powder: 1, storm: 1, warm: 1 } },
      cloudy: { label: 'Cloudy', emoji: '☁️', demand: 1, fun: [1, 1, 0.95, 0.95], skillPull: [1, 1, 1, 1, 1], windHold: false, next: { bluebird: 2, cloudy: 2, powder: 1, storm: 2, warm: 1 } },
      storm: { label: 'Storm', emoji: '🌨️', demand: 0.6, fun: [0.85, 0.9, 0.9, 0.9], skillPull: [0.6, 1, 1.3, 1.5, 1.5], windHold: true, next: { bluebird: 1, cloudy: 1, powder: 4, storm: 1, warm: 0 } },
      powder: { label: 'Powder day', emoji: '❄️', demand: 1.5, fun: [1, 1.15, 1.4, 1.5], skillPull: [0.7, 1, 1.8, 2.4, 2.4], windHold: false, next: { bluebird: 4, cloudy: 2, powder: 1, storm: 1, warm: 0 } },
      warm: { label: 'Spring slush', emoji: '🌤️', demand: 0.85, fun: [0.9, 0.85, 0.8, 0.75], skillPull: [1.2, 1, 0.8, 0.7, 0.7], windHold: false, next: { bluebird: 2, cloudy: 3, powder: 0, storm: 2, warm: 2 } },
    } satisfies Record<Weather, WeatherSpec>,
  },
  reputation: {
    start: 50,
    /** Each night reputation moves this far toward the share of skiers who went home happy. */
    dailyShift: 0.3,
    /** Arrivals are multiplied by a factor running from min at 0 reputation to max at 100. */
    demandRange: [0.6, 1.4],
  },
  skiers: {
    /** First-time visitors per hour at full demand; regulars come on top. */
    arrivalsPerHour: 170,
    maxOnMountain: 900,
    /** Arrivals scale with the number of runs, up to this many. */
    runsForFullDemand: 6,
    /** Olympians are a rare sight on a public mountain: about one guest in fifty. */
    skillMix: [0.3, 0.4, 0.2, 0.08, 0.02],
    skiSpeed: [4, 7, 10, 13, 16],
    scaredSpeedFactor: 0.5,
    walkSpeed: 1.3,
    leaveSpeed: 4,
    cashRange: [40, 400],
    startHappiness: [55, 85],
    energyPerHour: 6,
    energyPerVerticalMetre: 0.015,
    tiredEnergy: 15,
    fedUpHappiness: 25,
    queueTolerance: 300,
    queueHappinessPerMinute: 1.5,
    bestRunJoy: 10,
    scaredPenalty: 15,
    rideDownPenalty: 10,
    /** Hanging on to a rope tow is hard work, so long tows tire skiers out. */
    towEnergyPerMetre: 0.02,
    /** Riding a plain rope tow at least this long earns a complaint. */
    tiringTowLength: 450,
    /** Crowding (0 to 10) at or above this spoils a run, whatever its fun rating. */
    crowdedRunRating: 5,
    /** How long a feeling's emoji shows above a skier, in game seconds. */
    feelingShowSeconds: 360,
    logLength: 6,
    /** Chance a skier with nothing comfortable tries a run one level above their skill. */
    braveChance: 0.3,
  },
} as const;
