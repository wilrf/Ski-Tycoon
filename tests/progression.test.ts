import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { deserialize, SAVE_VERSION } from '../src/save/save';
import { vec } from '../src/sim/geometry';
import { newGuest, recordVisit } from '../src/sim/guests';
import { liftCapacity } from '../src/sim/lifts';
import { leadsSomewhere, mergeOf } from '../src/sim/network';
import { requestMet, type Request } from '../src/sim/requests';
import { funFor } from '../src/sim/runs';
import { updateSkier } from '../src/sim/skiers';
import { activeResort, applyCommand, createWorld, heldLifts, tick, type DayReport, type World } from '../src/sim/world';
import { makeContext, makeLift, makeRun, makeSkier, plane, rng, runOf } from './helpers';

const t = plane(0.3);

/** A chairlift from the base and a run from its top back down, on a generated mountain. */
function builtWorld(seed = 42): World {
  const world = createWorld(seed);
  const extent = activeResort(world).terrain.size * activeResort(world).terrain.cellSize;
  const bottom = vec(extent / 2, extent * 0.86), top = vec(extent / 2, extent * 0.55);
  expect(applyCommand(world, { type: 'buildLift', liftType: 'chairlift', bottom, top })).toEqual({ ok: true });
  const run = [vec(top.x + 30, top.y + 10), vec(top.x + 120, top.y + 200), vec(bottom.x + 60, bottom.y + 40)];
  expect(applyCommand(world, { type: 'buildRun', points: run })).toEqual({ ok: true });
  return world;
}

function playDay(world: World): DayReport {
  const day = world.calendar.day;
  let report: DayReport | undefined;
  while (world.calendar.day === day) for (const e of tick(world)) if (e.type === 'dayEnded') report = e;
  return report!;
}

describe('fun depends on who is skiing', () => {
  it('bores experts on greens and gives beginners no joy on blacks', () => {
    const green = runOf(0), black = runOf(2);
    expect(funFor(black, 3, 0)).toBeGreaterThan(funFor(green, 3, 0));
    expect(funFor(green, 0, 0)).toBeGreaterThan(funFor(black, 0, 0));
    expect(funFor(black, 2, 0)).toBeGreaterThan(funFor(black, 0, 0));
  });

  it('powder makes steep runs more fun', () => {
    const black = runOf(2);
    expect(funFor(black, 2, 0, CONFIG.weather.kinds.powder.fun)).toBeGreaterThan(funFor(black, 2, 0));
  });
});

describe('runs that branch and merge', () => {
  const lift = makeLift(t, 1, vec(500, 900), vec(500, 400));
  const trunk = makeRun(t, [vec(505, 405), vec(505, 600), vec(505, 890)], 'Trunk');
  const branch = makeRun(t, [vec(505, 600), vec(700, 800), vec(700, 950)], 'Branch');
  const feeder = makeRun(t, [vec(300, 300), vec(300, 500), vec(500, 700)], 'Feeder');

  it('counts a run that merges into a skiable run as skiable', () => {
    const m = { terrain: t, lifts: [lift], runs: [trunk, feeder] };
    expect(mergeOf(m, feeder)?.run).toBe(trunk);
    expect(leadsSomewhere(m, feeder)).toBe(true);
  });

  it('sends some skiers down a branch partway along a run', () => {
    const m = { terrain: t, lifts: [lift], runs: [trunk, branch] };
    let branched = 0;
    for (let i = 0; i < 40; i++) {
      const ctx = makeContext(m, { rng: rng(i + 1) });
      const s = makeSkier(vec(505, 405), 0, i);
      s.state = { kind: 'skiing', runId: trunk.id, scared: false, distance: 0 };
      for (let n = 0; n < 200 && s.state.kind === 'skiing'; n++) {
        updateSkier(ctx, s, 3);
        if (s.state.kind === 'skiing' && s.state.runId === branch.id) {
          branched++;
          break;
        }
      }
    }
    expect(branched).toBeGreaterThan(5);
    expect(branched).toBeLessThan(40);
  });
});

describe('returning guests', () => {
  it('get more loyal after a good day and move up a level with practice', () => {
    const guest = newGuest(1, rng(), [1, 1, 1, 1]);
    guest.skill = 0;
    const skier = { ...makeSkier(vec(0, 0), 0), happiness: 90, practice: 25 };
    const loyalty = guest.loyalty;
    expect(recordVisit(guest, skier, true)).toBe(false);
    expect(guest.loyalty).toBeGreaterThan(loyalty);
    // Nobody moves up in one day, however much they ski.
    expect(recordVisit(guest, skier, true)).toBe(false);
    expect(recordVisit(guest, skier, true)).toBe(true);
    expect(guest.skill).toBe(1);
  });

  it('come back on later days', () => {
    const world = builtWorld();
    playDay(world);
    expect(activeResort(world).guests.length).toBeGreaterThan(100);
    const day2 = playDay(world);
    expect(day2.stats.regulars).toBeGreaterThan(0);
  });
});

