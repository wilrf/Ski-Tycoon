import { CONFIG, type ApresPrice, type BuildingPart, type BuildingType, type FeatureType, type Grooming, type LiftType } from '../config';
import { buildingInvested, buildingProblems, nextBuildingPart, nextLodgeUpgrade, type Building } from './buildings';
import { build, createCompany, earn, emptyLedger, payUpkeep, priceDemand, refund, sellTicket, type Company, type Ledger } from './economy';
import { clamp, dist, pointAlong, vec, type Vec2 } from './geometry';
import { newGuest, recordVisit, regularsComing, trimGuests, type Guest } from './guests';
import { boardLift, isCovered, liftCapacity, nextPartLevel, nextTier, partCost, partLevel, partsFor, windHoldHeight, type LiftPart, planLift, queueSpot, upgradeCost, waitSeconds, type Lift, type LiftPlan } from './lifts';
import { isBase, liftsFrom, runAt, type Mountain } from './network';
import { emptyWeek, landProblem, writeReview, type Review, type Week } from './progress';
import { offerRequest, requestMet, type Request } from './requests';
import { createRng, nextFloat, nextRange, type Rng } from './rng';
import { featureInvestment, featureProblem, featureUpkeep, groomedTonight, groomingCost, nextWidening, profileRun, runProblems, wideningCost, type Run } from './runs';
import { boardSkier, createSkier, feel, feelPrice, updateSkier, type FeelingTally, type Skier, type SkierContext } from './skiers';
import { generateTerrain, heightAt, terrainExtent, type Terrain } from './terrain';
import { advanceForecast, nextWeather, weatherSpec, type Forecast } from './weather';

export interface Calendar {
  day: number;
  /** Seconds since midnight. */
  time: number;
}

export interface DayStats {
  arrivals: number;
  /** Arrivals who had been before. */
  regulars: number;
  leftHappy: number;
  leftUnhappy: number;
  meals: number;
  /** Skiers who stayed for après, and those who wanted to but found every lodge full. */
  apresGuests: number;
  apresTurnedAway: number;
  /** Guests who moved up a skill level today. */
  movedUp: number;
  /** The longest lift line of the day, in seconds of waiting. */
  maxWait: number;
  feelings: FeelingTally;
}

export interface Resort extends Mountain {
  readonly name: string;
  readonly terrain: Terrain;
  /** Where skiers arrive and where they walk to when they go home. */
  readonly entrance: Vec2;
  lifts: Lift[];
  runs: Run[];
  buildings: Building[];
  skiers: Skier[];
  guests: Guest[];
  /** Regulars who decided this morning to come today, in arrival order. */
  coming: number[];
  /** Fractional arrivals owed by the arrival rates. */
  arrivalCredit: number;
  regularCredit: number;
  regularsPerSecond: number;
  ticketPrice: number;
  apresPrice: ApresPrice;
  /** 0 to 100: word of mouth. It drives how many first-time visitors come. */
  reputation: number;
  /** How many bands of CONFIG.land the resort owns, from the bottom up. */
  land: number;
  today: DayStats;
  week: Week;
}

export interface World {
  readonly seed: number;
  readonly rng: Rng;
  nextId: number;
  readonly company: Company;
  readonly calendar: Calendar;
  readonly weather: Forecast;
  requests: Request[];
  reviews: Review[];
  readonly resorts: Resort[];
}

export type Command =
  | { readonly type: 'buildLift'; readonly liftType: LiftType; readonly bottom: Vec2; readonly top: Vec2 }
  | { readonly type: 'removeLift'; readonly id: number }
  | { readonly type: 'upgradeLift'; readonly id: number }
  | { readonly type: 'upgradeLiftPart'; readonly id: number; readonly part: LiftPart }
  | { readonly type: 'buildRun'; readonly points: readonly Vec2[] }
  | { readonly type: 'removeRun'; readonly id: number }
  | { readonly type: 'addFeature'; readonly runId: number; readonly featureType: FeatureType; readonly at: number }
  | { readonly type: 'clearFeatures'; readonly runId: number }
  | { readonly type: 'buildBuilding'; readonly buildingType: BuildingType; readonly pos: Vec2 }
  | { readonly type: 'removeBuilding'; readonly id: number }
  | { readonly type: 'upgradeLodge'; readonly id: number }
  | { readonly type: 'upgradeBuildingPart'; readonly id: number; readonly part: BuildingPart }
  | { readonly type: 'setGrooming'; readonly runId: number; readonly grooming: Grooming }
  | { readonly type: 'widenRun'; readonly runId: number }
  | { readonly type: 'setApresPrice'; readonly price: ApresPrice }
  | { readonly type: 'setTicketPrice'; readonly price: number }
  | { readonly type: 'buyLand' };

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface DayReport {
  readonly type: 'dayEnded';
  readonly day: number;
  readonly stats: DayStats;
  readonly ledger: Ledger;
  readonly reputation: { readonly before: number; readonly after: number };
  readonly forecast: Forecast;
  readonly done: readonly Request[];
  readonly failed: readonly Request[];
  readonly offered: readonly Request[];
  readonly review: Review | null;
  /** Stars earned for the first time with this review, and the cash that came with them. */
  readonly newStars: number;
  readonly starBonus: number;
}

