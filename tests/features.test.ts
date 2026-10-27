import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { deserialize, serialize } from '../src/save/save';
import { vec, type Vec2 } from '../src/sim/geometry';
import { featureFun, featureProblem, funFor, profileRun, type Run } from '../src/sim/runs';
import { chooseRun } from '../src/sim/skiers';
import { activeResort, applyCommand, createWorld, tick, type DayReport, type World } from '../src/sim/world';
import { makeRun, plane, rng, runOf } from './helpers';

/** A run that swings 60 m either side of the fall line every 100 m. */
const sCurve = (): Vec2[] => Array.from({ length: 31 }, (_, i) => vec(500 + 60 * Math.sin((i * Math.PI) / 5), 100 + i * 20));

const withFeatures = (run: Run, ...types: (keyof typeof CONFIG.features)[]): Run =>
  ({ ...run, features: types.map((type, i) => ({ type, at: 50 + i * 50 })) });

describe('curves', () => {
  it('count nothing for a straight run and plenty for one that winds down the fall line', () => {
    expect(profileRun(plane(0.3), [vec(500, 100), vec(500, 700)]).curviness).toBe(0);
    expect(profileRun(plane(0.3), sCurve()).curviness).toBeGreaterThan(CONFIG.runs.fullCurviness);
  });

  it('count nothing on ground too flat to ski, like a winding cat track', () => {
    expect(profileRun(plane(0.05), sCurve()).curviness).toBe(0);
  });

  it('add fun for every level', () => {
    const run = makeRun(plane(0.3), sCurve());
    for (const skill of [0, 1, 2, 3] as const) expect(featureFun(run, skill)).toBeCloseTo(CONFIG.runs.curveFun, 5);
  });
});

describe('features', () => {
  it('suit the skiers who love them, and nobody else', () => {
    const green = runOf(0);
    expect(featureFun(withFeatures(green, 'rollers'), 0)).toBeGreaterThan(0);
    expect(featureFun(withFeatures(green, 'largeJump'), 0)).toBe(0);
    expect(featureFun(withFeatures(green, 'largeJump'), 3)).toBeGreaterThan(featureFun(withFeatures(green, 'rollers'), 3));
  });

  it('are capped, so they can’t rescue a dull run', () => {
    const loaded = withFeatures(runOf(0), 'rollers', 'berms', 'tunnel', 'smallJump');
    expect(featureFun(loaded, 0)).toBe(CONFIG.featureRules.maxFun);
    const base = funFor(runOf(0), 0, 0);
    expect(funFor(loaded, 0, 0)).toBeCloseTo(Math.min(10, base + Math.min(base, CONFIG.featureRules.maxFun)), 5);
  });

  it('do nothing for a skier out of their depth', () => {
    const black = runOf(2);
    expect(funFor(withFeatures(black, 'berms'), 0, 0)).toBe(funFor(black, 0, 0));
  });

  it('draw skiers who like them to the run', () => {
    const plain = runOf(1), bermed = withFeatures(runOf(1), 'berms', 'smallJump');
    const r = rng(7);
    let picks = 0;
    for (let i = 0; i < 4000; i++) if (chooseRun([plain, bermed], 1, r)?.run === bermed) picks++;
    expect(picks / 4000).toBeGreaterThan(0.6);
  });

  it('need space, keep off the ends, and allow one tunnel per run', () => {
    const run = makeRun(plane(0.3), [vec(500, 100), vec(500, 500)]);
    const { spacing, maxPerRun } = CONFIG.featureRules;
    expect(featureProblem(run, 'berms', 10)).not.toBeNull();
    expect(featureProblem(run, 'berms', 395)).not.toBeNull();
    expect(featureProblem(run, 'berms', 200)).toBeNull();
    const tunnelled = { ...run, features: [{ type: 'tunnel' as const, at: 100 }] };
    expect(featureProblem(tunnelled, 'tunnel', 300)).not.toBeNull();
    expect(featureProblem(tunnelled, 'berms', 100 + spacing / 2)).not.toBeNull();
    const full = { ...run, features: Array.from({ length: maxPerRun }, (_, i) => ({ type: 'berms' as const, at: 50 + i * 60 })) };
    expect(featureProblem(full, 'rollers', 340)).not.toBeNull();
  });
});

/** A chairlift from the base and a run from its top back down, on a generated mountain. */
function builtWorld(): World {
  const world = createWorld(42);
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

describe('building features', () => {
  it('costs money up front and upkeep every night', () => {
    const world = builtWorld();
    const run = activeResort(world).runs[0]!;
    const before = world.company.money;
    expect(applyCommand(world, { type: 'addFeature', runId: run.id, featureType: 'berms', at: 100 })).toEqual({ ok: true });
    expect(world.company.money).toBe(before - CONFIG.features.berms.cost);
    expect(applyCommand(world, { type: 'addFeature', runId: run.id, featureType: 'rollers', at: 110 })).toMatchObject({ ok: false });
    expect(playDay(world).ledger.upkeep).toBe(CONFIG.features.berms.upkeepPerDay);
  });

  it('refunds half when features or their run are removed', () => {
    const world = builtWorld();
    const run = activeResort(world).runs[0]!;
    applyCommand(world, { type: 'addFeature', runId: run.id, featureType: 'largeJump', at: 100 });
    const before = world.company.money;
    expect(applyCommand(world, { type: 'clearFeatures', runId: run.id })).toEqual({ ok: true });
    expect(world.company.money).toBe(before + CONFIG.features.largeJump.cost * CONFIG.economy.removalRefund);
    expect(run.features).toEqual([]);
  });

  it('survive a save and load', () => {
    const world = builtWorld();
    const run = activeResort(world).runs[0]!;
    applyCommand(world, { type: 'addFeature', runId: run.id, featureType: 'tunnel', at: 120 });
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(activeResort(loaded.world).runs[0]!.features).toEqual([{ type: 'tunnel', at: 120 }]);
  });
});