describe('ticket price', () => {
  it('brings fewer skiers when it is high', () => {
    const cheap = builtWorld(), dear = builtWorld();
    applyCommand(cheap, { type: 'setTicketPrice', price: 39 });
    applyCommand(dear, { type: 'setTicketPrice', price: 129 });
    expect(playDay(dear).stats.arrivals).toBeLessThan(playDay(cheap).stats.arrivals);
  });
});

describe('lift upgrades', () => {
  it('wait for stars, then raise capacity in place and add to what removal refunds', () => {
    const world = builtWorld();
    const lift = activeResort(world).lifts[0]!;
    expect(applyCommand(world, { type: 'upgradeLift', id: lift.id })).toMatchObject({ ok: false });
    world.company.stars = 2;
    const before = liftCapacity(lift), invested = lift.invested;
    expect(applyCommand(world, { type: 'upgradeLift', id: lift.id })).toEqual({ ok: true });
    expect(liftCapacity(lift)).toBeGreaterThan(before);
    expect(lift.invested).toBeGreaterThan(invested);
  });
});

describe('land', () => {
  it('refuses building on land the resort does not own, until it is bought', () => {
    const world = createWorld(7);
    const extent = activeResort(world).terrain.size * activeResort(world).terrain.cellSize;
    const high = vec(extent / 2, extent * 0.3);
    const result = applyCommand(world, { type: 'buildLift', liftType: 'chairlift', bottom: vec(extent / 2, extent * 0.6), top: high });
    expect(result).toMatchObject({ ok: false });
    expect(applyCommand(world, { type: 'buyLand' })).toMatchObject({ ok: false });
    world.company.stars = 2;
    expect(applyCommand(world, { type: 'buyLand' })).toEqual({ ok: true });
    expect(activeResort(world).land).toBe(2);
  });
});

describe('lodges', () => {
  it('feed hungry skiers at lunchtime, for money and energy', () => {
    const lift = makeLift(t, 1, vec(500, 900), vec(500, 400));
    const lodge = { id: 9, name: 'Test Lodge', type: 'lodge' as const, pos: vec(520, 940), upgrades: 0 };
    let earned = 0;
    const ctx = makeContext({ terrain: t, lifts: [lift], runs: [] }, { buildings: [lodge], time: 12.5 * 3600, spend: (n) => void (earned += n) });
    const s = { ...makeSkier(vec(500, 950)), energy: 40 };
    s.state = { kind: 'walking', liftId: -1 };
    for (let i = 0; i < 2000 && !s.ate; i++) updateSkier(ctx, s, 3);
    expect(s.ate).toBe(true);
    expect(earned).toBe(CONFIG.buildings.lodge.mealPrice);
    expect(s.log.some((f) => f.kind === 'goodMeal')).toBe(true);
  });
});

describe('weather', () => {
  it('stops exposed lifts high on the mountain in a storm, but not covered ones', () => {
    const world = createWorld(3);
    world.company.stars = 5;
    world.resorts[0]!.land = 3;
    world.company.money = 1e8;
    const resort = activeResort(world);
    const extent = resort.terrain.size * resort.terrain.cellSize;
    const peak = resort.terrain.heights.indexOf(Math.max(...resort.terrain.heights));
    const top = vec(((peak % resort.terrain.size) + 0.5) * 10, (Math.floor(peak / resort.terrain.size) + 4) * 10);
    const bottom = vec(top.x, extent * 0.6);
    expect(applyCommand(world, { type: 'buildLift', liftType: 'gondola', bottom, top })).toEqual({ ok: true });
    expect(applyCommand(world, { type: 'buildLift', liftType: 'chairlift', bottom: vec(bottom.x + 100, bottom.y), top: vec(top.x + 100, top.y + 150) })).toEqual({ ok: true });
    world.weather.today = 'storm';
    const [gondola, chair] = resort.lifts;
    const held = heldLifts(world, resort);
    expect(held.has(gondola!.id)).toBe(false);
    expect(held.has(chair!.id)).toBe(true);
  });
});

describe('reviews and requests', () => {
  it('rates the resort every few days and pays for new stars', () => {
    const world = builtWorld();
    let review: DayReport | undefined;
    for (let d = 0; d < CONFIG.review.everyDays; d++) {
      const r = playDay(world);
      if (r.review) review = r;
    }
    expect(review?.review?.stars).toBeGreaterThanOrEqual(1);
    expect(world.company.stars).toBe(review!.review!.stars);
    expect(review!.starBonus).toBeGreaterThan(0);
  });

  it('always has requests on offer, and checks them against the mountain', () => {
    const world = builtWorld();
    expect(world.requests.filter((r) => r.status === 'active')).toHaveLength(CONFIG.requests.active);
    const resort = activeResort(world);
    const school: Request = { id: 1, kind: 'skiSchool', target: 1, deadline: 9, reward: 1, status: 'active' };
    const green = resort.runs.some((r) => r.profile.difficulty === 0);
    expect(requestMet(school, resort, null)).toBe(green);
  });
});

