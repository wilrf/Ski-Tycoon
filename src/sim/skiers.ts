import { CONFIG, type ApresTier, type Level } from '../config';
import { buildingsNear, seatsOf, type Building } from './buildings';
import { clamp, dist, lerp, pointAlong, type Vec2 } from './geometry';
import { liftTier, rideSeconds, waitSeconds, type Lift } from './lifts';
import { branchesOf, leadsSomewhere, liftsFrom, mergeOf, runsFromLift, type Mountain } from './network';
import { nextFloat, nextRange, pickWeighted, type Rng } from './rng';
import { favouriteFeature, featureFun, funFor, rateRun, type Run } from './runs';

export type SkillLevel = Level;

export type Thought =
  | { readonly kind: 'arrived' }
  | { readonly kind: 'back'; readonly visits: number }
  | { readonly kind: 'movedUp'; readonly skill: SkillLevel }
  | { readonly kind: 'longLine'; readonly lift: string }
  | { readonly kind: 'riding'; readonly lift: string }
  | { readonly kind: 'enjoying'; readonly run: string }
  | { readonly kind: 'tooSteep'; readonly run: string }
  | { readonly kind: 'lovedRun'; readonly run: string }
  | { readonly kind: 'lovedFeature'; readonly run: string; readonly feature: string }
  | { readonly kind: 'okRun'; readonly run: string }
  | { readonly kind: 'boredRun'; readonly run: string }
  | { readonly kind: 'survivedRun'; readonly run: string }
  | { readonly kind: 'noRunForMe'; readonly lift: string }
  | { readonly kind: 'eating'; readonly place: string }
  | { readonly kind: 'apres'; readonly place: string }
  | { readonly kind: 'nothingToSki' }
  | { readonly kind: 'tired' }
  | { readonly kind: 'fedUp' }
  | { readonly kind: 'closing' };

/** Why a skier's happiness changed. Each kind has an emoji and a line of text in the UI. */
export type FeelingKind =
  | 'greatRun' | 'goodRun' | 'boredRun' | 'crowdedRun' | 'scared' | 'longLine' | 'nothingForMe' | 'noLift'
  | 'overpriced' | 'bargain' | 'tiringTow' | 'comfyRide' | 'goodMeal' | 'lodgeFull' | 'windHold' | 'movedUp' | 'greatApres';

export interface Feeling {
  readonly kind: FeelingKind;
  /** The lift, run or building it happened at, or '' for the resort as a whole. */
  readonly place: string;
  /** Total happiness change, merged across repeats in a row (a long line keeps adding to one entry). */
  delta: number;
}

/** A line a skier could be quoted on in the magazine review. */
export interface Quote {
  readonly name: string;
  readonly skill: SkillLevel;
  readonly kind: FeelingKind;
  readonly place: string;
}

/** Today's feelings across the whole resort: how many skiers felt each, and the total happiness change. */
export interface TallyEntry {
  count: number;
  delta: number;
  /** How often it happened at each lift, run or building, so the day report can point at the worst one. */
  places?: Record<string, number>;
}
export type FeelingTally = Partial<Record<FeelingKind, TallyEntry>>;

/** Where feelings are recorded beyond the skier: the day's tally, and the latest quote of each kind. */
export interface Journal {
  readonly tally: FeelingTally;
  readonly quotes: Partial<Record<FeelingKind, Quote>>;
}

export type SkierState =
  | { readonly kind: 'walking'; readonly liftId: number }
  | { readonly kind: 'queued'; readonly liftId: number; waited: number }
  | { readonly kind: 'riding'; readonly liftId: number; readonly down: boolean; progress: number }
  | { readonly kind: 'skiing'; readonly runId: number; readonly scared: boolean; distance: number }
  | { readonly kind: 'toBuilding'; readonly buildingId: number }
  | { readonly kind: 'eating'; readonly buildingId: number; left: number }
  /** After close: heading down to a lodge for après, then sitting in its bar. */
  | { readonly kind: 'toBar'; readonly buildingId: number }
  | { readonly kind: 'apres'; readonly buildingId: number; left: number }
  | { readonly kind: 'leaving'; readonly happy: boolean };

