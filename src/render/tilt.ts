import { vec } from '../sim/geometry';
import { heightAt, terrainExtent, TerrainType, type Terrain } from '../sim/terrain';
import { COS, SIN, type Camera, type View } from './camera';
import type { Tree } from './terrainArt';

/**
 * A picture of the map as the tilted camera sees it. `left` and `top` are in screen metres (world x, and the
 * lifted height of the picture's top row), `px` its pixels per metre, `horizon` the lifted height of the skyline.
 */
export interface Tilted {
  readonly canvas: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
  readonly px: number;
  readonly horizon: number;
}

/** The widest the bake gets, in pixels: big maps get fewer pixels per metre so phones keep their memory. */
const MAX_WIDTH = 2600;

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number, salt: number): number =>
  (((Math.imul(x ^ salt, 73856093) ^ Math.imul(y + salt * 31, 19349663)) >>> 0) % 10007) / 10007;
/** Smooth value noise in [0, 1] on a lattice `cell` units wide. */
function noise(x: number, y: number, cell: number, salt: number): number {
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (dx: number, dy: number): number => hash(x0 + dx, y0 + dy, salt);
  return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
}
const ridged = (x: number, y: number, cell: number, salt: number): number => 1 - Math.abs(2 * noise(x, y, cell, salt) - 1);
/** Four soft light bands: the cartoon look, without hard posterised edges. */
const band = (v: number): number => {
  const x = v * 4, i = Math.floor(x);
  return (i + smooth(0.4, 0.6, x - i)) / 4;
};

/**
 * First light: the sun just up in the east, gold on east faces and cold blue everywhere else, with mist pooled
 * in the valleys around the resort. Colours are measured off sunrise photos of alpine snow.
 */
export const SUNRISE = {
  sun: [1, 0.25, 0.7] as const,
  sunCol: hex('#ffc27a'),
  amb: hex('#7f92d6'),
  sky: ['#3b5fae', '#9fb0dc', '#ffd2a1'] as const,
  glow: '#ffe0a8',
  haze: hex('#f1d3c4'),
  mist: hex('#f3e6e4'),
  peakTint: hex('#ffb38a'),
  /** The sea of cloud filling the valleys below the resort. */
  cloud: '#fbe0d6',
};
const CLOUD = hex(SUNRISE.cloud);
const L = ((): [number, number, number] => {
  const [x, y, z] = SUNRISE.sun, l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
})();
const SUN_H = Math.hypot(L[0], L[1]), SUN_TAN = L[2] / SUN_H;
/** Ground relief is drawn a little steeper than life so slopes read at game zoom, as on painted trail maps. */
const EXAG = 1.3;

const SNOW: Rgb = [1, 1, 1];
const ROCK = hex('#6e625a'), ROCK_DARK = hex('#3e3a46');
/** The forest floor between the standing trees. */
const UNDERSTOREY = hex('#4f6658');

export interface TiltOptions {
  /** Metres of made-up land beyond each side and the back of the map, so it fades into the valleys instead of a cliff. */
  readonly pad: number;
  /** Lights the ground like the mockups (sun, cast shadows, haze, far ranges, outlines). Off, `src` is copied as is. */
  readonly shaded: boolean;
  /** Upright trees, each standing where its foot can be seen. */
  readonly trees?: readonly Tree[];
}

/**
 * Draws the map at the camera's tilt. Each column is painted from the back of the map to the front, so nearer
 * ground covers what is behind it. `src` is a square top-down picture of the map: shaded bakes use it only for the
 * base village; unshaded ones (the slope guide) copy it.
 */
