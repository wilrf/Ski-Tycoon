import { CONFIG, type LiftType } from '../config';
import { dist, segmentDistance, vec, type Vec2 } from './geometry';
import { heightAt, inBounds, type Terrain } from './terrain';

export interface Lift {
  readonly id: number;
  readonly name: string;
  readonly type: LiftType;
  readonly bottom: Vec2;
  readonly top: Vec2;
  /** Length along the cable, in metres. */
  readonly length: number;
  readonly rise: number;
  readonly queue: number[];
  /** Fractional seats that have come round since the last boarding. */
  boardCredit: number;
}

export interface LiftPlan {
  readonly type: LiftType;
  readonly bottom: Vec2;
  readonly top: Vec2;
  readonly length: number;
  readonly rise: number;
  readonly cost: number;
  readonly problems: readonly string[];
}

export const liftCost = (type: LiftType, length: number): number =>
  Math.round(CONFIG.lifts[type].baseCost + CONFIG.lifts[type].costPerMetre * length);

export const rideSeconds = (lift: Lift): number => lift.length / CONFIG.lifts[lift.type].speed;

export const waitSeconds = (lift: Lift): number => (lift.queue.length * 3600) / CONFIG.lifts[lift.type].capacityPerHour;

/** Measures a proposed lift and lists every reason it can't be built. */
export function planLift(t: Terrain, lifts: readonly Lift[], money: number, type: LiftType, bottom: Vec2, top: Vec2): LiftPlan {
  const spec = CONFIG.lifts[type];
  const { minLength, minRise, clearance } = CONFIG.liftRules;
  const horizontal = dist(bottom, top);
  const rise = heightAt(t, top) - heightAt(t, bottom);
  const length = Math.hypot(horizontal, rise);
  const cost = liftCost(type, length);
  const problems: string[] = [];
  if (!inBounds(t, bottom) || !inBounds(t, top)) problems.push('Both stations must be on the map.');
  if (rise < minRise) problems.push('The top station must be higher than the bottom station.');
  if (length < minLength) problems.push(`Lifts must be at least ${minLength} m long.`);
  if (length > spec.maxLength) problems.push(`A ${spec.label.toLowerCase()} can be at most ${spec.maxLength} m long.`);
  if (horizontal > 0 && rise / horizontal > spec.maxGrade) problems.push(`Too steep for a ${spec.label.toLowerCase()}.`);
  const blocking = lifts.find((l) => segmentDistance(bottom, top, l.bottom, l.top) < clearance);
  if (blocking) problems.push(`Too close to ${blocking.name}.`);
  if (cost > money) problems.push(`Costs $${cost.toLocaleString('en-US')}, but you only have $${Math.floor(money).toLocaleString('en-US')}.`);
  return { type, bottom, top, length, rise, cost, problems };
}

/**
 * Advances the lift by dt seconds and returns the skiers who boarded, in queue order.
 * Seats arrive at capacityPerHour; a seat that passes an empty queue is lost, so credit never banks.
 */
export function boardLift(lift: Lift, dt: number): number[] {
  lift.boardCredit += (CONFIG.lifts[lift.type].capacityPerHour / 3600) * dt;
  const boarded = lift.queue.splice(0, Math.min(Math.floor(lift.boardCredit), lift.queue.length));
  lift.boardCredit = Math.min(lift.boardCredit - boarded.length, 1);
  return boarded;
}

/** Where the nth skier in line stands: rows of four behind the bottom station. */
export function queueSpot(lift: Lift, n: number): Vec2 {
  const d = dist(lift.top, lift.bottom) || 1;
  const back = vec((lift.bottom.x - lift.top.x) / d, (lift.bottom.y - lift.top.y) / d);
  const row = 6 + Math.floor(n / 4) * 2.5, col = ((n % 4) - 1.5) * 2;
  return vec(lift.bottom.x + back.x * row - back.y * col, lift.bottom.y + back.y * row + back.x * col);
}
