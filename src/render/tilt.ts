import { vec } from '../sim/geometry';
import { heightAt, terrainExtent, type Terrain } from '../sim/terrain';
import { COS, SIN, type Camera, type View } from './camera';
import type { Tree } from './terrainArt';

/** A top-down picture of the map redrawn as seen at the camera's tilt. `left` and `top` are in screen metres. */
export interface Tilted {
  readonly canvas: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
}

/** Pixels per metre of the tilted bake. More would blur less close up but costs memory on phones. */
const PX = 1;

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const hash = (x: number, salt: number): number => (((Math.imul(x ^ salt, 73856093) ^ Math.imul(salt + 7, 19349663)) >>> 0) % 10007) / 10007;
/** Smooth 1D noise in [0, 1] on a lattice `cell` units wide. */
const noise1 = (x: number, cell: number, salt: number): number => {
  const g = x / cell, i = Math.floor(g), f = g - i, s = f * f * (3 - 2 * f);
  return hash(i, salt) * (1 - s) + hash(i + 1, salt) * s;
};

/** Far ridges and the valley haze fade toward the sky's horizon colour, as distant mountains do. */
const HAZE: Rgb = [196, 216, 238];
const RIDGE_LIT: Rgb = [244, 247, 252], RIDGE_SHADE: Rgb = [128, 152, 198];

export interface TiltOptions {
  /** Metres of hazy, made-up land painted beyond each side and the back of the map, so it doesn't end in a cliff. */
  readonly pad: number;
  /** Painted mountain ranges on the skyline behind the map, and outlines where a ridge hides the land behind it. */
  readonly scenery: boolean;
  /** Upright trees, each standing where its foot can be seen. */
  readonly trees?: readonly Tree[];
}

/**
 * Redraws a top-down picture of the map (`src`, square, covering the whole map) at the camera's tilt. Each column
 * is painted from the back of the map to the front, so nearer ground covers what is behind it.
 */