export interface Skier {
  readonly id: number;
  /** The returning guest this skier is today; their name, skill and loyalty live on the guest. */
  readonly guestId: number;
  readonly name: string;
  readonly skill: SkillLevel;
  cash: number;
  /** 0 to 100. */
  energy: number;
  /** 0 to 100. */
  happiness: number;
  pos: Vec2;
  state: SkierState;
  thought: Thought;
  /** Lifts this skier found nothing to ski from; cleared after their next run. */
  avoid: number[];
  /** The latest reasons their happiness changed, oldest first. */
  log: Feeling[];
  /** The latest new feeling and when (seconds since midnight) it happened, so the map can pop an emoji. */
  felt: { readonly kind: FeelingKind; readonly at: number } | null;
  /** Runs today at their own level that they enjoyed, and runs above it they survived: how they get better. */
  practice: number;
  stretches: number;
  ate: boolean;
  /** Loyalty this skier's après adds when they go home; 0 if they skipped it. */
  apresLoyalty: number;
}

export interface SkierContext {
  readonly mountain: Mountain;
  readonly buildings: readonly Building[];
  /** Skiers inside or walking to each building, by building id. */
  readonly occupancy: Map<number, number>;
  readonly rng: Rng;
  /** Lifts have stopped loading for the day. */
  readonly closed: boolean;
  /** Lifts stopped by the wind. */
  readonly held: ReadonlySet<number>;
  readonly exit: Vec2;
  /** Skiers currently on each run, by run id. */
  readonly crowd: ReadonlyMap<number, number>;
  /** Today's weather multiplier on fun, by run difficulty. */
  readonly weatherFun: readonly number[];
  /** Seconds since midnight. */
  readonly time: number;
  readonly journal: Journal;
  /** Tonight's après prices. */
  readonly apresPrice: ApresTier;
  /** Called when a skier pays for a meal or for après drinks. */
  readonly spend: (amount: number, what: 'meal' | 'apres') => void;
  /** Called when a skier wanted après but every lodge was full. */
  readonly turnedAway: () => void;
}

export interface NewSkier {
  readonly id: number;
  readonly guestId: number;
  readonly name: string;
  readonly skill: SkillLevel;
  readonly cash: number;
  readonly happiness: number;
  readonly pos: Vec2;
}

export const createSkier = (n: NewSkier): Skier => ({
  ...n,
  energy: 100,
  // No lift yet: the first update finds none and has the skier decide where to go.
  state: { kind: 'walking', liftId: -1 },
  thought: { kind: 'arrived' },
  avoid: [],
  log: [],
  felt: null,
  practice: 0,
  stretches: 0,
  ate: false,
  apresLoyalty: 0,
});

/**
 * Changes happiness and records why: on the skier, in the day's tally and as a possible quote.
 * A repeat of the latest feeling at the same place (another minute in the same line) adds to it
 * instead of counting again.
 */
export function feel(journal: Journal, time: number, s: Skier, kind: FeelingKind, delta: number, place: string): void {
  s.happiness = clamp(s.happiness + delta, 0, 100);
  const last = s.log[s.log.length - 1];
  const total = (journal.tally[kind] ??= { count: 0, delta: 0 });
  total.delta += delta;
  if (last && last.kind === kind && last.place === place) return void (last.delta += delta);
  total.count++;
  if (place) (total.places ??= {})[place] = (total.places[place] ?? 0) + 1;
  s.log.push({ kind, place, delta });
  if (s.log.length > CONFIG.skiers.logLength) s.log.shift();
  s.felt = { kind, at: time };
  journal.quotes[kind] = { name: s.name, skill: s.skill, kind, place };
}

/** How the ticket price feels to a skier who just paid it. */
export function feelPrice(journal: Journal, s: Skier, price: number, time: number): void {
  const { fairTicketPrice, overpricedHappinessPerDollar, bargainHappinessPerDollar } = CONFIG.economy;
  const over = price - fairTicketPrice;
  if (over > 0) feel(journal, time, s, 'overpriced', -over * overpricedHappinessPerDollar, '');
  else if (over < 0) feel(journal, time, s, 'bargain', -over * bargainHappinessPerDollar, '');
}