export function tiltImage(src: HTMLCanvasElement, t: Terrain, { pad, shaded, trees = [] }: TiltOptions): Tilted {
  const extent = terrainExtent(t), n = src.width;
  const pixels = src.getContext('2d')!.getImageData(0, 0, n, n).data;
  let low = Infinity, high = -Infinity;
  for (const h of t.heights) {
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  const relief = Math.max(1, high - low);
  // Beyond the map the edge of the mountain falls away into low, rolling valley floor, so the resort's mountain
  // stands up out of its surroundings instead of ending in a cliff.
  const mirror = (v: number): number => Math.min(extent, Math.max(0, v));
  const outside = (x: number, y: number): number => Math.max(0, -x, x - extent, -y, y - extent);
  const cloudTop = (x: number, y: number): number => relief * 0.025 * noise(x, y, extent * 0.09, 12);
  const height = (x: number, y: number): number => {
    const edge = heightAt(t, vec(mirror(x), mirror(y))) - low, away = outside(x, y);
    if (away === 0) return edge;
    // A morning sea of cloud fills the valleys: the mountain's flanks drop into it, so the map has no edge to see.
    const ground = edge * (1 - smooth(0, extent * 0.06, away));
    return Math.max(ground, cloudTop(x, y));
  };

  const left = -pad, back = -pad, front = extent + pad * 0.4, span = extent + pad * 2;
  const px = Math.min(1, MAX_WIDTH / span);
  const width = Math.ceil(span * px);
  const horizon = back * SIN - height(extent / 2, back) * COS;
  const ridgeHigh = relief * 0.5;
  const top = back * SIN - (shaded ? ridgeHigh : relief) * COS - 20;
  const rows = Math.ceil((front * SIN - top + 10) * px);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, rows);
  const out = image.data;
  const depth = new Float32Array(width * rows).fill(-Infinity);
  const put = (i: number, c: Rgb, a = 1): void => {
    out[i * 4] = c[0] * 255;
    out[i * 4 + 1] = c[1] * 255;
    out[i * 4 + 2] = c[2] * 255;
    out[i * 4 + 3] = a * 255;
  };
  const rowOf = (lifted: number): number => (lifted - top) * px;
  const srcAt = (x: number, y: number): Rgb => {
    const sx = Math.min(n - 1, Math.max(0, Math.floor((mirror(x) / extent) * n)));
    const sy = Math.min(n - 1, Math.max(0, Math.floor((mirror(y) / extent) * n)));
    const k = (sy * n + sx) * 4;
    return [pixels[k]! / 255, pixels[k + 1]! / 255, pixels[k + 2]! / 255];
  };

  const light = shaded ? lightField(height, left, back, span, front - back, extent) : null;
  // Patterns keep their size on the ground whatever the map's scale.
  const s = extent / 1600;
  const groundColour = (x: number, y: number, h: number): Rgb => {
    if (!light) return srcAt(x, y);
    const f = light(x, y);
    const direct = band(clamp01(f.lam * f.lit * 1.6));
    const rock = smooth(0, 0.3, f.steep + (noise(x * 2.2, y * 0.5, 30 * s, 4) - 0.5) * 0.1 - 0.75);
    let alb: Rgb = rock > 0 ? mix(SNOW, mix(ROCK_DARK, ROCK, noise(x * 0.06, h * 0.45, 3 * s, 7)), rock) : SNOW;
    const inside = outside(x, y) === 0;
    const type = inside ? t.types[Math.min(t.size - 1, Math.floor(y / t.cellSize)) * t.size + Math.min(t.size - 1, Math.floor(x / t.cellSize))] : null;
    if (type === TerrainType.Forest) alb = mix(alb, UNDERSTOREY, 0.55);
    let c = mul(alb, [SUNRISE.amb[0] * f.sky + SUNRISE.sunCol[0] * direct * 1.05, SUNRISE.amb[1] * f.sky + SUNRISE.sunCol[1] * direct * 1.05, SUNRISE.amb[2] * f.sky + SUNRISE.sunCol[2] * direct * 1.05]);
    // The summits catch the first warm light.
    const alt = h / relief;
    c = mix(c, mul(c, [SUNRISE.peakTint[0] + 0.15, SUNRISE.peakTint[1] + 0.15, SUNRISE.peakTint[2] + 0.15]), 0.35 * alt * alt * direct);
    // The base village keeps its buildings and car park, in the same morning light.
    if (type === TerrainType.Base) c = mix(c, mul(srcAt(x, y), [1.02, 0.96, 0.92]), 0.55);
    // Cloud tops take the sunrise colour; land sinking into them fades out.
    const away = outside(x, y);
    if (away > 0) c = mix(c, CLOUD, 0.55);
    const far = Math.pow(clamp01((extent * 0.2 - y) / (extent * 0.2 + pad)), 1.3);
    return away > 0 ? c : mix(c, SUNRISE.haze, far * 0.45);
  };

  for (let col = 0; col < width; col++) {
    const x = left + (col + 0.5) / px;
    if (shaded) paintSkyline(x, col);
    let prev = rowOf(back * SIN - height(x, back) * COS);
    for (let y = back; y <= front; y += 1 / px) {
      const h = height(x, y);
      const row = rowOf(y * SIN - h * COS);
      const r0 = Math.max(0, Math.floor(Math.min(prev, row))), r1 = Math.min(rows, Math.ceil(Math.max(prev, row)));
      if (r1 > r0) {
        const c = groundColour(x, y, h);
        // Past the map the land sinks into the cloud sea, which the renderer paints under the whole view.
        const a = shaded ? 1 - smooth(0, extent * 0.05, outside(x, y)) : 1;
        for (let r = r0; r < r1; r++) {
          put(r * width + col, c, a);
          depth[r * width + col] = y;
        }
      }
      prev = row;
    }
    if (!shaded) continue;
    // A soft dark line wherever a ridge hides land well behind it: the cartoon outline that shapes the mountain.
    for (let r = 1; r < rows; r++) {
      const i = r * width + col, above = depth[i - width]!;
      if (above === -Infinity || depth[i]! - above < 40 * s) continue;
      for (const [j, w] of [[i, 0.55], [i + width, 0.25]] as const) {
        if (j >= width * rows) continue;
        const c: Rgb = [out[j * 4]! / 255, out[j * 4 + 1]! / 255, out[j * 4 + 2]! / 255];
        put(j, mix(c, mul(c, SUNRISE.amb), w));
      }
    }
  }
  ctx.putImageData(image, 0, 0);

  // Far ranges on the skyline: each peak splits into a sunlit east facet and a shaded west one along its crest,
  // with gullies streaking down, fading into the morning haze. Painted before the map, which then covers them.
  function paintSkyline(x: number, col: number): void {
    const base = rowOf(horizon) + 2;
    for (const layer of [{ h: ridgeHigh, cell: 900 * s, salt: 31, fade: 0.55 }, { h: ridgeHigh * 0.7, cell: 520 * s, salt: 47, fade: 0.32 }]) {
      const crest = (u: number): number =>
        layer.h * (0.25 + 0.75 * Math.pow(ridged(u, layer.salt * 50, layer.cell, layer.salt), 1.6) * (0.6 + 0.4 * noise(u, 0, layer.cell * 2.3, layer.salt + 1))) +
        0.08 * layer.h * ridged(u, 9, layer.cell / 5, layer.salt + 2);
      const r = crest(x), peak = rowOf(horizon - r * COS);
      const span2 = layer.cell * 0.12, slope = (crest(x + span2) - crest(x - span2)) / (2 * span2);
      for (let row = Math.max(0, Math.floor(peak)); row < Math.min(rows, base); row++) {
        const alt = 1 - (row - peak) / Math.max(1, base - peak);
        const gully = (ridged(x + ((row - peak) / px) * 0.5 * Math.sign(slope || 1), row / px, 45 * s, layer.salt + 4) - 0.5) * 0.5;
        const facing = smooth(-0.08, 0.08, -L[0] * slope + gully * 0.15);
        let c = mul(SNOW, [SUNRISE.amb[0] + SUNRISE.sunCol[0] * (0.15 + 0.75 * facing), SUNRISE.amb[1] + SUNRISE.sunCol[1] * (0.15 + 0.75 * facing), SUNRISE.amb[2] + SUNRISE.sunCol[2] * (0.15 + 0.75 * facing)]);
        c = mix(c, SUNRISE.peakTint, 0.35 * alt * facing);
        put(row * width + col, mix(c, SUNRISE.haze, layer.fade + (1 - alt) * 0.3));
      }
    }
  }

  // Trees stand up out of the slope, lit from the east, with a short shadow away from the sun.
  for (const tree of trees) {
    const lifted = tree.y * SIN - height(tree.x, tree.y) * COS;
    const col = Math.round((tree.x - left) * px), row = Math.round(rowOf(lifted));
    if (col < 0 || col >= width || row < 1 || row >= rows) continue;
    if (Math.abs(depth[(row - 1) * width + col]! - tree.y) > 14) continue;
    const tall = Math.max(2, tree.height * 1.4 * COS * px), half = Math.max(1, tree.height * 0.32 * px);
    const sunlit = light ? light(tree.x, tree.y).lit : 1;
    ctx.fillStyle = 'rgba(40, 50, 100, 0.3)';
    ctx.beginPath();
    ctx.ellipse(col - half * 1.2, row, half * 1.6, half * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sunlit > 0.5 ? '#203a3a' : '#1b2c3a';
    ctx.beginPath();
    ctx.moveTo(col, row - tall);
    ctx.lineTo(col + half, row);
    ctx.lineTo(col - half, row);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = sunlit > 0.5 ? '#6f7a4c' : '#2c4550';
    ctx.beginPath();
    ctx.moveTo(col, row - tall);
    ctx.lineTo(col + half, row);
    ctx.lineTo(col, row);
    ctx.closePath();
    ctx.fill();
  }
  return { canvas, left, top, px, horizon };
}

interface LightSample {
  /** Unshadowed sunlight on the slope, 0 to 1. */
  lam: number;
  /** 1 in sun, 0 in the shadow of higher ground toward the sun. */
  lit: number;
  /** How much open sky the spot sees: hollows get less. */
  sky: number;
  /** True steepness (rise over run). */
  steep: number;
}

/**
 * Sun, cast shadow and sky light worked out once on a grid over the whole bake, then read with bilinear blending.
 * Cast shadows march toward the sun and compare the steepest rise with the sun's elevation.
 */
function lightField(height: (x: number, y: number) => number, x0: number, y0: number, w: number, h: number, extent: number): (x: number, y: number) => LightSample {
  const step = extent / 320, cols = Math.ceil(w / step) + 2, rowsN = Math.ceil(h / step) + 2;
  const lam = new Float32Array(cols * rowsN), lit = new Float32Array(cols * rowsN), sky = new Float32Array(cols * rowsN), steep = new Float32Array(cols * rowsN);
  const ux = L[0] / SUN_H, uy = L[1] / SUN_H, d = step;
  for (let j = 0; j < rowsN; j++) {
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * step, y = y0 + j * step, h0 = height(x, y);
      const dx = (height(x + d, y) - height(x - d, y)) / (2 * d), dy = (height(x, y + d) - height(x, y - d)) / (2 * d);
      const ex = dx * EXAG, ey = dy * EXAG, nl = Math.hypot(ex, ey, 1);
      const k = j * cols + i;
      lam[k] = Math.max(0, (-ex * L[0] - ey * L[1] + L[2]) / nl);
      steep[k] = Math.hypot(dx, dy);
      const around = (height(x + d * 4, y) + height(x - d * 4, y) + height(x, y + d * 4) + height(x, y - d * 4)) / 4;
      sky[k] = 0.75 + 0.25 / nl - clamp01((around - h0) / (extent * 0.04)) * 0.25;
      let best = -9;
      for (let r = step; r < extent * 1.2; r *= 1.08) best = Math.max(best, ((height(x + ux * r, y + uy * r) - h0) * EXAG) / r);
      lit[k] = 1 - smooth(SUN_TAN - 0.04, SUN_TAN + 0.04, best);
    }
  }
  return (x, y) => {
    const gx = Math.min(cols - 1.001, Math.max(0, (x - x0) / step)), gy = Math.min(rowsN - 1.001, Math.max(0, (y - y0) / step));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, k = j * cols + i;
    const at = (a: Float32Array): number => (a[k]! * (1 - fx) + a[k + 1]! * fx) * (1 - fy) + (a[k + cols]! * (1 - fx) + a[k + cols + 1]! * fx) * fy;
    return { lam: at(lam), lit: at(lit), sky: at(sky), steep: at(steep) };
  };
}

/** Pastes a tilted bake where the camera sees it. */
export function drawTilted(ctx: CanvasRenderingContext2D, tilted: Tilted, camera: Camera, view: View): void {
  const x = (tilted.left - camera.x) * camera.zoom + view.width / 2;
  const y = (tilted.top - camera.y * SIN) * camera.zoom + view.height / 2;
  ctx.drawImage(tilted.canvas, x, y, (tilted.canvas.width / tilted.px) * camera.zoom, (tilted.canvas.height / tilted.px) * camera.zoom);
}