export type WorldEvent = DayReport | { readonly type: 'requestDone'; readonly request: Request };

const emptyStats = (): DayStats => ({ arrivals: 0, regulars: 0, leftHappy: 0, leftUnhappy: 0, meals: 0, apresGuests: 0, apresTurnedAway: 0, movedUp: 0, maxWait: 0, feelings: {} });

/** A mountain to build on: its terrain and the resort's starting name. */
export interface MountainSite {
  readonly terrain: Terrain;
  readonly name: string;
}

export function createWorld(seed: number, site: MountainSite = { terrain: generateTerrain(seed), name: 'Summit Peak' }): World {
  const { terrain, name } = site;
  const extent = terrainExtent(terrain);
  const rng = createRng(seed ^ 0x5eed);
  const world: World = {
    seed,
    rng,
    nextId: 1,
    company: createCompany('Summit Resorts'),
    calendar: { day: 1, time: CONFIG.calendar.openHour * 3600 },
    weather: { today: 'bluebird', tomorrow: nextWeather(rng, 'bluebird') },
    requests: [],
    reviews: [],
    resorts: [{
      name, terrain, entrance: vec(extent / 2, extent - 15),
      lifts: [], runs: [], buildings: [], skiers: [], guests: [], coming: [],
      arrivalCredit: 0, regularCredit: 0, regularsPerSecond: 0,
      ticketPrice: CONFIG.economy.fairTicketPrice, apresPrice: 'medium', reputation: CONFIG.reputation.start, land: 1,
      today: emptyStats(), week: emptyWeek(),
    }],
  };
  fillRequests(world);
  return world;
}

/** One resort for now; the company and calendar are already shaped for more. */
export const activeResort = (world: World): Resort => world.resorts[0]!;

export const isClosed = (world: World): boolean => world.calendar.time >= CONFIG.calendar.closeHour * 3600;

/** The lifts are closed but the après bars are still serving. */
export const isApres = (world: World): boolean => isClosed(world) && world.calendar.time < CONFIG.apres.closeHour * 3600;

const atBar = (s: Skier): boolean => s.state.kind === 'toBar' || s.state.kind === 'apres';

const ARRIVAL_SECONDS = (CONFIG.calendar.lastArrivalHour - CONFIG.calendar.openHour) * 3600;

/** How strongly word of mouth, price and weather pull skiers in, as a multiplier on arrivals. */
export function demandFactor(world: World, resort: Resort): number {
  const [low, high] = CONFIG.reputation.demandRange;
  return (low + ((high - low) * resort.reputation) / 100) * priceDemand(resort.ticketPrice) * weatherSpec(world.weather.today).demand;
}

export interface DayForecast {
  /** About how many skiers a full day would bring at this price, in today's weather. */
  readonly skiers: number;
  readonly tickets: number;
  /**
   * Skiers the lifts can carry without long lines: hourly lift capacity over the day, divided by the rides
   * a skier wants. Real resorts plan to a "comfortable carrying capacity" worked out the same way.
   */
  readonly comfortable: number;
}

/** What a day would look like at `price`, from the same demand the arrivals use. */
export function forecastDay(world: World, resort: Resort, price: number): DayForecast {
  const { arrivalsPerHour, runsForFullDemand } = CONFIG.skiers;
  const demand = (demandFactor(world, resort) / priceDemand(resort.ticketPrice)) * priceDemand(price);
  const runDemand = 0.3 + 0.7 * Math.min(1, resort.runs.length / runsForFullDemand);
  const pull = weatherSpec(world.weather.today).skillPull;
  const regulars = resort.guests.reduce(
    (sum, g) => sum + clamp((g.loyalty / 100) * CONFIG.guests.returnRate * demand * Math.sqrt(pull[g.skill]!), 0, 0.95), 0);
  const skiers = resort.lifts.length === 0 ? 0 : Math.round((arrivalsPerHour * runDemand * demand * ARRIVAL_SECONDS) / 3600 + regulars);
  const { openHour, closeHour } = CONFIG.calendar;
  const comfortable = Math.round(resort.lifts.reduce((sum, l) => sum + liftCapacity(l), 0) * (closeHour - openHour) / CONFIG.economy.ridesPerSkierDay);
  return { skiers, tickets: skiers * price, comfortable };
}

