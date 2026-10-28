import { CONFIG } from '../config';
import { vec, type Vec2 } from '../sim/geometry';
import { heightAt, TerrainType, terrainExtent, type Terrain } from '../sim/terrain';
import type { Resort } from '../sim/world';
import { tiltImage, type Tilted } from './tilt';

const PIXELS_PER_CELL = 8;
const CONTOUR_INTERVAL = 20;
const INDEX_CONTOUR_EVERY = 5;
/** Exaggerates relief in the hillshade so gentle slopes still read. */
const RELIEF = 1.7;

type Rgb = readonly [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Lit and shadowed colour of each surface. Snow shadows are cool blue from the open sky, as in real snow. */
const SNOW = { light: [253, 254, 255], shadow: [146, 165, 204] } as const;
const PALETTE: Record<TerrainType, { light: Rgb; shadow: Rgb }> = {
  [TerrainType.Snow]: SNOW,
  [TerrainType.Forest]: { light: [232, 238, 244], shadow: [128, 146, 186] },
  [TerrainType.Rock]: SNOW,
  [TerrainType.Base]: { light: [247, 245, 240], shadow: [168, 174, 198] },
};
const ROCK = { light: [134, 126, 118], shadow: [52, 52, 62] } as const;

/** Deterministic hash in [0, 1) for scattering trees and texture. */
const hash = (x: number, y: number, salt = 0): number =>
  (((Math.imul(x ^ salt, 73856093) ^ Math.imul(y + salt, 19349663)) >>> 0) % 10007) / 10007;

/** Bilinear weight of each terrain type at a cell-space point, so colours blend across cell edges. */
function typeWeights(t: Terrain, gx: number, gy: number): number[] {
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const weights = [0, 0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
    const cx = Math.min(t.size - 1, Math.max(0, x0 + dx)), cy = Math.min(t.size - 1, Math.max(0, y0 + dy));
    weights[t.types[cy * t.size + cx]!]! += w;
  }
  return weights;
}

export interface Tree {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** The baked mountain: the ground seen from above, where its trees stand, and the tilted view of both. */
export interface TerrainArt {
  readonly ground: HTMLCanvasElement;
  /** Sorted north to south, so drawing in order overlaps correctly. */
  readonly trees: readonly Tree[];
  /** The mountain as the tilted camera sees it, with standing trees and far ranges on the skyline. */
  readonly tilted: Tilted;
}

/**
 * Bakes the static mountain once, in the style of a painted trail map: hillshaded snow with blue shadows,
 * streaked rock, individual pine trees, faint contours every 20 m, and the base village.
 */
export function bakeTerrain({ terrain: t, entrance }: Pick<Resort, 'terrain' | 'entrance'>): TerrainArt {
  const n = t.size * PIXELS_PER_CELL;
  const scale = n / terrainExtent(t);
  const canvas = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    return [c, c.getContext('2d')!];
  };
  const [ground, ctx] = canvas();
  paintGround(ctx, t, n);
  ctx.scale(scale, scale);
  drawBase(ctx, entrance);
  const trees = plantTrees(t, entrance);
  return { ground, trees, tilted: tiltImage(ground, t, { pad: terrainExtent(t) * 0.4, shaded: true, trees }) };
}

/** Smooth noise in [0, 1] on a lattice `cell` pixels wide, built from the hash so it needs no state. */
function smoothNoise(x: number, y: number, cell: number, salt: number): number {
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (dx: number, dy: number): number => hash(x0 + dx, y0 + dy, salt);
  return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
}

function paintGround(ctx: CanvasRenderingContext2D, t: Terrain, n: number): void {
  const metresPerPixel = terrainExtent(t) / n;
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = heightAt(t, vec(((i % n) + 0.5) * metresPerPixel, (Math.floor(i / n) + 0.5) * metresPerPixel));
  const h = (x: number, y: number): number => heights[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]!;
  const light = [-1, -1.2, 2].map((c) => c / Math.hypot(1, 1.2, 2));
  const band = (v: number): number => Math.floor(v / CONTOUR_INTERVAL);
  /** Slope vector over a stencil of s pixels; wide stencils give broad light, narrow ones detail. */
  const slope = (x: number, y: number, s: number): [number, number] => [
    (h(x + s, y) - h(x - s, y)) / (2 * s * metresPerPixel),
    (h(x, y + s) - h(x, y - s)) / (2 * s * metresPerPixel),
  ];
  const lambert = ([dx, dy]: [number, number]): number =>
    Math.max(0, (-RELIEF * dx * light[0]! - RELIEF * dy * light[1]! + light[2]!) / Math.hypot(RELIEF * dx, RELIEF * dy, 1));
  const image = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const broad = slope(x, y, PIXELS_PER_CELL), fine = slope(x, y, 2);
      // Snow drifts, wind texture and grain keep large slopes from looking like plastic.
      const drift = smoothNoise(x, y, 24, 1) - 0.5, grain = hash(x, y, 3) - 0.5;
      const shade = Math.min(1, 1.12 * (0.7 * lambert(broad) + 0.3 * lambert(fine)) + drift * 0.08);
      // Gullies (where the surface curves up on both sides) collect shadow; ridges catch light.
      const s = PIXELS_PER_CELL * 2;
      const curvature = (h(x + s, y) + h(x - s, y) + h(x, y + s) + h(x, y - s) - 4 * h(x, y)) / (s * metresPerPixel);
      const weights = typeWeights(t, (x + 0.5) / PIXELS_PER_CELL - 0.5, (y + 0.5) / PIXELS_PER_CELL - 0.5);
      let color: Rgb = [0, 0, 0];
      weights.forEach((w, type) => {
        const { light: lit, shadow } = PALETTE[type as TerrainType];
        const c = mix(shadow, lit, shade);
        color = [color[0] + c[0] * w, color[1] + c[1] * w, color[2] + c[2] * w];
      });
      color = mix(color, SNOW.shadow, Math.min(0.35, Math.max(0, curvature * 0.9)));
      // Rock shows where this pixel's own slope is too steep to hold snow; noise roughens the edges.
      // Steepness over a few cells, not single pixels, so real-world heightmap noise doesn't speckle the rock.
      const steep = Math.hypot(fine[0] * 0.35 + broad[0] * 0.65, fine[1] * 0.35 + broad[1] * 0.65) + (smoothNoise(x, y * 0.25, 9, 2) - 0.5) * 0.22;
      // Rock fades in over a band of steepness, streaked down the fall line the way snow sheds off real faces.
      const rock = Math.min(1, Math.max(0, (steep - CONFIG.terrain.rockGrade) / 0.3));
      if (rock > 0) {
        const rockShade = Math.min(1, lambert(fine) * 1.1 + (smoothNoise(x, y, 10, 4) - 0.5) * 0.25);
        // Snow still clings to ledges in the rock.
        const dusting = Math.max(0, smoothNoise(x, y, 12, 5) - 0.55) * 2.5;
        color = mix(color, mix(mix(ROCK.shadow, ROCK.light, rockShade), color, dusting), rock);
      }
      color = mix(color, [0, 0, 0], grain * 0.035);
      const here = band(h(x, y));
      const contour = here !== band(h(x + 1, y)) || here !== band(h(x, y + 1));
      const index = contour && Math.max(here, band(h(x + 1, y)), band(h(x, y + 1))) % INDEX_CONTOUR_EVERY === 0;
      if (contour) color = mix(color, [80, 100, 150], index ? 0.14 : 0.06);
      image.data.set([color[0], color[1], color[2], 255], (y * n + x) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Scatters pines through forest cells, and a few strays along forest edges so the treeline looks natural. */
function plantTrees(t: Terrain, entrance: Vec2): Tree[] {
  const isForest = (cx: number, cy: number): boolean => t.types[Math.min(t.size - 1, Math.max(0, cy)) * t.size + Math.min(t.size - 1, Math.max(0, cx))] === TerrainType.Forest;
  const trees: Tree[] = [];
  for (let cy = 0; cy < t.size; cy++) {
    for (let cx = 0; cx < t.size; cx++) {
      const edge = !isForest(cx, cy) && t.types[cy * t.size + cx] === TerrainType.Snow && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isForest(cx + dx!, cy + dy!));
      const count = isForest(cx, cy) ? 5 : edge && hash(cx, cy, 7) < 0.5 ? 2 : 0;
      for (let i = 0; i < count; i++) {
        trees.push({ x: (cx + hash(cx, cy, i * 2 + 1)) * t.cellSize, y: (cy + hash(cx, cy, i * 2 + 2)) * t.cellSize, height: 8 + hash(cx, cy, i + 9) * 6 });
      }
    }
  }
  // Spruce stands either side of the village.
  for (let i = 0; i < 160; i++) {
    const x = entrance.x + (hash(i, 21) < 0.5 ? -1 : 1) * (250 + hash(i, 22) * 220), y = entrance.y - 4 - hash(i, 23) * 120;
    trees.push({ x, y, height: 8 + hash(i, 24) * 6 });
  }
  return trees.sort((a, b) => a.y - b.y);
}

/** The trampled paths from the parking lot to the two big lodges, as quadratic curves: start, bend, end. */
export const footpaths = (entrance: Vec2): [Vec2, Vec2, Vec2][] =>
  ([[-160, -30], [155, -28]] as const).map(([x, y]) => [
    vec(entrance.x + x * 0.3, entrance.y - 10),
    vec(entrance.x + x * 0.6, entrance.y + y * 0.3),
    vec(entrance.x + x, entrance.y + y),
  ]);

/** The base village: a plowed parking lot along the bottom edge and lodges with snow on their roofs. */
function drawBase(ctx: CanvasRenderingContext2D, entrance: Vec2): void {
  const lot = { x: entrance.x - 110, y: entrance.y - 9, w: 220, h: 24 };
  ctx.fillStyle = '#e9edf3';
  ctx.fillRect(lot.x - 3, lot.y - 3, lot.w + 6, lot.h + 6);
  ctx.fillStyle = '#6c7078';
  ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
  const cars = ['#b23a48', '#e0a43a', '#1d6f80', '#2c4f7c', '#d9dde3', '#2b2d31', '#5d6b78'];
  for (let i = 0; i < 52; i++) {
    if (hash(i, 11) < 0.3) continue;
    const x = lot.x + 3 + (i % 26) * 8.3, y = lot.y + (i < 26 ? 2 : 14);
    ctx.fillStyle = cars[Math.floor(hash(i, 5) * cars.length)]!;
    ctx.fillRect(x, y, 4.4, 7.5);
    ctx.fillStyle = 'rgba(20, 28, 40, 0.6)';
    ctx.fillRect(x + 0.6, y + (i < 26 ? 4.6 : 1.4), 3.2, 1.5);
  }
  // Trampled footpaths from the lot to the lodges.
  ctx.strokeStyle = 'rgba(150, 150, 165, 0.25)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  for (const [from, via, to] of footpaths(entrance)) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(via.x, via.y, to.x, to.y);
    ctx.stroke();
  }
  lodge(ctx, vec(entrance.x - 160, entrance.y - 44), 52, 28);
  lodge(ctx, vec(entrance.x + 155, entrance.y - 38), 34, 20);
  lodge(ctx, vec(entrance.x - 215, entrance.y - 18), 20, 14);
  lodge(ctx, vec(entrance.x + 200, entrance.y - 14), 18, 12);

}

/** A lodge from above: a dark pitched roof carrying snow, the sunny south slope barer, and a timber deck. */
function lodge(ctx: CanvasRenderingContext2D, c: Vec2, w: number, d: number): void {
  const left = c.x - w / 2, top = c.y - d / 2;
  ctx.fillStyle = 'rgba(38, 52, 92, 0.35)';
  ctx.beginPath();
  ctx.moveTo(left + w, top);
  ctx.lineTo(left + w + 9, top + 9);
  ctx.lineTo(left + w + 9, top + d + 9);
  ctx.lineTo(left + 9, top + d + 9);
  ctx.lineTo(left, top + d);
  ctx.fill();
  ctx.fillStyle = '#8a6a4f';
  ctx.fillRect(left + w * 0.15, top + d, w * 0.7, 6);
  ctx.fillStyle = '#6e5340';
  for (let x = left + w * 0.15; x < left + w * 0.85; x += 1.6) ctx.fillRect(x, top + d, 0.4, 6);
  ctx.fillStyle = '#3d4250';
  ctx.fillRect(left, top, w, d);
  // Snow lies thick on the shaded north slope and in patches on the south slope.
  ctx.fillStyle = '#d7deea';
  ctx.fillRect(left + 0.8, top + 0.8, w - 1.6, d / 2 - 1.2);
  ctx.fillStyle = '#f7f9fd';
  for (let i = 0; i < 6; i++) ctx.fillRect(left + 1 + (w - 6) * hash(i, Math.round(c.x), 1), c.y + 0.6, 4 + 6 * hash(i, 2, 2), d / 2 - 1.6 - hash(i, 3, 3) * 3);
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(left, c.y - 0.5, w, 1);
  ctx.fillStyle = '#9a8f88';
  ctx.fillRect(left + w * 0.72, top + d * 0.18, 2.6, 2.6);
}
