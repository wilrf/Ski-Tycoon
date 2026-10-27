import { CONFIG, type Level } from '../config';
import { clamp, dist, lerp, pointAlong, type Vec2 } from './geometry';
import { rideSeconds, waitSeconds, type Lift } from './lifts';
import { leadsSomewhere, liftsFrom, runsFromLift, type Mountain } from './network';
import { nextFloat, nextRange, pickWeighted, type Rng } from './rng';
import { rateRun, type Run } from './runs';

export type SkillLevel = Level;

export type Thought =
  | { readonly kind: 'arrived' }
  | { readonly kind: 'longLine'; readonly lift: string }
  | { readonly kind: 'riding'; readonly lift: string }
  | { readonly kind: 'enjoying'; readonly run: string }
  | { readonly kind: 'tooSteep'; readonly run: string }
  | { readonly kind: 'lovedRun'; readonly run: string }
  | { readonly kind: 'okRun'; readonly run: string }
  | { readonly kind: 'survivedRun'; readonly run: string }
  | { readonly kind: 'noRunForMe'; readonly lift: string }
  | { readonly kind: 'nothingToSki' }
  | { readonly kind: 'tired' }
  | { readonly kind: 'fedUp' }
  | { readonly kind: 'closing' };

export type SkierState =
  | { readonly kind: 'walking'; readonly liftId: number }
  | { readonly kind: 'queued'; readonly liftId: number; waited: number }
  | { readonly kind: 'riding'; readonly liftId: number; readonly down: boolean; progress: number }
  | { readonly kind: 'skiing'; readonly runId: number; readonly scared: boolean; distance: number }
  | { readonly kind: 'leaving'; readonly happy: boolean };

export interface Skier {
  readonly id: number;
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
}

export interface SkierContext {
  readonly mountain: Mountain;
  readonly rng: Rng;
  /** Lifts have stopped loading for the day. */
  readonly closed: boolean;
  readonly exit: Vec2;
  /** Skiers currently on each run, by run id. */
  readonly crowd: ReadonlyMap<number, number>;
}

const SKILLS: readonly SkillLevel[] = [0, 1, 2, 3];

export function createSkier(id: number, pos: Vec2, rng: Rng): Skier {
  const { skillMix, cashRange, startHappiness } = CONFIG.skiers;
  return {
    id,
    skill: pickWeighted(rng, SKILLS, (s) => skillMix[s]) ?? 0,
    cash: Math.round(nextRange(rng, cashRange)),
    energy: 100,
    happiness: nextRange(rng, startHappiness),
    pos,
    // No lift yet: the first update finds none and has the skier decide where to go.
    state: { kind: 'walking', liftId: -1 },
    thought: { kind: 'arrived' },
    avoid: [],
  };
}

/**
 * Picks a run at or below the skier's skill, favouring runs that match it exactly.
 * With nothing comfortable, a brave skier may try one level up and be scared; otherwise null.
 */
export function chooseRun(runs: readonly Run[], skill: SkillLevel, rng: Rng): { run: Run; scared: boolean } | null {
  const comfortable = pickWeighted(rng, runs, (r) => (r.profile.difficulty === skill ? 3 : r.profile.difficulty < skill ? 1 : 0));
  if (comfortable) return { run: comfortable, scared: false };
  const stretch = pickWeighted(rng, runs, (r) => (r.profile.difficulty === skill + 1 ? 1 : 0));
  return stretch && nextFloat(rng) < CONFIG.skiers.braveChance ? { run: stretch, scared: true } : null;
}

/** Picks a reachable lift, preferring ones with runs the skier can handle and short lines. */
function chooseLift(m: Mountain, skier: Skier, rng: Rng): Lift | undefined {
  const suits = (lift: Lift): boolean => runsFromLift(m, lift).some((r) => r.profile.difficulty <= skier.skill && leadsSomewhere(m, r));
  const options = liftsFrom(m, skier.pos).filter((l) => !skier.avoid.includes(l.id));
  return pickWeighted(rng, options, (l) => (suits(l) ? 4 : 1) / (1 + waitSeconds(l) / CONFIG.skiers.queueTolerance));
}