/** Each morning, every regular decides whether to come today. */
function planDay(world: World, resort: Resort): void {
  resort.coming = regularsComing(resort.guests, world.rng, demandFactor(world, resort), weatherSpec(world.weather.today).skillPull);
  resort.regularsPerSecond = resort.coming.length / ARRIVAL_SECONDS;
}

// A terrain's height span is fixed, and the storm check needs it every tick.
const spans = new WeakMap<Terrain, { low: number; high: number }>();
const spanOf = (t: Terrain): { low: number; high: number } =>
  spans.get(t) ?? spans.set(t, { low: Math.min(...t.heights), high: Math.max(...t.heights) }).get(t)!;

/**
 * Lifts the wind has stopped today: exposed seats whose top station is high on the mountain. "High" is measured
 * from the map's lowest point, so a real peak whose base sits 5,000 m up is judged like any other mountain.
 */
export function heldLifts(world: World, resort: Resort): Set<number> {
  if (!weatherSpec(world.weather.today).windHold) return new Set();
  const { low, high } = spanOf(resort.terrain);
  return new Set(resort.lifts.filter((l) => !isCovered(l) && heightAt(resort.terrain, l.top) - low > (high - low) * windHoldHeight(l)).map((l) => l.id));
}

/** Advances the world by one fixed step of dt game seconds. */
export function tick(world: World, dt: number = CONFIG.loop.gameSecondsPerTick): WorldEvent[] {
  world.calendar.time += dt;
  const closed = isClosed(world);
  for (const resort of world.resorts) stepResort(world, resort, dt, closed);
  const events: WorldEvent[] = [];
  // Goals about what's built are checked every few game minutes, so finishing one feels immediate.
  if (world.calendar.time % 300 < dt) events.push(...checkRequests(world, null));
  // The day ends once everyone has gone home, or when the last bar shuts.
  const barsShut = world.calendar.time >= CONFIG.apres.closeHour * 3600;
  if (closed && (barsShut || world.resorts.every((r) => r.skiers.length === 0))) events.push(endDay(world));
  return events;
}

function stepResort(world: World, resort: Resort, dt: number, closed: boolean): void {
  if (world.calendar.time < CONFIG.calendar.lastArrivalHour * 3600) admitArrivals(world, resort, dt);
  const held = heldLifts(world, resort);
  const byId = new Map(resort.skiers.map((s) => [s.id, s]));
  for (const lift of resort.lifts) {
    if (closed) lift.queue.length = 0;
    resort.today.maxWait = Math.max(resort.today.maxWait, waitSeconds(lift));
    if (held.has(lift.id)) continue;
    for (const id of boardLift(lift, dt)) {
      const skier = byId.get(id);
      if (skier) boardSkier(skier, lift);
    }
  }
  const crowd = new Map<number, number>();
  const occupancy = new Map<number, number>();
  for (const s of resort.skiers) {
    if (s.state.kind === 'skiing') crowd.set(s.state.runId, (crowd.get(s.state.runId) ?? 0) + 1);
    const k = s.state.kind;
    if (k === 'eating' || k === 'toBuilding' || k === 'toBar' || k === 'apres') occupancy.set(s.state.buildingId, (occupancy.get(s.state.buildingId) ?? 0) + 1);
  }
  const ctx: SkierContext = {
    mountain: resort, buildings: resort.buildings, occupancy, rng: world.rng, closed, held, exit: resort.entrance, crowd,
    weatherFun: weatherSpec(world.weather.today).fun, time: world.calendar.time,
    journal: { tally: resort.today.feelings, quotes: resort.week.quotes },
    apresPrice: CONFIG.apres.prices[resort.apresPrice],
    spend: (amount, what) => {
      earn(world.company, what === 'meal' ? 'food' : 'apres', amount);
      if (what === 'meal') resort.today.meals++;
      else resort.today.apresGuests++;
    },
    turnedAway: () => resort.today.apresTurnedAway++,
  };
  // Ski patrol sweeps the mountain an hour after close: anyone still out goes home. Après guests are already down.
  if (world.calendar.time >= CONFIG.calendar.closeHour * 3600 + CONFIG.calendar.sweepAfterClose) {
    resort.skiers = resort.skiers.filter((s) => {
      if (atBar(s)) return true;
      goHome(resort, s, s.state.kind === 'leaving' ? s.state.happy : s.happiness >= CONFIG.skiers.fedUpHappiness);
      return false;
    });
  }
  resort.skiers = resort.skiers.filter((s) => {
    if (updateSkier(ctx, s, dt)) return true;
    goHome(resort, s, s.state.kind === 'leaving' && s.state.happy);
    return false;
  });
  for (const lift of resort.lifts) lift.queue.forEach((id, i) => {
    const skier = byId.get(id);
    if (skier) skier.pos = queueSpot(lift, i);
  });
}