export function tiltImage(src: HTMLCanvasElement, t: Terrain, { pad, scenery, trees = [] }: TiltOptions): Tilted {
  const extent = terrainExtent(t), n = src.width;
  const pixels = src.getContext('2d')!.getImageData(0, 0, n, n).data;
  let low = Infinity, high = -Infinity;
  for (const h of t.heights) {
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  const relief = high - low;
  // Beyond the map the land mirrors back on itself and sinks away, like the valleys around a real resort.
  const mirror = (v: number): number => (v < 0 ? -v : v > extent ? 2 * extent - v : v);
  const outside = (x: number, y: number): number => Math.max(0, -x, x - extent, -y, y - extent);
  const height = (x: number, y: number): number => (heightAt(t, vec(mirror(x), mirror(y))) - low) * Math.exp(-outside(x, y) / 700);

  const left = -pad, width = Math.ceil((extent + pad * 2) * PX);
  const back = -pad;
  // Skyline ranges rise from just behind the back of the map to a little above the mountain's own top.
  // Folded noise at three scales gives sharp summits and notched cols rather than rolling hills.
  const fold = (x: number, cell: number, salt: number): number => 1 - Math.abs(noise1(x, cell, salt) - 0.5) * 2;
  const ridge = (x: number): number =>
    relief * (0.35 + 0.7 * fold(x, 520, 3) * (0.55 + 0.45 * noise1(x, 1500, 4)) + 0.2 * fold(x, 190, 5)) + 60;
  const front = extent + pad * 0.4;
  const top = back * SIN - (scenery ? relief * 1.35 + 120 : relief) * COS - 20;
  const rows = Math.ceil((front * SIN - top + 10) * PX);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, rows);
  const out = image.data;
  const depth = new Float32Array(width * rows).fill(-Infinity);
  const put = (i: number, c: Rgb, a = 255): void => {
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = a;
  };
  const rowOf = (lifted: number): number => (lifted - top) * PX;

  for (let col = 0; col < width; col++) {
    const x = left + (col + 0.5) / PX;
    if (scenery) {
      // Each far peak has a sunlit west face and a shaded east face, split along its crest.
      const crest = ridge(x), lean = ridge(x + 30) - ridge(x - 30);
      const base = rowOf(back * SIN - height(x, back) * COS), peak = rowOf(back * SIN - crest * COS);
      const facet = mix(lean > 0 ? RIDGE_LIT : RIDGE_SHADE, HAZE, 0.25);
      for (let r = Math.max(0, Math.floor(peak)); r < Math.min(rows, Math.ceil(base) + 2); r++) {
        put(r * width + col, mix(facet, HAZE, clamp01((r - peak) / (base - peak + 1)) * 0.6));
      }
    }
    let prev = rowOf(back * SIN - height(x, back) * COS);
    for (let y = back; y <= front; y += 1 / PX) {
      const h = height(x, y);
      const row = rowOf(y * SIN - h * COS);
      const sx = Math.min(n - 1, Math.max(0, Math.floor((mirror(x) / extent) * n)));
      const sy = Math.min(n - 1, Math.max(0, Math.floor((mirror(y) / extent) * n)));
      const k = (sy * n + sx) * 4;
      let c: Rgb = [pixels[k]!, pixels[k + 1]!, pixels[k + 2]!];
      // Aerial perspective: land further back and off the map fades toward the horizon.
      c = mix(c, HAZE, clamp01(outside(x, y) / 500) * 0.55 + (1 - (y - back) / (extent - back)) * 0.12);
      for (let r = Math.max(0, Math.floor(Math.min(prev, row))); r < Math.min(rows, Math.ceil(Math.max(prev, row))); r++) {
        put(r * width + col, c);
        depth[r * width + col] = y;
      }
      prev = row;
    }
    if (scenery) {
      // A soft dark line along any ridge that hides land well behind it: the cartoon outline that shapes the mountain.
      for (let r = 1; r < rows; r++) {
        const i = r * width + col, above = depth[i - width]!;
        if (depth[i]! - above > 40 && above > -Infinity) {
          for (const [j, w] of [[i, 0.35], [i + width, 0.15]] as const) {
            if (j < width * rows) put(j, mix([out[j * 4]!, out[j * 4 + 1]!, out[j * 4 + 2]!], [40, 50, 80], w));
          }
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);

  // Trees stand up out of the slope, lit from the west with a short shadow to the east.
  for (const tree of trees) {
    const lifted = tree.y * SIN - height(tree.x, tree.y) * COS;
    const col = Math.round((tree.x - left) * PX), row = Math.round(rowOf(lifted));
    if (col < 0 || col >= width || row < 1 || row >= rows) continue;
    if (Math.abs(depth[(row - 1) * width + col]! - tree.y) > 14) continue;
    const tall = tree.height * 1.4 * COS * PX, half = tree.height * 0.32 * PX;
    ctx.fillStyle = 'rgba(30, 45, 80, 0.28)';
    ctx.beginPath();
    ctx.ellipse(col + half * 0.9, row, half * 1.3, half * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f3d2e';
    ctx.beginPath();
    ctx.moveTo(col, row - tall);
    ctx.lineTo(col + half, row);
    ctx.lineTo(col - half, row);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3c6b48';
    ctx.beginPath();
    ctx.moveTo(col, row - tall);
    ctx.lineTo(col, row);
    ctx.lineTo(col - half, row);
    ctx.closePath();
    ctx.fill();
  }
  return { canvas, left, top };
}

/** Pastes a tilted bake where the camera sees it. */
export function drawTilted(ctx: CanvasRenderingContext2D, tilted: Tilted, camera: Camera, view: View): void {
  const x = (tilted.left - camera.x) * camera.zoom + view.width / 2;
  const y = (tilted.top - camera.y * SIN) * camera.zoom + view.height / 2;
  ctx.drawImage(tilted.canvas, x, y, (tilted.canvas.width / PX) * camera.zoom, (tilted.canvas.height / PX) * camera.zoom);
}
