import { CONFIG, type LiftType } from '../config';
import { build, createCompany, emptyLedger, refund, sellTicket, type Company, type Ledger } from './economy';
import { vec, type Vec2 } from './geometry';
import { boardLift, liftCost, planLift, queueSpot, type Lift } from './lifts';
import { liftsFrom, type Mountain } from './network';
import { createRng, nextFloat, type Rng } from './rng';
import { profileRun, runProblems, type Run } from './runs';
import { boardSkier, createSkier, updateSkier, type Skier, type SkierContext } from './skiers';
import { generateTerrain, terrainExtent, type Terrain } from './terrain';

export interface Calendar {
  day: number;
  /** Seconds since midnight. */
  time: number;
}

export interface DayStats {
  arrivals: number;
  leftHappy: number;
  leftUnhappy: number;
}

export interface Resort extends Mountain {
  readonly name: string;
  readonly terrain: Terrain;
  /** Where skiers arrive and where they walk to when they go home. */
  readonly entrance: Vec2;
  lifts: Lift[];
  runs: Run[];
  skiers: Skier[];
  /** Fractional skiers owed by the arrival rate. */
  arrivalCredit: number;
  today: DayStats;
}

export interface World {
  readonly seed: number;
  readonly rng: Rng;
  nextId: number;
  readonly company: Company;
  readonly calendar: Calendar;
  readonly resorts: Resort[];
}

export type Command =
  | { readonly type: 'buildLift'; readonly liftType: LiftType; readonly bottom: Vec2; readonly top: Vec2 }
  | { readonly type: 'removeLift'; readonly id: number }
  | { readonly type: 'buildRun'; readonly points: readonly Vec2[] }
  | { readonly type: 'removeRun'; readonly id: number };

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type WorldEvent = { readonly type: 'dayEnded'; readonly day: number; readonly stats: DayStats; readonly ledger: Ledger };

const emptyStats = (): DayStats => ({ arrivals: 0, leftHappy: 0, leftUnhappy: 0 });

export function createWorld(seed: number): World {
  const terrain = generateTerrain(seed);
  const extent = terrainExtent(terrain);
  return {
    seed,
    rng: createRng(seed ^ 0x5eed),
    nextId: 1,
    company: createCompany('Summit Resorts'),
    calendar: { day: 1, time: CONFIG.calendar.openHour * 3600 },
    resorts: [{ name: 'Summit Peak', terrain, entrance: vec(extent / 2, extent - 15), lifts: [], runs: [], skiers: [], arrivalCredit: 0, today: emptyStats() }],
  };
}

/** Milestone 1 has one resort; the company and calendar are already shaped for more. */
export const activeResort = (world: World): Resort => world.resorts[0]!;

export const isClosed = (world: World): boolean => world.calendar.time >= CONFIG.calendar.closeHour * 3600;

/** Advances the world by one fixed step of dt game seconds. */
export function tick(world: World, dt: number = CONFIG.loop.gameSecondsPerTick): WorldEvent[] {
  world.calendar.time += dt;
  const closed = isClosed(world);
  for (const resort of world.resorts) stepResort(world, resort, dt, closed);
  const swept = world.calendar.time >= CONFIG.calendar.closeHour * 3600 + CONFIG.calendar.sweepAfterClose;
  return closed && (swept || world.resorts.every((r) => r.skiers.length === 0)) ? [endDay(world)] : [];
}

function stepResort(world: World, resort: Resort, dt: number, closed: boolean): void {
  if (world.calendar.time < CONFIG.calendar.lastArrivalHour * 3600) admitArrivals(world, resort, dt);
  const byId = new Map(resort.skiers.map((s) => [s.id, s]));
  for (const lift of resort.lifts) {
    if (closed) lift.queue.length = 0;
    for (const id of boardLift(lift, dt)) {
      const skier = byId.get(id);
      if (skier) boardSkier(skier, lift);
    }
  }
  const crowd = new Map<number, number>();
  for (const s of resort.skiers) if (s.state.kind === 'skiing') crowd.set(s.state.runId, (crowd.get(s.state.runId) ?? 0) + 1);
  const ctx: SkierContext = { mountain: resort, rng: world.rng, closed, exit: resort.entrance, crowd };
  resort.skiers = resort.skiers.filter((s) => {
    if (updateSkier(ctx, s, dt)) return true;
    if (s.state.kind === 'leaving' && s.state.happy) resort.today.leftHappy++;
    else resort.today.leftUnhappy++;
    return false;
  });
  for (const lift of resort.lifts) lift.queue.forEach((id, i) => {
    const skier = byId.get(id);
    if (skier) skier.pos = queueSpot(lift, i);
  });
}