function goHome(resort: Resort, s: Skier, happy: boolean): void {
  if (happy) resort.today.leftHappy++;
  else resort.today.leftUnhappy++;
  const guest = resort.guests.find((g) => g.id === s.guestId);
  if (guest && recordVisit(guest, s, happy)) resort.today.movedUp++;
}

/**
 * Nobody buys a ticket to a resort with no lift from the base. First-time visitors come at a rate set by
 * demand, which grows with the number of runs; regulars who decided to come this morning arrive on top.
 */
function admitArrivals(world: World, resort: Resort, dt: number): void {
  if (liftsFrom(resort, resort.entrance).length === 0) return;
  const { arrivalsPerHour, runsForFullDemand } = CONFIG.skiers;
  const runDemand = 0.3 + 0.7 * Math.min(1, resort.runs.length / runsForFullDemand);
  resort.arrivalCredit += (arrivalsPerHour * runDemand * demandFactor(world, resort) * dt) / 3600;
  resort.regularCredit += resort.regularsPerSecond * dt;
  for (; resort.arrivalCredit >= 1; resort.arrivalCredit--) {
    const guest = newGuest(world.nextId++, world.rng, weatherSpec(world.weather.today).skillPull);
    resort.guests.push(guest);
    admit(world, resort, guest);
  }
  for (; resort.regularCredit >= 1 && resort.coming.length > 0; resort.regularCredit--) {
    const id = resort.coming.shift()!;
    const guest = resort.guests.find((g) => g.id === id);
    if (guest) admit(world, resort, guest);
  }
}

function admit(world: World, resort: Resort, guest: Guest): void {
  if (resort.skiers.length >= CONFIG.skiers.maxOnMountain) return;
  const pos = vec(resort.entrance.x + (nextFloat(world.rng) - 0.5) * 60, resort.entrance.y);
  const skier = createSkier({
    id: world.nextId++, guestId: guest.id, name: guest.name, skill: guest.skill, pos,
    cash: Math.round(nextRange(world.rng, CONFIG.skiers.cashRange)), happiness: nextRange(world.rng, CONFIG.skiers.startHappiness),
  });
  if (!sellTicket(world.company, skier, resort.ticketPrice)) return;
  const journal = { tally: resort.today.feelings, quotes: resort.week.quotes };
  const time = world.calendar.time;
  feelPrice(journal, skier, resort.ticketPrice, time);
  if (guest.movedUp) {
    feel(journal, time, skier, 'movedUp', 5, '');
    skier.thought = { kind: 'movedUp', skill: guest.skill };
    guest.movedUp = false;
  } else if (guest.visits > 0) skier.thought = { kind: 'back', visits: guest.visits + 1 };
  resort.skiers.push(skier);
  resort.today.arrivals++;
  if (guest.visits > 0) resort.today.regulars++;
}

/** Marks requests done or failed. Goals about a day's skiing only count when its stats are given. */
function checkRequests(world: World, stats: DayStats | null): WorldEvent[] {
  const resort = activeResort(world);
  const events: WorldEvent[] = [];
  for (const r of world.requests) {
    if (r.status !== 'active' || !requestMet(r, resort, stats)) continue;
    r.status = 'done';
    earn(world.company, 'bonuses', r.reward);
    resort.reputation = clamp(resort.reputation + CONFIG.requests.reputation, 0, 100);
    if (!stats) events.push({ type: 'requestDone', request: r });
  }
  return events;
}

