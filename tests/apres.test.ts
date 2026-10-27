import { describe, expect, it } from 'vitest';
import { CONFIG, type ApresPrice } from '../src/config';
import { seatsOf, type Building } from '../src/sim/buildings';
import { vec } from '../src/sim/geometry';
import { newGuest, recordVisit } from '../src/sim/guests';
import { decide, updateSkier, type SkierContext } from '../src/sim/skiers';
import { activeResort, applyCommand, createWorld, tick, type DayReport, type World } from '../src/sim/world';
import { makeContext, makeSkier, plane, rng } from './helpers';

const t = plane(0.3);
const CLOSE = CONFIG.calendar.closeHour * 3600;
const lodge = (): Building => ({ id: 9, name: 'Test Lodge', type: 'lodge', pos: vec(520, 940), upgrades: 0 });

const closingContext = (overrides: Partial<SkierContext> = {}): SkierContext =>
  makeContext({ terrain: t, lifts: [], runs: [] }, { buildings: [lodge()], closed: true, time: CLOSE, rng: rng(11), ...overrides });

/** The share of skiers at this happiness who choose après at closing. */
function stayShare(price: ApresPrice, happiness: number, buildings: Building[] = [lodge()]): number {
  const ctx = closingContext({ apresPrice: CONFIG.apres.prices[price], buildings });
  let stayed = 0;
  for (let i = 0; i < 4000; i++) {
    const s = { ...makeSkier(vec(500, 950), 1, i), happiness };
    decide(ctx, s);
    if (s.state.kind === 'toBar') stayed++;
    ctx.occupancy.clear();
  }
  return stayed / 4000;
}

describe('who stays for après', () => {
  it('nobody stays without a base lodge', () => {
    expect(stayShare('medium', 70, [])).toBe(0);
  });

  it('skiers in a typical mood stay at the configured share at the medium price', () => {
    expect(stayShare('medium', CONFIG.apres.typicalHappiness)).toBeCloseTo(CONFIG.apres.stayShare, 1);
  });

  it('the bar only opens at 2:30 PM for skiers too tired to go on', () => {
    const tired = (time: number) => {
      const ctx = closingContext({ closed: false, time, apresPrice: { ...CONFIG.apres.prices.medium, stay: 100 } });
      const s = { ...makeSkier(vec(500, 950)), energy: 1, ate: true };
      decide(ctx, s);
      return s.state.kind;
    };
    expect(tired(14 * 3600)).toBe('leaving');
    expect(tired(15 * 3600)).toBe('toBar');
  });

  it('cheaper drinks keep more skiers and pricier ones fewer', () => {
    const [low, medium, high] = (['low', 'medium', 'high'] as const).map((p) => stayShare(p, 50));
    expect(low).toBeGreaterThan(medium!);
    expect(high).toBeLessThan(medium!);
  });

  it('happy skiers stay more than grumpy ones, and fed-up skiers go straight home', () => {
    expect(stayShare('medium', 80)).toBeGreaterThan(stayShare('medium', 40));
    expect(stayShare('medium', CONFIG.skiers.fedUpHappiness - 1)).toBe(0);
  });

  it('nobody new sits down after last call', () => {
    const ctx = closingContext({ apresPrice: { ...CONFIG.apres.prices.medium, stay: 100 }, time: CONFIG.apres.lastCallHour * 3600 });
    const s = makeSkier(vec(500, 950));
    decide(ctx, s);
    expect(s.state.kind).toBe('leaving');
  });

  it('turns guests away when every lodge is full', () => {
    let turned = 0;
    const full = lodge();
    const ctx = closingContext({ apresPrice: { ...CONFIG.apres.prices.medium, stay: 100 }, turnedAway: () => void turned++ });
    ctx.occupancy.set(full.id, seatsOf(full));
    const s = makeSkier(vec(500, 950));
    decide(ctx, s);
    expect(s.state.kind).toBe('leaving');
    expect(turned).toBe(1);
    expect(s.log.at(-1)?.kind).toBe('lodgeFull');
  });
});

