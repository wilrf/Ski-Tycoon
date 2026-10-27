import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { vec } from '../src/sim/geometry';
import { PEAKS } from '../src/data/peaks';
import { RANGE_PARAMS } from '../src/data/rangeParams';
import { fillPits } from '../src/sim/erosion';
import { peakTerrain } from '../src/sim/peakTerrain';
import { generateRangeGrid, generateRangeTerrain } from '../src/sim/rangeTerrain';
import { RANGE_KEYS } from '../src/sim/ranges';
import { TerrainType, type Terrain } from '../src/sim/terrain';
import { createWorld, heldLifts } from '../src/sim/world';
import { makeLift } from './helpers';

const baseCells = (t: Terrain): number => t.types.filter((k) => k === TerrainType.Base).length;
const peakBytes = (id: string): ArrayBuffer => {
  const b = readFileSync(new URL(`../public/terrain/peaks/${id}.bin`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe('range mountains', () => {
  it.each(RANGE_KEYS)('%s gives a playable map with flat base ground', (key) => {
    const t = generateRangeTerrain(3, RANGE_PARAMS[key]);
    expect(t.size).toBe(CONFIG.terrain.size);
    expect(t.heights.every(Number.isFinite)).toBe(true);
    expect(baseCells(t)).toBeGreaterThan(t.size * 10);
    // The summit is near the top of the map, as on the default mountain.
    const top = t.heights.indexOf(Math.max(...t.heights));
    expect(Math.floor(top / t.size)).toBeLessThan(t.size * 0.4);
  });

  it('gives the same mountain for the same seed and a different one for another', () => {
    const a = generateRangeGrid(9, RANGE_PARAMS.alps).h, b = generateRangeGrid(9, RANGE_PARAMS.alps).h;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(generateRangeGrid(10, RANGE_PARAMS.alps).h)).not.toEqual(Array.from(a));
  });

  it('leaves no closed hollows, so water drains off from everywhere', () => {
    const g = generateRangeGrid(4, RANGE_PARAMS.himalayas);
    const before = Array.from(g.h);
    fillPits(g, 0);
    expect(Math.max(...Array.from(g.h, (v, i) => v - before[i]!))).toBeLessThan(0.05);
  });

  it('makes the Himalayas steeper than the Appalachians', () => {
    const meanGrade = (t: Terrain): number => {
      let sum = 0;
      for (let i = 0; i < t.heights.length - t.size - 1; i++) sum += Math.hypot(t.heights[i + 1]! - t.heights[i]!, t.heights[i + t.size]! - t.heights[i]!) / t.cellSize;
      return sum / t.heights.length;
    };
    expect(meanGrade(generateRangeTerrain(1, RANGE_PARAMS.himalayas))).toBeGreaterThan(meanGrade(generateRangeTerrain(1, RANGE_PARAMS.appalachians)) * 1.3);
  });
});

describe('famous peaks', () => {
  it('lists the top 3 of every range', () => {
    for (const key of RANGE_KEYS) expect(PEAKS.filter((p) => p.range === key)).toHaveLength(3);
  });

  it.each(PEAKS.map((p) => [p.id, p] as const))('%s loads with its summit at the top and base ground at the bottom', (_, entry) => {
    const t = peakTerrain(entry, peakBytes(entry.id), 1);
    const n = t.size, row = Math.round(0.22 * n), col = n / 2, summit = t.heights[row * n + col]!;
    // The summit cell is the high point of its neighbourhood (a cliff like Stawamus Chief can have taller
    // mountains behind it), and holds the recorded height within the data's accuracy: the elevation model
    // measures the top of the trees and snow, so a forested summit like El Capitan reads ~70 m high.
    // A broad dome can read a few metres higher a cell or two away; the summit search samples every 10 m.
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) expect(t.heights[(row + dy) * n + col + dx]!).toBeLessThan(summit + 5);
    expect(Math.abs(summit - entry.summitM)).toBeLessThan(100);
    expect(baseCells(t)).toBeGreaterThan(n * 5);
  });

  it('rejects a heightmap of the wrong size', () => {
    expect(() => peakTerrain(PEAKS[0]!, new ArrayBuffer(10), 1)).toThrow(/expected/);
  });

  it('judges storm holds from the map floor, so a base 5,000 m up is not "high" everywhere', () => {
    const everest = PEAKS.find((p) => p.id === 'mount-everest')!;
    const world = createWorld(1, { terrain: peakTerrain(everest, peakBytes(everest.id), 1), name: everest.name });
    const resort = world.resorts[0]!, extent = resort.terrain.size * resort.terrain.cellSize;
    const low = makeLift(resort.terrain, 1, vec(extent / 2, extent * 0.9), vec(extent / 2, extent * 0.8));
    const high = makeLift(resort.terrain, 2, vec(extent / 2, extent * 0.5), vec(extent / 2, extent * 0.25));
    resort.lifts.push(low, high);
    world.weather.today = 'storm';
    expect([...heldLifts(world, resort)]).toEqual([2]);
  });
});
