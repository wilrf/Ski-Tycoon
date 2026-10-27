import { CONFIG } from '../config';
import { clamp, vec, type Vec2 } from './geometry';
import type { HeightGrid } from './erosion';
import { createRng, nextFloat, type Rng } from './rng';

export const TerrainType = { Snow: 0, Forest: 1, Rock: 2, Base: 3 } as const;
export type TerrainType = (typeof TerrainType)[keyof typeof TerrainType];

/** Heights in metres on a square grid; cell (cx, cy) is centred at ((cx + 0.5) * cellSize, (cy + 0.5) * cellSize). */
export interface Terrain {
  readonly size: number;
  readonly cellSize: number;
  readonly heights: number[];
  readonly types: TerrainType[];
}

export const terrainExtent = (t: Terrain): number => t.size * t.cellSize;

export const inBounds = (t: Terrain, p: Vec2): boolean =>
  p.x >= 0 && p.y >= 0 && p.x <= terrainExtent(t) && p.y <= terrainExtent(t);

const cellIndex = (t: Terrain, cx: number, cy: number): number =>
  clamp(Math.round(cy), 0, t.size - 1) * t.size + clamp(Math.round(cx), 0, t.size - 1);

/** Bilinear height at any point; points off the map take the nearest edge height. */
export function heightAt(t: Terrain, p: Vec2): number {
  const gx = clamp(p.x / t.cellSize - 0.5, 0, t.size - 1);
  const gy = clamp(p.y / t.cellSize - 0.5, 0, t.size - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const h = (dx: number, dy: number): number => t.heights[cellIndex(t, x0 + dx, y0 + dy)]!;
  return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fy) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fy;
}

export const typeAt = (t: Terrain, p: Vec2): TerrainType =>
  t.types[cellIndex(t, p.x / t.cellSize - 0.5, p.y / t.cellSize - 0.5)]!;

/** Fall-line grade (rise over run) of the cell, from central differences. */
export function cellGrade(t: Terrain, cx: number, cy: number): number {
  const h = (x: number, y: number): number => t.heights[cellIndex(t, x, y)]!;
  const dx = (h(cx + 1, cy) - h(cx - 1, cy)) / (2 * t.cellSize);
  const dy = (h(cx, cy + 1) - h(cx, cy - 1)) / (2 * t.cellSize);
  return Math.hypot(dx, dy);
}

/** Builds a terrain from a height function of metre coordinates. Types come from elevation and slope. */
export function terrainFromHeights(size: number, cellSize: number, height: (p: Vec2) => number, forest: (p: Vec2) => number = () => 0): Terrain {
  const centre = (i: number): Vec2 => vec(((i % size) + 0.5) * cellSize, (Math.floor(i / size) + 0.5) * cellSize);
  // Rounded to 10 cm to keep saves small; `|| 0` turns -0, which JSON can't hold, into 0.
  const heights = Array.from({ length: size * size }, (_, i) => Math.round(height(centre(i)) * 10) / 10 || 0);
  const t: Terrain = { size, cellSize, heights, types: [] };
  const maxHeight = Math.max(...heights);
  const baseY = CONFIG.terrain.baseLine * size * cellSize;
  for (let i = 0; i < heights.length; i++) {
    const p = centre(i), grade = cellGrade(t, i % size, Math.floor(i / size));
    t.types[i] =
      p.y >= baseY && grade < 0.15 ? TerrainType.Base
      : grade > CONFIG.terrain.rockGrade ? TerrainType.Rock
      : heights[i]! < maxHeight * CONFIG.terrain.treelineFraction && forest(p) > 0.65 ? TerrainType.Forest
      : TerrainType.Snow;
  }
  return t;
}

/** Builds a terrain from a ready-made height grid (generated or real), one height per cell. */
export const terrainFromGrid = (grid: HeightGrid, forest?: (p: Vec2) => number): Terrain =>
  terrainFromHeights(grid.size, grid.cellSize, (p) => grid.h[Math.floor(p.y / grid.cellSize) * grid.size + Math.floor(p.x / grid.cellSize)]!, forest);

/** Smooth value noise in [0, 1] with lattice spacing `scale` metres. */
function valueNoise(rng: Rng, extent: number, scale: number): (x: number, y: number) => number {
  const n = Math.ceil(extent / scale) + 2;
  const lattice = Array.from({ length: n * n }, () => nextFloat(rng));
  const at = (x: number, y: number): number => lattice[clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1)]!;
  const smooth = (f: number): number => f * f * (3 - 2 * f);
  return (x, y) => {
    const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = smooth(gx - x0), fy = smooth(gy - y0);
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}

/**
 * A peak near the top of the map falling away to a flat base along the bottom edge.
 * Height grows as t^1.5 of the elliptical distance from the peak, so slopes are gentle near the base and
 * steepen toward the summit. Noise stretched along the fall line carves ridges and gullies.
 */
export function generateTerrain(seed: number): Terrain {
  const { size, cellSize, peakHeight, ridgeHeight, detailHeight, baseLine } = CONFIG.terrain;
  const rng = createRng(seed);
  const extent = size * cellSize;
  const peak = vec(extent * (0.35 + 0.3 * nextFloat(rng)), extent * (0.12 + 0.08 * nextFloat(rng)));
  const baseY = extent * baseLine;
  const ridges = valueNoise(rng, extent, 100);
  const detail = valueNoise(rng, extent, 50);
  const forest = valueNoise(rng, extent, 90);
  return terrainFromHeights(size, cellSize, (p) => {
    const dx = (p.x - peak.x) / extent;
    // The back side behind the peak is steeper than the front face.
    const dy = (p.y - peak.y) / (p.y < peak.y ? (baseY - peak.y) * 0.7 : baseY - peak.y);
    // Softening the distance near zero rounds off what would otherwise be a cone tip.
    const t = clamp((1 - Math.hypot(dx, dy, 0.1)) / 0.9, 0, 1);
    const apron = Math.max(0, p.y - baseY) * 0.03;
    return peakHeight * t ** 1.5 + ridgeHeight * t * (ridges(p.x, p.y * 0.3) - 0.5) + detailHeight * (0.1 + t) * (detail(p.x, p.y) - 0.5) - apron;
  }, (p) => forest(p.x, p.y));
}