/**
 * Picks a run at or below the skier's skill, favouring runs that match it exactly and runs with curves and
 * features they like, up to twice as often. With nothing comfortable, a brave skier may try one level up and
 * be scared; otherwise null.
 */
export function chooseRun(runs: readonly Run[], skill: SkillLevel, rng: Rng): { run: Run; scared: boolean } | null {
  const pull = (r: Run): number => 1 + featureFun(r, skill) / CONFIG.featureRules.maxFun;
  const comfortable = pickWeighted(rng, runs, (r) => (r.profile.difficulty === skill ? 3 : r.profile.difficulty < skill ? 1 : 0) * pull(r));
  if (comfortable) return { run: comfortable, scared: false };
  const stretch = pickWeighted(rng, runs, (r) => (r.profile.difficulty === skill + 1 ? 1 : 0));
  return stretch && nextFloat(rng) < CONFIG.skiers.braveChance ? { run: stretch, scared: true } : null;
}

/** Picks a reachable running lift, preferring ones with runs the skier can handle and short lines. */
function chooseLift(ctx: SkierContext, skier: Skier): Lift | undefined {
  const m = ctx.mountain;
  const suits = (lift: Lift): boolean => runsFromLift(m, lift).some((r) => r.profile.difficulty <= skier.skill && leadsSomewhere(m, r));
  const options = liftsFrom(m, skier.pos).filter((l) => !skier.avoid.includes(l.id) && !ctx.held.has(l.id));
  // Skiers read the trail map, so a lift with nothing at their level is a last resort; nobody likes a long line.
  return pickWeighted(ctx.rng, options, (l) => (suits(l) ? 1 : 0.05) / (1 + waitSeconds(l) / CONFIG.skiers.queueTolerance));
}

/** Moves toward target and reports whether the skier got there. */
function moveToward(s: Skier, target: Vec2, step: number): boolean {
  const d = dist(s.pos, target);
  s.pos = d <= step ? target : lerp(s.pos, target, step / d);
  return d <= step;
}

const isHungry = (ctx: SkierContext, s: Skier): boolean =>
  !s.ate && (s.energy < CONFIG.meals.hungryEnergy || ctx.time >= CONFIG.meals.lunchHour * 3600);

/** Sends a hungry skier to a nearby building with a free seat. Returns whether they went. */
function goEat(ctx: SkierContext, s: Skier): boolean {
  if (ctx.closed || !isHungry(ctx, s)) return false;
  const near = buildingsNear(ctx.mountain, ctx.buildings, s.pos);
  if (near.length === 0) return false;
  const open = near.find((b) => (ctx.occupancy.get(b.id) ?? 0) < seatsOf(b));
  if (!open) {
    feel(ctx.journal, ctx.time, s, 'lodgeFull', -CONFIG.meals.fullPenalty, near[0]!.name);
    return false;
  }
  ctx.occupancy.set(open.id, (ctx.occupancy.get(open.id) ?? 0) + 1);
  s.state = { kind: 'toBuilding', buildingId: open.id };
  s.thought = { kind: 'eating', place: open.name };
  return true;
}

/**
 * At closing, or from 3 PM once they're too tired to ski on, a skier who had a decent day may head to a base
 * lodge for après. Happier skiers are likelier to stay, grumpier ones less, and the price tier scales it. Returns whether they went.
 */
function goApres(ctx: SkierContext, s: Skier): boolean {
  const { apres } = CONFIG;
  if (ctx.time < apres.openHour * 3600 || ctx.time >= apres.lastCallHour * 3600 || s.cash < ctx.apresPrice.drinkPrice) return false;
  const lodges = ctx.buildings.filter((b) => b.type === 'lodge');
  if (lodges.length === 0) return false;
  const chance = apres.stayShare * ctx.apresPrice.stay * clamp(s.happiness / apres.typicalHappiness, 0.5, 1.3);
  if (nextFloat(ctx.rng) >= chance) return false;
  const open = lodges.find((b) => (ctx.occupancy.get(b.id) ?? 0) < seatsOf(b));
  if (!open) {
    feel(ctx.journal, ctx.time, s, 'lodgeFull', -CONFIG.meals.fullPenalty, lodges[0]!.name);
    ctx.turnedAway();
    return false;
  }
  ctx.occupancy.set(open.id, (ctx.occupancy.get(open.id) ?? 0) + 1);
  s.state = { kind: 'toBar', buildingId: open.id };
  s.thought = { kind: 'apres', place: open.name };
  return true;
}