describe('save upgrade', () => {
  it('loads a version 1 save, keeping what was built', () => {
    const world = builtWorld();
    const resort = activeResort(world);
    const v1 = {
      seed: world.seed, rng: world.rng, nextId: world.nextId, calendar: world.calendar,
      company: { name: 'Summit Resorts', money: 1234, today: { tickets: 0, construction: 0, refunds: 0 } },
      resorts: [{
        name: resort.name, terrain: resort.terrain, entrance: resort.entrance, skiers: [], arrivalCredit: 0,
        lifts: resort.lifts.map(({ tier: _t, invested: _i, ...l }) => l), runs: resort.runs,
        today: { arrivals: 0, leftHappy: 0, leftUnhappy: 0 },
      }],
    };
    const loaded = deserialize(JSON.stringify({ version: 1, savedAt: '', world: v1 }));
    expect(SAVE_VERSION).toBe(4);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(activeResort(loaded.world).lifts[0]!.tier).toBe(0);
    expect(activeResort(loaded.world).runs).toHaveLength(1);
    expect(activeResort(loaded.world).runs[0]!.features).toEqual([]);
    expect(loaded.world.company.today.upkeep).toBe(0);
    expect(loaded.world.company.money).toBe(1234);
    playDay(loaded.world);
  });
});

describe('run rules', () => {
  it('refuse tiny runs', () => {
    const world = builtWorld();
    const extent = activeResort(world).terrain.size * activeResort(world).terrain.cellSize;
    const result = applyCommand(world, { type: 'buildRun', points: [vec(extent / 2, extent * 0.6), vec(extent / 2, extent * 0.6 + 70)] });
    expect(result).toMatchObject({ ok: false });
  });
});

describe('day report fixes', () => {
  it('remembers where complaints happened and points at the culprit lift', async () => {
    const { fixFor } = await import('../src/ui/fixes');
    const { worstPlace } = await import('../src/sim/progress');
    const world = builtWorld();
    applyCommand(world, { type: 'setTicketPrice', price: 9 });
    const report = playDay(world);
    const tally = report.stats.feelings;
    const lift = activeResort(world).lifts[0]!;
    if (tally.longLine) {
      expect(worstPlace(tally, 'longLine')).toBe(lift.name);
    }
    expect(fixFor(world, 'longLine', lift.name)?.target).toEqual({ kind: 'select', selection: { kind: 'lift', id: lift.id } });
    expect(fixFor(world, 'overpriced', '')?.target).toEqual({ kind: 'action', action: 'resort' });
  });

  it('says why land is locked and when the next review is', () => {
    const world = createWorld(7);
    const result = applyCommand(world, { type: 'buyLand' });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain(`end of day ${CONFIG.review.everyDays}`);
  });
});

describe('ticket price forecast', () => {
  it('expects more skiers at a lower price, and knows how many the lifts carry', async () => {
    const { forecastDay } = await import('../src/sim/world');
    const world = builtWorld();
    const resort = activeResort(world);
    const cheap = forecastDay(world, resort, 29), dear = forecastDay(world, resort, 99);
    expect(cheap.skiers).toBeGreaterThan(dear.skiers);
    expect(cheap.comfortable).toBe(dear.comfortable);
    expect(cheap.comfortable).toBeGreaterThan(0);
    // The forecast is in the right ballpark of a real day at the same price.
    const forecast = forecastDay(world, resort, resort.ticketPrice).skiers;
    const day = playDay(world).stats.arrivals;
    expect(forecast).toBeGreaterThan(day * 0.6);
    expect(forecast).toBeLessThan(day * 1.6);
  });
});

describe('tapping the map', () => {
  it('picks the run at its ends and a skier in the middle', async () => {
    const { createUiState, tapMap } = await import('../src/ui/tools');
    const { pointAlong } = await import('../src/sim/geometry');
    const world = builtWorld();
    const resort = activeResort(world);
    const run = resort.runs[0]!;
    const middle = pointAlong(run.points, run.profile.length / 2);
    const skier = makeSkier(vec(middle.x + 6, middle.y), 1, 999);
    resort.skiers.push(skier);
    const ui = createUiState();
    tapMap(world, ui, run.points[0]!, 14);
    expect(ui.selection).toEqual({ kind: 'run', id: run.id });
    tapMap(world, ui, middle, 14);
    expect(ui.selection).toEqual({ kind: 'skier', id: skier.id });
    tapMap(world, ui, run.points[run.points.length - 1]!, 14);
    expect(ui.selection?.kind).not.toBe('skier');
  });
});

describe('five skill levels', () => {
  it('treats pros and olympians as at home on double blacks', () => {
    const double = runOf(3), black = runOf(2);
    expect(funFor(double, 4, 0)).toBeCloseTo(funFor(double, 3, 0), 5);
    expect(funFor(double, 4, 0)).toBeGreaterThan(funFor(black, 4, 0));
  });

  it('lets guests practise up to pro, but never to olympic', () => {
    const guest = newGuest(1, rng(), [1, 1, 1, 1, 1]);
    guest.skill = 3;
    const skier = { ...makeSkier(vec(0, 0), 3), happiness: 90, practice: 50 };
    for (let i = 0; i < 10; i++) recordVisit(guest, skier, true);
    expect(guest.skill).toBe(3);
  });
});
