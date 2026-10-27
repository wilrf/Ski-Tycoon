import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { vec } from '../src/sim/geometry';
import { boardLift, planLift, type Lift } from '../src/sim/lifts';
import { plane } from './helpers';

const t = plane(0.3);

function lift(overrides: Partial<Lift> = {}): Lift {
  return { id: 1, name: 'Test Express', type: 'chairlift', bottom: vec(500, 800), top: vec(500, 200), length: 626, rise: 180, queue: [], boardCredit: 0, ...overrides };
}

describe('lift throughput', () => {
  it.each(['ropeTow', 'chairlift', 'gondola'] as const)('a %s with a long line moves its hourly capacity', (type) => {
    const l = lift({ type, queue: Array.from({ length: 5000 }, (_, i) => i) });
    let boarded = 0;
    for (let s = 0; s < 3600; s += 3) boarded += boardLift(l, 3).length;
    expect(boarded).toBe(CONFIG.lifts[type].capacityPerHour);
  });

  it('boards in queue order', () => {
    const l = lift({ queue: [7, 8, 9] });
    expect(boardLift(l, 2)).toEqual([7]);
  });

  it('does not bank empty seats while nobody is waiting', () => {
    const l = lift();
    for (let s = 0; s < 600; s++) boardLift(l, 1);
    l.queue.push(1, 2, 3, 4, 5);
    expect(boardLift(l, 0)).toHaveLength(1);
  });
});

describe('lift planning', () => {
  const plan = (bottom = vec(500, 800), top = vec(500, 400), money = 1e9, lifts: Lift[] = []) =>
    planLift(t, lifts, money, 'chairlift', bottom, top);

  it('measures length along the slope and the vertical rise', () => {
    const p = plan();
    expect(p.rise).toBeCloseTo(120, 0);
    expect(p.length).toBeCloseTo(Math.hypot(400, 120), 0);
    expect(p.cost).toBe(Math.round(CONFIG.lifts.chairlift.baseCost + CONFIG.lifts.chairlift.costPerMetre * p.length));
    expect(p.problems).toEqual([]);
  });

  it('refuses lifts that go downhill', () => {
    expect(plan(vec(500, 400), vec(500, 800)).problems[0]).toMatch(/higher/);
  });

  it('refuses lifts the company cannot afford, including at zero money', () => {
    expect(plan(undefined, undefined, 0).problems.some((p) => p.startsWith('Costs'))).toBe(true);
  });

  it('refuses lifts that cross or crowd another lift', () => {
    const existing = [lift({ bottom: vec(400, 800), top: vec(600, 400) })];
    expect(plan(vec(600, 800), vec(400, 400), 1e9, existing).problems).toContain('Too close to Test Express.');
    expect(plan(vec(505, 800), vec(505, 400), 1e9, [lift()]).problems).toContain('Too close to Test Express.');
    expect(plan(vec(700, 800), vec(700, 400), 1e9, [lift()]).problems).toEqual([]);
  });

  it('enforces each type’s length and grade limits', () => {
    expect(planLift(t, [], 1e9, 'ropeTow', vec(500, 800), vec(500, 300)).problems.some((p) => p.includes('at most'))).toBe(true);
    expect(planLift(plane(0.5), [], 1e9, 'ropeTow', vec(500, 800), vec(500, 600)).problems).toContain('Too steep for a rope tow.');
  });
});