/** Sits an après guest down: they buy their round up front and stay until they're done or the bar shuts. */
function sitAtBar(ctx: SkierContext, s: Skier, building: Building): void {
  const { apres } = CONFIG;
  const price = ctx.apresPrice.drinkPrice;
  const drinks = Math.min(Math.floor(s.cash / price), Math.round(nextRange(ctx.rng, apres.drinks)));
  s.cash -= drinks * price;
  ctx.spend(drinks * price, 'apres');
  const left = Math.min(nextRange(ctx.rng, apres.staySeconds), apres.closeHour * 3600 - ctx.time);
  s.state = { kind: 'apres', buildingId: building.id, left };
}

/** What a skier does at a junction: go home, eat, or head for a lift. */
export function decide(ctx: SkierContext, s: Skier): void {
  const leave = (happy: boolean, thought: Thought): void => {
    s.state = { kind: 'leaving', happy };
    s.thought = thought;
  };
  if (ctx.closed) {
    const happy = s.happiness >= CONFIG.skiers.fedUpHappiness;
    if (happy && goApres(ctx, s)) return;
    return leave(happy, { kind: 'closing' });
  }
  if (s.happiness < CONFIG.skiers.fedUpHappiness) return leave(false, { kind: 'fedUp' });
  if (goEat(ctx, s)) return;
  if (s.energy < CONFIG.skiers.tiredEnergy) {
    if (!goApres(ctx, s)) leave(true, { kind: 'tired' });
    return;
  }
  const lift = chooseLift(ctx, s);
  if (!lift) {
    const held = liftsFrom(ctx.mountain, s.pos).find((l) => ctx.held.has(l.id));
    if (held) feel(ctx.journal, ctx.time, s, 'windHold', -8, held.name);
    else feel(ctx.journal, ctx.time, s, 'noLift', -5, '');
    return leave(false, { kind: 'nothingToSki' });
  }
  s.state = { kind: 'walking', liftId: lift.id };
}

export function boardSkier(s: Skier, lift: Lift): void {
  s.state = { kind: 'riding', liftId: lift.id, down: false, progress: 0 };
  s.thought = { kind: 'riding', lift: lift.name };
}

function startRun(ctx: SkierContext, s: Skier, run: Run, scared: boolean, distance = 0): void {
  s.pos = pointAlong(run.points, distance);
  s.state = { kind: 'skiing', runId: run.id, scared, distance };
  s.thought = scared ? { kind: 'tooSteep', run: run.name } : { kind: 'enjoying', run: run.name };
  if (scared) feel(ctx.journal, ctx.time, s, 'scared', -CONFIG.skiers.scaredPenalty, run.name);
}

function arriveAtTop(ctx: SkierContext, s: Skier, lift: Lift): void {
  if (liftTier(lift).covered) feel(ctx.journal, ctx.time, s, 'comfyRide', 2, lift.name);
  if (goEat(ctx, s)) return;
  pickRunFromTop(ctx, s, lift);
}

function pickRunFromTop(ctx: SkierContext, s: Skier, lift: Lift): void {
  const runs = runsFromLift(ctx.mountain, lift).filter((r) => leadsSomewhere(ctx.mountain, r));
  const choice = chooseRun(runs, s.skill, ctx.rng);
  if (choice) return startRun(ctx, s, choice.run, choice.scared);
  s.state = { kind: 'riding', liftId: lift.id, down: true, progress: 0 };
  s.thought = { kind: 'noRunForMe', lift: lift.name };
  s.avoid.push(lift.id);
  feel(ctx.journal, ctx.time, s, 'nothingForMe', -CONFIG.skiers.rideDownPenalty, lift.name);
}

