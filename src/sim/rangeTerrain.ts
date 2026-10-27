import { CONFIG } from '../config';
import { fillPits, incise, slide, soften, type HeightGrid } from './erosion';
import { clamp } from './geometry';
import { fractal, gradientNoise } from './noise';
import type { RangeParams } from './ranges';
import { createRng, nextFloat } from './rng';
import { terrainFromGrid, type Terrain } from './terrain';

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Soft steps: flat shelves joined by short risers, `steps` of them between 0 and `top`. */
function terrace(h: number, top: number, steps: number): number {
  const s = (h / top) * steps, k = Math.floor(s);
  return ((k + smooth(s - k)) / steps) * top;
}

/**
 * A ski face in a range's character, as heights in metres on the game grid. Four passes:
 *  1. shape: a summit near the top falling to a base along the bottom edge (same layout as the default mountain);
 *  2. landforms: ridged noise starting at ~700 m, the spacing of real spurs and valleys, with finer octaves fading
 *     by `gain`; it fades toward the base;
 *  3. benches: the upper face is partly terraced into shelves and broad tops;
 *  4. erosion: hollows are filled so all water drains, water cuts a drainage network, soil creep rounds it, and
 *     oversteep ground slides to the talus angle, which leaves the planar slopes real mountains have.
 * The bottom strip is then eased flat so the game always finds base ground.
 */
export function generateRangeGrid(seed: number, p: RangeParams): HeightGrid {
  const { size, cellSize, baseLine } = CONFIG.terrain;
  const rng = createRng(seed);
  const extent = size * cellSize;
  const peakX = extent * (0.4 + 0.2 * nextFloat(rng)), peakY = extent * (0.1 + 0.06 * nextFloat(rng));
  const baseY = extent * baseLine;
  const landforms = fractal(gradientNoise(seed ^ 0x51), 4, p.gain, p.ridged);
  const h = new Float64Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const x = ((i % size) + 0.5) * cellSize, y = (Math.floor(i / size) + 0.5) * cellSize;
    const dx = (x - peakX) / extent;
    // The back side behind the peak is steeper than the front face.
    const dy = (y - peakY) / (y < peakY ? (baseY - peakY) * 0.7 : baseY - peakY);
    const t = clamp((1 - Math.hypot(dx, dy, 0.1)) / 0.9, 0, 1);
    // Spurs run down the fall line, so the noise is stretched a little along y.
    let z = t ** p.profile + p.spurs * (0.15 + t) * landforms(x / 700, y / 900);
    z = z + (terrace(z, 1, 5) - z) * p.bench * smooth(clamp(t * 1.6 - 0.3, 0, 1));
    h[i] = p.relief * z - Math.max(0, y - baseY) * 0.03;
  }
  const grid = { size, cellSize, h };
  fillPits(grid);
  incise(grid, p.incision, 24);
  soften(grid, p.creep, 8);
  slide(grid, p.talus, 30);
  easeBase(grid, baseLine);
  fillPits(grid);
  return grid;
}

/** Carries the ground at the 72% line into the bottom strip at a 4% grade, smoothed across the map. */
function easeBase({ size, cellSize, h }: HeightGrid, baseLine: number): void {
  const r0 = Math.floor((baseLine - 0.1) * size), span = 0.12 * size, radius = 25;
  const anchor = Array.from({ length: size }, (_, c) => {
    let sum = 0, weight = 0;
    for (let k = Math.max(0, c - radius); k <= Math.min(size - 1, c + radius); k++) {
      const w = radius + 1 - Math.abs(k - c);
      sum += h[r0 * size + k]! * w;
      weight += w;
    }
    return sum / weight;
  });
  for (let r = r0; r < size; r++) {
    const w = smooth(clamp((r - r0) / span, 0, 1));
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      h[i] = h[i]! * (1 - w) + (anchor[c]! - (r - r0) * cellSize * 0.04) * w;
    }
  }
}

export function generateRangeTerrain(seed: number, p: RangeParams): Terrain {
  const grid = generateRangeGrid(seed, p);
  const forest = fractal(gradientNoise(seed ^ 0xf0), 2, 0.5);
  return terrainFromGrid(grid, (pt) => 0.5 + 0.5 * forest(pt.x / 90, pt.y / 90));
}