function fillRequests(world: World): Request[] {
  const active = () => world.requests.filter((r) => r.status === 'active');
  const offered: Request[] = [];
  while (active().length < CONFIG.requests.active) {
    // Anything still on the list (active or recently finished) isn't offered again straight away.
    const r = offerRequest(world.nextId++, world.rng, world.calendar.day, world.company.stars, world.requests);
    world.requests.push(r);
    offered.push(r);
  }
  return offered;
}

function endDay(world: World): DayReport {
  const resort = activeResort(world);
  for (const s of resort.skiers) goHome(resort, s, s.happiness >= CONFIG.skiers.fedUpHappiness);
  resort.skiers = [];
  for (const l of resort.lifts) l.queue.length = 0;
  const stats = resort.today;
  const day = world.calendar.day;

  // Requests: day goals are checked against today, and anything past its deadline fails.
  const before = world.requests.filter((r) => r.status === 'active');
  checkRequests(world, stats);
  for (const r of before) if (r.status === 'active' && r.deadline <= day) {
    r.status = 'failed';
    resort.reputation = clamp(resort.reputation - CONFIG.requests.reputation, 0, 100);
  }
  const done = before.filter((r) => r.status === 'done');
  const failed = before.filter((r) => r.status === 'failed');

  // Word of mouth moves toward the share of skiers who went home happy.
  const reputationBefore = resort.reputation;
  const left = stats.leftHappy + stats.leftUnhappy;
  if (left > 0) resort.reputation += ((stats.leftHappy / left) * 100 - resort.reputation) * CONFIG.reputation.dailyShift;

  const { week } = resort;
  week.days++;
  week.arrivals += stats.arrivals;
  week.leftHappy += stats.leftHappy;
  week.leftUnhappy += stats.leftUnhappy;
  for (const [kind, t] of Object.entries(stats.feelings) as [keyof FeelingTally, { count: number; delta: number }][]) {
    const w = (week.tally[kind] ??= { count: 0, delta: 0 });
    w.count += t.count;
    w.delta += t.delta;
  }

  let review: Review | null = null;
  let newStars = 0;
  let starBonus = 0;
  if (day % CONFIG.review.everyDays === 0) {
    review = writeReview(resort, day);
    world.reviews = [...world.reviews.slice(-4), review];
    newStars = Math.max(0, review.stars - world.company.stars);
    for (let s = world.company.stars + 1; s <= review.stars; s++) starBonus += CONFIG.review.starBonus * s;
    world.company.stars = Math.max(world.company.stars, review.stars);
    if (starBonus > 0) earn(world.company, 'bonuses', starBonus);
    resort.week = emptyWeek();
  }

  world.requests = world.requests.filter((r) => r.status === 'active' || r.deadline > day - 3);
  // Park crews reshape the features overnight, and the cats groom the runs on tonight's plan.
  const groomed = resort.runs.filter((r) => groomedTonight(r, day));
  for (const r of groomed) r.snow = 1;
  const upkeep = resort.runs.reduce((sum, r) => sum + featureUpkeep(r), 0) + groomed.reduce((sum, r) => sum + groomingCost(r), 0);
  if (upkeep > 0) payUpkeep(world.company, upkeep);
  const ledger = world.company.today;
  world.company.today = emptyLedger();
  world.calendar.day++;
  world.calendar.time = CONFIG.calendar.openHour * 3600;
  advanceForecast(world.weather, world.rng);
  // A powder day buries yesterday's tracks and bumps on every run.
  if (world.weather.today === 'powder') for (const r of resort.runs) r.snow = 1;
  const offered = fillRequests(world);
  resort.guests = trimGuests(resort.guests);
  resort.arrivalCredit = resort.regularCredit = 0;
  resort.today = emptyStats();
  planDay(world, resort);
  return {
    type: 'dayEnded', day, stats, ledger, reputation: { before: reputationBefore, after: resort.reputation },
    forecast: { ...world.weather }, done, failed, offered, review, newStars, starBonus,
  };
}