function finishRun(ctx: SkierContext, s: Skier, run: Run, scared: boolean): void {
  const m = ctx.mountain;
  const onRun = ctx.crowd.get(run.id) ?? 0;
  const fun = funFor(run, s.skill, onRun, ctx.weatherFun);
  s.energy = Math.max(0, s.energy - run.profile.vertical * CONFIG.skiers.energyPerVerticalMetre);
  s.avoid = [];
  if (scared) {
    s.stretches++;
    s.thought = { kind: 'survivedRun', run: run.name };
  } else {
    const crowded = rateRun(run, onRun).crowding >= CONFIG.skiers.crowdedRunRating;
    // Two levels down is dull for anyone; one level down only when the run is short and flat too.
    const bored = run.profile.difficulty <= s.skill - 2 || (run.profile.difficulty < s.skill && fun < 1.5);
    const kind = crowded ? 'crowdedRun' : bored ? 'boredRun' : fun >= 6 ? 'greatRun' : 'goodRun';
    // A bored expert is a little worse off than if they'd skied nothing, and a packed run spoils the fun.
    const joy = bored ? -2 : (CONFIG.skiers.bestRunJoy * fun) / 10 - (crowded ? 3 : 0);
    feel(ctx.journal, ctx.time, s, kind, joy, run.name);
    if (run.profile.difficulty === s.skill && !crowded) s.practice++;
    const favourite = kind === 'greatRun' ? favouriteFeature(run, s.skill) : null;
    s.thought = favourite ? { kind: 'lovedFeature', run: run.name, feature: favourite === 'curves' ? 'the curves' : CONFIG.features[favourite].noun }
      : kind === 'greatRun' ? { kind: 'lovedRun', run: run.name } : kind === 'boredRun' ? { kind: 'boredRun', run: run.name } : { kind: 'okRun', run: run.name };
  }
  // A run that ends on another run carries on down it; there's no choice about that.
  const merge = mergeOf(m, run);
  if (merge) return startRun(ctx, s, merge.run, merge.run.profile.difficulty > s.skill, merge.at);
  decide(ctx, s);
}

/** At each branch the skier passes, they may turn off onto it, choosing as they would at a lift top. */
function takeBranch(ctx: SkierContext, s: Skier, run: Run, from: number, to: number): boolean {
  for (const branch of branchesOf(ctx.mountain, run)) {
    if (branch.at <= from || branch.at > to || !leadsSomewhere(ctx.mountain, branch.run)) continue;
    const choice = chooseRun([run, branch.run], s.skill, ctx.rng);
    if (choice?.run === branch.run) {
      startRun(ctx, s, branch.run, choice.scared);
      return true;
    }
  }
  return false;
}