const adjustHappiness = (s: Skier, delta: number): void => {
  s.happiness = clamp(s.happiness + delta, 0, 100);
};

/** Moves toward target and reports whether the skier got there. */
function moveToward(s: Skier, target: Vec2, step: number): boolean {
  const d = dist(s.pos, target);
  s.pos = d <= step ? target : lerp(s.pos, target, step / d);
  return d <= step;
}

/** What a skier does at a junction: go home, or head for a lift. */
export function decide(ctx: SkierContext, s: Skier): void {
  const leave = (happy: boolean, thought: Thought): void => {
    s.state = { kind: 'leaving', happy };
    s.thought = thought;
  };
  if (ctx.closed) return leave(true, { kind: 'closing' });
  if (s.energy < CONFIG.skiers.tiredEnergy) return leave(true, { kind: 'tired' });
  if (s.happiness < CONFIG.skiers.fedUpHappiness) return leave(false, { kind: 'fedUp' });
  const lift = chooseLift(ctx.mountain, s, ctx.rng);
  if (!lift) return leave(false, { kind: 'nothingToSki' });
  s.state = { kind: 'walking', liftId: lift.id };
}

export function boardSkier(s: Skier, lift: Lift): void {
  s.state = { kind: 'riding', liftId: lift.id, down: false, progress: 0 };
  s.thought = { kind: 'riding', lift: lift.name };
}

function arriveAtTop(ctx: SkierContext, s: Skier, lift: Lift): void {
  const runs = runsFromLift(ctx.mountain, lift).filter((r) => leadsSomewhere(ctx.mountain, r));
  const choice = chooseRun(runs, s.skill, ctx.rng);
  if (!choice) {
    s.state = { kind: 'riding', liftId: lift.id, down: true, progress: 0 };
    s.thought = { kind: 'noRunForMe', lift: lift.name };
    s.avoid.push(lift.id);
    return adjustHappiness(s, -CONFIG.skiers.rideDownPenalty);
  }
  const { run, scared } = choice;
  s.pos = run.points[0]!;
  s.state = { kind: 'skiing', runId: run.id, scared, distance: 0 };
  s.thought = scared ? { kind: 'tooSteep', run: run.name } : { kind: 'enjoying', run: run.name };
  if (scared) adjustHappiness(s, -CONFIG.skiers.scaredPenalty);
}

function finishRun(ctx: SkierContext, s: Skier, run: Run, scared: boolean): void {
  const { fun } = rateRun(run, ctx.crowd.get(run.id) ?? 0);
  s.energy = Math.max(0, s.energy - run.profile.vertical * CONFIG.skiers.energyPerVerticalMetre);
  s.avoid = [];
  if (scared) s.thought = { kind: 'survivedRun', run: run.name };
  else {
    adjustHappiness(s, (CONFIG.skiers.bestRunJoy * fun) / 10);
    s.thought = fun >= 6 ? { kind: 'lovedRun', run: run.name } : { kind: 'okRun', run: run.name };
  }
  decide(ctx, s);
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
      state.distance += cfg.skiSpeed[s.skill] * (state.scared ? cfg.scaredSpeedFactor : 1) * dt;
      s.pos = pointAlong(run.points, state.distance);
      if (state.distance >= run.profile.length) finishRun(ctx, s, run, state.scared);
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
    if (state.waited > cfg.queueTolerance) {
      adjustHappiness(s, (-cfg.queueHappinessPerMinute * dt) / 60);
      s.thought = { kind: 'longLine', lift: lift.name };
    }
  } else {
    state.progress = Math.min(1, state.progress + dt / rideSeconds(lift));
    s.pos = state.down ? lerp(lift.top, lift.bottom, state.progress) : lerp(lift.bottom, lift.top, state.progress);
    if (state.progress === 1 && state.down) decide(ctx, s);
    else if (state.progress === 1) arriveAtTop(ctx, s, lift);
  }
  return true;
}