const LIFT_WORDS = ['Summit', 'Eagle', 'Ridge', 'Powder', 'Aspen', 'Bear', 'Glacier', 'Sunrise', 'Timber', 'Falcon', 'Cougar', 'Raven', 'Comet', 'Lynx', 'Bluebird'];
const LIFT_SUFFIX: Record<LiftType, string> = { ropeTow: 'Tow', chairlift: 'Express', gondola: 'Gondola' };
const RUN_FIRST = ['Lone', 'Big', 'Hidden', 'Upper', 'Lower', 'Crystal', 'Silver', 'Wild', 'Lazy', 'Thunder', 'Misty', 'Rusty', 'Golden', 'Quiet', 'Broken'];
const RUN_SECOND = ['Pine', 'Bowl', 'Chute', 'Trail', 'Ridge', 'Glade', 'Way', 'Gulch', 'Canyon', 'Meadow', 'Spur', 'Hollow'];
const BUILDING_WORDS = ['Alpenglow', 'Edelweiss', 'Woodsmoke', 'Antler', 'Cocoa', 'Fireside', 'Larch', 'Marmot', 'Snowberry', 'Timberline'];
const BUILDING_SUFFIX: Record<BuildingType, string> = { lodge: 'Lodge', hut: 'Hut' };

function uniqueName(rng: Rng, taken: readonly string[], ...parts: readonly (readonly string[])[]): string {
  const roll = (): string => parts.map((words) => words[Math.floor(nextFloat(rng) * words.length)]).join(' ');
  for (let i = 0; i < 20; i++) {
    const name = roll();
    if (!taken.includes(name)) return name;
  }
  return `${roll()} ${taken.length + 1}`;
}

/** Plans a lift the way the world will judge it: terrain and money, plus land and stars. */
export function planLiftHere(world: World, type: LiftType, bottom: Vec2, top: Vec2): LiftPlan {
  const resort = activeResort(world);
  const plan = planLift(resort.terrain, resort.lifts, world.company.money, type, bottom, top);
  const extra: string[] = [];
  const stars = CONFIG.liftStars[type];
  if (world.company.stars < stars) extra.push(`The ${CONFIG.lifts[type].label.toLowerCase()} unlocks at ${stars}★.`);
  const land = landProblem(resort, [bottom, top]);
  if (land) extra.push(land);
  return { ...plan, problems: [...extra, ...plan.problems] };
}

/** The most a lift of this type from `bottom` can be, given the cash on hand and its own limit. */
export function affordableLength(world: World, type: LiftType): number {
  const spec = CONFIG.lifts[type];
  return Math.max(0, Math.min(spec.maxLength, (world.company.money - spec.baseCost) / spec.costPerMetre));
}

export function runProblemsHere(world: World, points: readonly Vec2[]): string[] {
  const resort = activeResort(world);
  const land = landProblem(resort, points);
  return [...(land ? [land] : []), ...runProblems(resort.terrain, points)];
}

export function buildingProblemsHere(world: World, type: BuildingType, p: Vec2): string[] {
  const resort = activeResort(world);
  const spec = CONFIG.buildings[type];
  const problems = buildingProblems(resort, type, p);
  if (world.company.stars < spec.stars) problems.unshift(`The ${spec.label.toLowerCase()} unlocks at ${spec.stars}★.`);
  const land = landProblem(resort, [p]);
  if (land) problems.push(land);
  if (spec.cost > world.company.money) problems.push(`Costs $${spec.cost.toLocaleString('en-US')}, but you only have $${Math.floor(world.company.money).toLocaleString('en-US')}.`);
  return problems;
}

/** Why a lift can't be upgraded right now, or null if it can. */
/** Why the next level of a lift part can't be bought now, or null if it can. */
export function partProblem(world: World, lift: Lift, part: LiftPart): string | null {
  const spec = CONFIG.liftParts[part];
  if (!partsFor(lift.type).includes(part)) return `A ${CONFIG.lifts[lift.type].label.toLowerCase()} has no ${spec.label.toLowerCase()} upgrades.`;
  const next = nextPartLevel(lift, part);
  if (!next) return `${spec.label} is fully upgraded.`;
  if (world.company.stars < next.stars) return `${next.name} unlocks at ${next.stars}★. The next review is at the end of day ${nextReviewDay(world)}.`;
  const cost = partCost(lift, part)!;
  return cost > world.company.money ? `${next.name} costs $${cost.toLocaleString('en-US')}.` : null;
}

/** The day the magazine next reviews the resort, at the end of that day. */
export const nextReviewDay = (world: World): number => Math.ceil(world.calendar.day / CONFIG.review.everyDays) * CONFIG.review.everyDays;