/** Advances one skier by dt seconds. Returns false once the skier has left the resort. */
export function updateSkier(ctx: SkierContext, s: Skier, dt: number): boolean {
  const cfg = CONFIG.skiers;
  s.energy = Math.max(0, s.energy - (cfg.energyPerHour * dt) / 3600);
  const state = s.state;
  if (state.kind === 'leaving') return !moveToward(s, ctx.exit, cfg.leaveSpeed * dt);
  if (state.kind === 'skiing') {
    const run = ctx.mountain.runs.find((r) => r.id === state.runId);
    if (!run) decide(ctx, s);
    else {
      const from = state.distance;
      state.distance += cfg.skiSpeed[s.skill] * (state.scared ? cfg.scaredSpeedFactor : 1) * dt;
      s.pos = pointAlong(run.points, state.distance);
      if (!takeBranch(ctx, s, run, from, state.distance) && state.distance >= run.profile.length) finishRun(ctx, s, run, state.scared);
    }
    return true;
  }
  if (state.kind === 'toBar' || state.kind === 'apres') {
    const building = ctx.buildings.find((b) => b.id === state.buildingId);
    // Everyone skis down to the base after close, so the walk to the bar goes at going-home speed.
    if (!building) s.state = { kind: 'leaving', happy: s.happiness >= CONFIG.skiers.fedUpHappiness };
    else if (state.kind === 'toBar') {
      if (moveToward(s, building.pos, cfg.leaveSpeed * dt)) sitAtBar(ctx, s, building);
    } else if ((state.left -= dt) <= 0) {
      feel(ctx.journal, ctx.time, s, 'greatApres', CONFIG.apres.joy, building.name);
      s.apresLoyalty = ctx.apresPrice.loyalty;
      s.state = { kind: 'leaving', happy: s.happiness >= CONFIG.skiers.fedUpHappiness };
      s.thought = { kind: 'closing' };
    }
    return true;
  }
  if (state.kind === 'toBuilding' || state.kind === 'eating') {
    const building = ctx.buildings.find((b) => b.id === state.buildingId);
    if (!building) decide(ctx, s);
    else if (state.kind === 'toBuilding') {
      if (moveToward(s, building.pos, cfg.walkSpeed * 2 * dt)) s.state = { kind: 'eating', buildingId: building.id, left: CONFIG.meals.seconds };
    } else if ((state.left -= dt) <= 0) {
      const price = Math.min(s.cash, CONFIG.buildings[building.type].mealPrice);
      s.cash -= price;
      ctx.spend(price, 'meal');
      s.ate = true;
      s.energy = Math.min(100, s.energy + CONFIG.meals.energy);
      feel(ctx.journal, ctx.time, s, 'goodMeal', CONFIG.meals.joy, building.name);
      const lift = building.type === 'hut' ? ctx.mountain.lifts.find((l) => dist(l.top, building.pos) <= CONFIG.meals.hutReach) : undefined;
      if (lift && !ctx.closed) pickRunFromTop(ctx, s, lift);
      else decide(ctx, s);
    }
    return true;
  }
  const lift = ctx.mountain.lifts.find((l) => l.id === state.liftId);
  // Re-decide when the lift was removed, or closing time pulled this skier out of line or off the walk.
  const stranded = !lift || (state.kind !== 'riding' && ctx.closed) || (state.kind === 'queued' && !lift.queue.includes(s.id));
  if (stranded) decide(ctx, s);
  else if (state.kind === 'walking') {
    if (moveToward(s, lift.bottom, cfg.walkSpeed * dt)) {
      lift.queue.push(s.id);
      s.state = { kind: 'queued', liftId: lift.id, waited: 0 };
    }
  } else if (state.kind === 'queued') {
    state.waited += dt;
    if (ctx.held.has(lift.id)) {
      // The wind stopped the lift: after a few minutes in line, skiers give up and try elsewhere.
      if (state.waited > cfg.queueTolerance / 2) {
        lift.queue.splice(lift.queue.indexOf(s.id), 1);
        feel(ctx.journal, ctx.time, s, 'windHold', -4, lift.name);
        s.avoid.push(lift.id);
        decide(ctx, s);
      }
    } else if (state.waited > cfg.queueTolerance) {
      feel(ctx.journal, ctx.time, s, 'longLine', (-cfg.queueHappinessPerMinute * dt) / 60, lift.name);
      s.thought = { kind: 'longLine', lift: lift.name };
    }
  } else {
    const before = state.progress;
    state.progress = Math.min(1, state.progress + dt / rideSeconds(lift));
    if (lift.type === 'ropeTow' && !state.down) {
      // Hanging on to a tow is hard work, so long tows tire skiers out.
      s.energy = Math.max(0, s.energy - (state.progress - before) * lift.length * cfg.towEnergyPerMetre * liftTier(lift).effort);
      if (state.progress === 1 && lift.length >= cfg.tiringTowLength && liftTier(lift).effort === 1) feel(ctx.journal, ctx.time, s, 'tiringTow', -3, lift.name);
    }
    s.pos = state.down ? lerp(lift.top, lift.bottom, state.progress) : lerp(lift.bottom, lift.top, state.progress);
    if (state.progress === 1 && state.down) decide(ctx, s);
    else if (state.progress === 1) arriveAtTop(ctx, s, lift);
  }
  return true;
}