/** Nobody buys a ticket to a resort with no lift from the base; demand grows with the number of runs. */
function admitArrivals(world: World, resort: Resort, dt: number): void {
  if (liftsFrom(resort, resort.entrance).length === 0) return;
  const { arrivalsPerHour, runsForFullDemand, maxOnMountain } = CONFIG.skiers;
  const demand = 0.3 + 0.7 * Math.min(1, resort.runs.length / runsForFullDemand);
  resort.arrivalCredit += (arrivalsPerHour * demand * dt) / 3600;
  for (; resort.arrivalCredit >= 1; resort.arrivalCredit--) {
    if (resort.skiers.length >= maxOnMountain) continue;
    const spot = vec(resort.entrance.x + (nextFloat(world.rng) - 0.5) * 60, resort.entrance.y);
    const skier = createSkier(world.nextId++, spot, world.rng);
    if (!sellTicket(world.company, skier)) continue;
    resort.skiers.push(skier);
    resort.today.arrivals++;
  }
}

function endDay(world: World): WorldEvent {
  const stats = emptyStats();
  for (const r of world.resorts) {
    stats.arrivals += r.today.arrivals;
    stats.leftHappy += r.today.leftHappy + r.skiers.length;
    stats.leftUnhappy += r.today.leftUnhappy;
    r.skiers = [];
    r.arrivalCredit = 0;
    r.today = emptyStats();
  }
  const event: WorldEvent = { type: 'dayEnded', day: world.calendar.day, stats, ledger: world.company.today };
  world.company.today = emptyLedger();
  world.calendar.day++;
  world.calendar.time = CONFIG.calendar.openHour * 3600;
  return event;
}

const LIFT_WORDS = ['Summit', 'Eagle', 'Ridge', 'Powder', 'Aspen', 'Bear', 'Glacier', 'Sunrise', 'Timber', 'Falcon', 'Cougar', 'Raven', 'Comet', 'Lynx', 'Bluebird'];
const LIFT_SUFFIX: Record<LiftType, string> = { ropeTow: 'Tow', chairlift: 'Express', gondola: 'Gondola' };
const RUN_FIRST = ['Lone', 'Big', 'Hidden', 'Upper', 'Lower', 'Crystal', 'Silver', 'Wild', 'Lazy', 'Thunder', 'Misty', 'Rusty', 'Golden', 'Quiet', 'Broken'];
const RUN_SECOND = ['Pine', 'Bowl', 'Chute', 'Trail', 'Ridge', 'Glade', 'Way', 'Gulch', 'Canyon', 'Meadow', 'Spur', 'Hollow'];

function uniqueName(rng: Rng, taken: readonly string[], ...parts: readonly (readonly string[])[]): string {
  const roll = (): string => parts.map((words) => words[Math.floor(nextFloat(rng) * words.length)]).join(' ');
  for (let i = 0; i < 20; i++) {
    const name = roll();
    if (!taken.includes(name)) return name;
  }
  return `${roll()} ${taken.length + 1}`;
}

const fail = (reason: string): CommandResult => ({ ok: false, reason });

export function applyCommand(world: World, cmd: Command): CommandResult {
  const resort = activeResort(world);
  const { company } = world;
  switch (cmd.type) {
    case 'buildLift': {
      const plan = planLift(resort.terrain, resort.lifts, company.money, cmd.liftType, cmd.bottom, cmd.top);
      if (plan.problems.length > 0) return fail(plan.problems[0]!);
      build(company, plan.cost);
      const name = uniqueName(world.rng, resort.lifts.map((l) => l.name), LIFT_WORDS, [LIFT_SUFFIX[cmd.liftType]]);
      resort.lifts.push({ id: world.nextId++, name, type: cmd.liftType, bottom: cmd.bottom, top: cmd.top, length: plan.length, rise: plan.rise, queue: [], boardCredit: 0 });
      return { ok: true };
    }
    case 'removeLift': {
      const lift = resort.lifts.find((l) => l.id === cmd.id);
      if (!lift) return fail('That lift is already gone.');
      resort.lifts = resort.lifts.filter((l) => l !== lift);
      refund(company, liftCost(lift.type, lift.length));
      return { ok: true };
    }
    case 'buildRun': {
      const problems = runProblems(resort.terrain, cmd.points);
      if (problems.length > 0) return fail(problems[0]!);
      const name = uniqueName(world.rng, resort.runs.map((r) => r.name), RUN_FIRST, RUN_SECOND);
      resort.runs.push({ id: world.nextId++, name, points: cmd.points, profile: profileRun(resort.terrain, cmd.points) });
      return { ok: true };
    }
    case 'removeRun': {
      const before = resort.runs.length;
      resort.runs = resort.runs.filter((r) => r.id !== cmd.id);
      return resort.runs.length < before ? { ok: true } : fail('That run is already gone.');
    }
  }
}
