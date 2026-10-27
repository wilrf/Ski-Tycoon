import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { deserialize, loadGame, saveGame, serialize, SAVE_VERSION, type KeyValueStore } from '../src/save/save';
import { vec } from '../src/sim/geometry';
import { activeResort, applyCommand, createWorld, tick, type World, type WorldEvent } from '../src/sim/world';

/** A small resort: a chairlift from the base and a run from its top back to the base. */
function builtWorld(): World {
  const world = createWorld(42);
  const extent = activeResort(world).terrain.size * activeResort(world).terrain.cellSize;
  const bottom = vec(extent / 2, extent * 0.86);
  const top = vec(extent / 2, extent * 0.55);
  expect(applyCommand(world, { type: 'buildLift', liftType: 'chairlift', bottom, top })).toEqual({ ok: true });
  const run = [vec(top.x + 30, top.y + 10), vec(top.x + 120, top.y + 200), vec(bottom.x + 60, bottom.y + 40)];
  expect(applyCommand(world, { type: 'buildRun', points: run })).toEqual({ ok: true });
  return world;
}

function playDay(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const day = world.calendar.day;
  while (world.calendar.day === day) events.push(...tick(world));
  return events;
}

describe('world', () => {
  it('admits nobody to an empty mountain', () => {
    const world = createWorld(1);
    playDay(world);
    expect(world.company.money).toBe(CONFIG.economy.startingCash);
  });

  it('runs a full day: skiers arrive, pay, ski and go home', () => {
    const world = builtWorld();
    const afterBuild = world.company.money;
    let peak = 0;
    const day = world.calendar.day;
    const events: WorldEvent[] = [];
    while (world.calendar.day === day) {
      events.push(...tick(world));
      peak = Math.max(peak, activeResort(world).skiers.filter((s) => s.state.kind === 'skiing').length);
    }
    const ended = events.find((e) => e.type === 'dayEnded');
    if (ended?.type !== 'dayEnded') throw new Error('The day never ended.');
    expect(ended.stats.arrivals).toBeGreaterThan(100);
    expect(ended.ledger.tickets).toBe(ended.stats.arrivals * CONFIG.economy.fairTicketPrice);
    expect(world.company.money).toBe(afterBuild + ended.ledger.tickets + ended.ledger.food + ended.ledger.bonuses);
    expect(peak).toBeGreaterThan(0);
    expect(activeResort(world).skiers).toEqual([]);
  });

  it('is reproducible from its seed', () => {
    const a = builtWorld(), b = builtWorld();
    for (let i = 0; i < 2000; i++) (tick(a), tick(b));
    expect(serialize(a, new Date(0))).toBe(serialize(b, new Date(0)));
  });

  it('refunds part of a removed lift and strands nobody', () => {
    const world = builtWorld();
    for (let i = 0; i < 1500; i++) tick(world);
    const lift = activeResort(world).lifts[0]!;
    const before = world.company.money;
    expect(applyCommand(world, { type: 'removeLift', id: lift.id })).toEqual({ ok: true });
    expect(world.company.money).toBeGreaterThan(before);
    for (let i = 0; i < 3000; i++) tick(world);
    expect(activeResort(world).skiers.every((s) => s.state.kind === 'leaving' || s.state.kind === 'skiing')).toBe(true);
    expect(applyCommand(world, { type: 'removeLift', id: lift.id }).ok).toBe(false);
  });
});

describe('save', () => {
  const memoryStore = (): KeyValueStore => {
    const data = new Map<string, string>();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('round-trips a world mid-day and keeps simulating identically', () => {
    const world = builtWorld();
    for (let i = 0; i < 1000; i++) tick(world);
    const store = memoryStore();
    saveGame(store, world);
    const loaded = loadGame(store);
    expect(loaded?.ok).toBe(true);
    if (!loaded?.ok) return;
    expect(loaded.world).toEqual(world);
    for (let i = 0; i < 500; i++) (tick(world), tick(loaded.world));
    expect(serialize(loaded.world, new Date(0))).toBe(serialize(world, new Date(0)));
  });

  it('returns null when there is no save', () => {
    expect(loadGame(memoryStore())).toBeNull();
  });

  it('rejects corrupt, foreign and future saves', () => {
    expect(deserialize('{').ok).toBe(false);
    expect(deserialize('{"hello":1}').ok).toBe(false);
    const future = JSON.stringify({ version: SAVE_VERSION + 1, savedAt: '', world: {} });
    expect(deserialize(future)).toEqual({ ok: false, error: 'This save is from a newer version of the game.' });
  });

  it('stays small enough for localStorage', () => {
    expect(serialize(builtWorld()).length).toBeLessThan(1_000_000);
  });
});