describe('an evening at the bar', () => {
  it('buys a round at the tier price, enjoys it and leaves with loyalty to add', () => {
    const spent: [number, string][] = [];
    const ctx = closingContext({ apresPrice: { ...CONFIG.apres.prices.medium, stay: 100 }, spend: (n, what) => void spent.push([n, what]) });
    const s = makeSkier(vec(500, 950));
    decide(ctx, s);
    for (let i = 0; i < 5000 && s.state.kind !== 'leaving'; i++) updateSkier({ ...ctx, time: CLOSE + i * 3 }, s, 3);
    expect(s.state.kind).toBe('leaving');
    expect(spent).toHaveLength(1);
    expect(spent[0]![1]).toBe('apres');
    expect(spent[0]![0] % CONFIG.apres.prices.medium.drinkPrice).toBe(0);
    expect(spent[0]![0]).toBeGreaterThan(0);
    expect(s.log.at(-1)?.kind).toBe('greatApres');
    expect(s.apresLoyalty).toBe(CONFIG.apres.prices.medium.loyalty);
  });

  it('adds the tier loyalty when the guest goes home', () => {
    const guest = newGuest(1, rng(1), [1, 1, 1, 1]);
    const plain = { ...guest };
    const s = { ...makeSkier(vec(0, 0)), apresLoyalty: 2 };
    recordVisit(guest, s, true);
    recordVisit(plain, { ...s, apresLoyalty: 0 }, true);
    expect(guest.loyalty - plain.loyalty).toBe(2);
  });
});

/** A world with a base lift, a run and a lodge by the entrance. */
function apresWorld(): World {
  const world = createWorld(42);
  const resort = activeResort(world);
  const extent = resort.terrain.size * resort.terrain.cellSize;
  const bottom = vec(extent / 2, extent * 0.86), top = vec(extent / 2, extent * 0.55);
  expect(applyCommand(world, { type: 'buildLift', liftType: 'chairlift', bottom, top })).toEqual({ ok: true });
  const run = [vec(top.x + 30, top.y + 10), vec(top.x + 120, top.y + 200), vec(bottom.x + 60, bottom.y + 40)];
  expect(applyCommand(world, { type: 'buildRun', points: run })).toEqual({ ok: true });
  expect(applyCommand(world, { type: 'buildBuilding', buildingType: 'lodge', pos: vec(resort.entrance.x + 60, resort.entrance.y - 20) })).toEqual({ ok: true });
  return world;
}

describe('the evening in the world', () => {
  it('runs après after close, sweeps the mountain, and reports once the bar empties', () => {
    const world = apresWorld();
    const sweep = CLOSE + CONFIG.calendar.sweepAfterClose;
    let report: DayReport | undefined;
    let checkedSweep = false;
    while (!report) {
      for (const e of tick(world)) if (e.type === 'dayEnded') report = e;
      if (!report && !checkedSweep && world.calendar.time >= sweep + 3) {
        checkedSweep = true;
        // After the sweep, only après guests are left, and all of them are down at the lodge.
        expect(activeResort(world).skiers.every((s) => s.state.kind === 'toBar' || s.state.kind === 'apres')).toBe(true);
      }
    }
    expect(checkedSweep).toBe(true);
    expect(report.stats.apresGuests).toBeGreaterThan(0);
    expect(report.ledger.apres).toBeGreaterThan(0);
    expect(world.calendar.day).toBe(2);
  });
});

describe('growing a lodge', () => {
  it('adds a sun deck, then a bar wing, then stops; removing it refunds the extensions too', () => {
    const world = apresWorld();
    const resort = activeResort(world);
    const b = resort.buildings[0]!;
    expect(seatsOf(b)).toBe(120);
    expect(applyCommand(world, { type: 'upgradeLodge', id: b.id })).toEqual({ ok: true });
    expect(seatsOf(b)).toBe(200);
    expect(applyCommand(world, { type: 'upgradeLodge', id: b.id })).toEqual({ ok: true });
    expect(seatsOf(b)).toBe(300);
    expect(applyCommand(world, { type: 'upgradeLodge', id: b.id }).ok).toBe(false);
    const before = world.company.money;
    expect(applyCommand(world, { type: 'removeBuilding', id: b.id })).toEqual({ ok: true });
    expect(world.company.money - before).toBe((60_000 + 40_000 + 90_000) * CONFIG.economy.removalRefund);
  });

  it('sets the après price for the resort', () => {
    const world = apresWorld();
    expect(applyCommand(world, { type: 'setApresPrice', price: 'high' })).toEqual({ ok: true });
    expect(activeResort(world).apresPrice).toBe('high');
  });
});