export function upgradeProblem(world: World, lift: Lift): string | null {
  const next = nextTier(lift);
  if (!next) return 'This lift is already the best of its kind.';
  if (world.company.stars < next.stars) {
    return `The ${next.name.toLowerCase()} unlocks at ${next.stars}★. You have ${world.company.stars}★; the next review is at the end of day ${nextReviewDay(world)}.`;
  }
  const cost = upgradeCost(lift)!;
  return cost > world.company.money ? `The upgrade costs $${cost.toLocaleString('en-US')}.` : null;
}

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** Why the building can't add the next level of this part right now, or null if it can. */
export function buildingPartProblem(world: World, building: Building, part: BuildingPart): string | null {
  const next = nextBuildingPart(building, part);
  if (!next) return 'That’s already fully built.';
  if (world.company.stars < next.stars) return `${next.name} needs a ${next.stars}★ rating. The next review is on day ${nextReviewDay(world)}.`;
  if (world.company.money < next.cost) return `${next.name} costs $${next.cost.toLocaleString('en-US')}.`;
  return null;
}

/** Why the run can't be widened right now, or null if it can. */
export function wideningProblem(world: World, run: Run): string | null {
  const next = nextWidening(run);
  if (!next) return 'This run is as wide as it gets.';
  if (world.company.stars < next.stars) return `${next.name} needs a ${next.stars}★ rating. The next review is on day ${nextReviewDay(world)}.`;
  const cost = wideningCost(run)!;
  if (world.company.money < cost) return `${next.name} costs $${cost.toLocaleString('en-US')}.`;
  return null;
}

