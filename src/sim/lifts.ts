import { CONFIG, type LiftPartSpec, type LiftTier, type LiftType } from '../config';
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
  /** Index into CONFIG.liftTiers[type]; upgrades raise it in place. */
  tier: number;
  /** Everything spent on the lift, construction plus upgrades, so removal refunds a share of it all. */
  invested: number;
  /** Levels bought of each part (drive, carriers...); missing means none. Older saves have no parts. */
  parts?: Partial<Record<LiftPart, number>>;
}

export type LiftPart = keyof typeof CONFIG.liftParts;
export const LIFT_PARTS = Object.keys(CONFIG.liftParts) as LiftPart[];
type LiftStats = Pick<Lift, 'type' | 'tier' | 'parts'>;

export const partLevel = (lift: LiftStats, part: LiftPart): number => lift.parts?.[part] ?? 0;
/** The value a part gives at the level owned, or `none` without any. */
const partValue = (lift: LiftStats, part: LiftPart, key: 'speed' | 'capacity' | 'lineMood' | 'rideJoy' | 'windHoldHeight', none: number): number => {
  const level = partLevel(lift, part);
  const values = (CONFIG.liftParts[part] as LiftPartSpec)[key];
  return level > 0 && values ? values[level - 1]! : none;
};
export const partsFor = (type: LiftType): LiftPart[] => LIFT_PARTS.filter((p) => (CONFIG.liftParts[p].types as readonly LiftType[]).includes(type));
export const nextPartLevel = (lift: Lift, part: LiftPart) => CONFIG.liftParts[part].levels[partLevel(lift, part)];
export const partCost = (lift: Lift, part: LiftPart): number | undefined => {
  const next = nextPartLevel(lift, part);
  return next && Math.round(liftCost(lift.type, lift.length) * next.costFactor);
};
/** How much a minute in line hurts on this lift: queue lanes and fast gates make waiting easier. */
export const lineMood = (lift: LiftStats): number => partValue(lift, 'loading', 'lineMood', 1);
/** Happiness a ride gives: covered seats and gondolas, plus any seat upgrades. */
export const rideJoy = (lift: LiftStats): number => (liftTier(lift).covered ? 2 : 0) + partValue(lift, 'comfort', 'rideJoy', 0);
export const isCovered = (lift: LiftStats): boolean => liftTier(lift).covered || partLevel(lift, 'comfort') >= 3;
export const windHoldHeight = (lift: LiftStats): number => partValue(lift, 'wind', 'windHoldHeight', CONFIG.weather.windHoldHeight);

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

export const liftTier = (lift: Pick<Lift, 'type' | 'tier'>): LiftTier => CONFIG.liftTiers[lift.type][lift.tier]!;
export const nextTier = (lift: Pick<Lift, 'type' | 'tier'>): LiftTier | undefined => CONFIG.liftTiers[lift.type][lift.tier + 1];
export const liftSpeed = (lift: LiftStats): number => CONFIG.lifts[lift.type].speed * liftTier(lift).speedFactor * partValue(lift, 'drive', 'speed', 1);
export const liftCapacity = (lift: LiftStats): number =>
  CONFIG.lifts[lift.type].capacityPerHour * liftTier(lift).capacityFactor * partValue(lift, 'carriers', 'capacity', 1);
export const upgradeCost = (lift: Lift): number | undefined => {
  const next = nextTier(lift);
  return next && Math.round(liftCost(lift.type, lift.length) * next.upgradeCostFactor);
};

export const rideSeconds = (lift: Lift): number => lift.length / liftSpeed(lift);

export const waitSeconds = (lift: Lift): number => (lift.queue.length * 3600) / liftCapacity(lift);

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
  lift.boardCredit += (liftCapacity(lift) / 3600) * dt;
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
