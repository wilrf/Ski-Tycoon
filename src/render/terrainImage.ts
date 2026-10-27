import { heightAt, TerrainType, terrainExtent, type Terrain } from '../sim/terrain';
import { vec } from '../sim/geometry';

const PIXELS_PER_CELL = 4;
const CONTOUR_INTERVAL = 20;
const INDEX_CONTOUR_EVERY = 5;

const COLORS: Record<TerrainType, readonly [number, number, number]> = {
  [TerrainType.Snow]: [246, 249, 253],
  [TerrainType.Forest]: [74, 112, 86],
  [TerrainType.Rock]: [150, 148, 150],
  [TerrainType.Base]: [226, 220, 205],
};

/** Cheap per-pixel hash in [0, 1) used to speckle forests into individual trees. */
const speckle = (x: number, y: number): number => (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 1000) / 1000;

/** The terrain type with the most bilinear weight at a pixel, which rounds off blocky cell edges. */
function smoothTypeAt(t: Terrain, gx: number, gy: number): TerrainType {
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const weights = [0, 0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
    const cx = Math.min(t.size - 1, Math.max(0, x0 + dx)), cy = Math.min(t.size - 1, Math.max(0, y0 + dy));
    weights[t.types[cy * t.size + cx]!]! += w;
  }
  return weights.indexOf(Math.max(...weights)) as TerrainType;
}

/**
 * Bakes the static mountain once: colour by terrain type, hillshade lit from the north-west so slopes read
 * as relief, and contour lines every 20 m (darker every 100 m) so steepness shows as line spacing.
 */
export function bakeTerrain(t: Terrain): HTMLCanvasElement {
  const n = t.size * PIXELS_PER_CELL;
  const metresPerPixel = terrainExtent(t) / n;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(n, n);
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = heightAt(t, vec(((i % n) + 0.5) * metresPerPixel, (Math.floor(i / n) + 0.5) * metresPerPixel));
  const h = (x: number, y: number): number => heights[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]!;
  const light = [-1, -1, 1.4].map((c) => c / Math.hypot(1, 1, 1.4));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) / (2 * metresPerPixel);
      const dy = (h(x, y + 1) - h(x, y - 1)) / (2 * metresPerPixel);
      const shade = (-dx * light[0]! - dy * light[1]! + light[2]!) / Math.hypot(dx, dy, 1);
      const type = smoothTypeAt(t, (x + 0.5) / PIXELS_PER_CELL - 0.5, (y + 0.5) / PIXELS_PER_CELL - 0.5);
      const tree = type === TerrainType.Forest && speckle(x, y) < 0.35 ? 0.75 : 1;
      const band = (v: number): number => Math.floor(v / CONTOUR_INTERVAL);
      const here = band(h(x, y));
      const contour = here !== band(h(x + 1, y)) || here !== band(h(x, y + 1));
      const index = contour && Math.max(here, band(h(x + 1, y)), band(h(x, y + 1))) % INDEX_CONTOUR_EVERY === 0;
      const line = index ? 0.7 : contour ? 0.86 : 1;
      const [r, g, b] = COLORS[type];
      const o = (y * n + x) * 4;
      // Shadows lean blue, as on real snow.
      image.data[o] = r * (0.55 + 0.45 * shade) * tree * line;
      image.data[o + 1] = g * (0.6 + 0.4 * shade) * tree * line;
      image.data[o + 2] = b * (0.75 + 0.25 * shade) * tree * line;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