export function applyCommand(world: World, cmd: Command): CommandResult {
  const resort = activeResort(world);
  const { company } = world;
  switch (cmd.type) {
    case 'buildLift': {
      const plan = planLiftHere(world, cmd.liftType, cmd.bottom, cmd.top);
      if (plan.problems.length > 0) return fail(plan.problems[0]!);
      build(company, plan.cost);
      const name = uniqueName(world.rng, resort.lifts.map((l) => l.name), LIFT_WORDS, [LIFT_SUFFIX[cmd.liftType]]);
      resort.lifts.push({ id: world.nextId++, name, type: cmd.liftType, bottom: cmd.bottom, top: cmd.top, length: plan.length, rise: plan.rise, queue: [], boardCredit: 0, tier: 0, invested: plan.cost });
      return { ok: true };
    }
    case 'removeLift': {
      const lift = resort.lifts.find((l) => l.id === cmd.id);
      if (!lift) return fail('That lift is already gone.');
      resort.lifts = resort.lifts.filter((l) => l !== lift);
      refund(company, lift.invested);
      return { ok: true };
    }
    case 'upgradeLiftPart': {
      const lift = resort.lifts.find((l) => l.id === cmd.id);
      if (!lift) return fail('That lift is gone.');
      const problem = partProblem(world, lift, cmd.part);
      if (problem) return fail(problem);
      const cost = partCost(lift, cmd.part)!;
      build(company, cost);
      lift.parts = { ...lift.parts, [cmd.part]: partLevel(lift, cmd.part) + 1 };
      lift.invested += cost;
      return { ok: true };
    }
    case 'upgradeLift': {
      const lift = resort.lifts.find((l) => l.id === cmd.id);
      if (!lift) return fail('That lift is gone.');
      const problem = upgradeProblem(world, lift);
      if (problem) return fail(problem);
      const cost = upgradeCost(lift)!;
      build(company, cost);
      lift.tier++;
      lift.invested += cost;
      return { ok: true };
    }
    case 'buildRun': {
      const problems = runProblemsHere(world, cmd.points);
      if (problems.length > 0) return fail(problems[0]!);
      const name = uniqueName(world.rng, resort.runs.map((r) => r.name), RUN_FIRST, RUN_SECOND);
      resort.runs.push({ id: world.nextId++, name, points: cmd.points, profile: profileRun(resort.terrain, cmd.points), features: [] });
      return { ok: true };
    }
    case 'removeRun': {
      const run = resort.runs.find((r) => r.id === cmd.id);
      if (!run) return fail('That run is already gone.');
      resort.runs = resort.runs.filter((r) => r !== run);
      if (run.features.length > 0) refund(company, featureInvestment(run));
      return { ok: true };
    }
    case 'addFeature': {
      const run = resort.runs.find((r) => r.id === cmd.runId);
      if (!run) return fail('That run is gone.');
      const problem = featureProblem(run, cmd.featureType, cmd.at);
      if (problem) return fail(problem);
      const { cost, label } = CONFIG.features[cmd.featureType];
      if (!build(company, cost)) return fail(`${label} costs $${cost.toLocaleString('en-US')}.`);
      run.features = [...run.features, { type: cmd.featureType, at: cmd.at }].sort((a, b) => a.at - b.at);
      return { ok: true };
    }
    case 'clearFeatures': {
      const run = resort.runs.find((r) => r.id === cmd.runId);
      if (!run) return fail('That run is gone.');
      if (run.features.length === 0) return fail('This run has no features.');
      refund(company, featureInvestment(run));
      run.features = [];
      return { ok: true };
    }
    case 'buildBuilding': {
      const problems = buildingProblemsHere(world, cmd.buildingType, cmd.pos);
      if (problems.length > 0) return fail(problems[0]!);
      const spec = CONFIG.buildings[cmd.buildingType];
      build(company, spec.cost);
      const name = uniqueName(world.rng, resort.buildings.map((b) => b.name), BUILDING_WORDS, [BUILDING_SUFFIX[cmd.buildingType]]);
      resort.buildings.push({ id: world.nextId++, name, type: cmd.buildingType, pos: cmd.pos, upgrades: 0 });
      return { ok: true };
    }
    case 'removeBuilding': {
      const building = resort.buildings.find((b) => b.id === cmd.id);
      if (!building) return fail('That building is already gone.');
      resort.buildings = resort.buildings.filter((b) => b !== building);
      refund(company, buildingInvested(building));
      return { ok: true };
    }
    case 'upgradeLodge': {
      const building = resort.buildings.find((b) => b.id === cmd.id);
      if (!building) return fail('That building is gone.');
      const next = nextLodgeUpgrade(building);
      if (!next) return fail(building.type === 'lodge' ? 'This lodge is fully built out.' : 'Only base lodges can be extended.');
      if (!build(company, next.cost)) return fail(`The ${next.name.toLowerCase()} costs $${next.cost.toLocaleString('en-US')}.`);
      building.upgrades++;
      return { ok: true };
    }
    case 'upgradeBuildingPart': {
      const building = resort.buildings.find((b) => b.id === cmd.id);
      if (!building) return fail('That building is gone.');
      const problem = buildingPartProblem(world, building, cmd.part);
      if (problem) return fail(problem);
      build(company, nextBuildingPart(building, cmd.part)!.cost);
      building.parts = { ...building.parts, [cmd.part]: (building.parts?.[cmd.part] ?? 0) + 1 };
      return { ok: true };
    }
    case 'setGrooming': {
      const run = resort.runs.find((r) => r.id === cmd.runId);
      if (!run) return fail('That run is gone.');
      run.grooming = cmd.grooming;
      return { ok: true };
    }
    case 'widenRun': {
      const run = resort.runs.find((r) => r.id === cmd.runId);
      if (!run) return fail('That run is gone.');
      const problem = wideningProblem(world, run);
      if (problem) return fail(problem);
      build(company, wideningCost(run)!);
      run.widened = (run.widened ?? 0) + 1;
      return { ok: true };
    }
    case 'setApresPrice': {
      resort.apresPrice = cmd.price;
      return { ok: true };
    }
    case 'setTicketPrice': {
      const [min, max] = CONFIG.economy.ticketPriceRange;
      resort.ticketPrice = clamp(Math.round(cmd.price), min, max);
      return { ok: true };
    }
    case 'buyLand': {
      const next = CONFIG.land[resort.land];
      if (!next) return fail('You already own the whole mountain.');
      if (company.stars < next.stars) {
        return fail(`${next.name} goes on sale once you’re rated ${next.stars}★. You have ${company.stars}★; the next review is at the end of day ${nextReviewDay(world)}.`);
      }
      if (!build(company, next.cost)) return fail(`${next.name} costs $${next.cost.toLocaleString('en-US')}.`);
      resort.land++;
      return { ok: true };
    }
  }
}

/** Where a run drawn from p would join the network: a lift top or a point on another run. */
export function runStartAt(world: World, p: Vec2): Vec2 | null {
  const resort = activeResort(world);
  const lift = resort.lifts.find((l) => dist(l.top, p) <= CONFIG.network.connectRadius * 1.5);
  if (lift) return lift.top;
  const run = runAt(resort, p);
  return run && pointAlong(run.run.points, run.at);
}

/** Where a run ending near p would finish: a lift bottom, the base, or a point on another run. */
export function runEndAt(world: World, p: Vec2): Vec2 | null {
  const resort = activeResort(world);
  const lift = resort.lifts.find((l) => dist(l.bottom, p) <= CONFIG.network.connectRadius * 1.5);
  if (lift) return lift.bottom;
  if (isBase(resort, p)) return p;
  const run = runAt(resort, p);
  return run && pointAlong(run.run.points, run.at);
}
