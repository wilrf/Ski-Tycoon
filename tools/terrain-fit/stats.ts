/**
 * Game-scale shape statistics, measured the same way on real elevation windows and on generated faces.
 * Both arrive as a grid at 30 m spacing covering the game's mountain face: 1.6 km across, 1.15 km down the slope.
 */
export const RES_M = 30;
export const COLS = 53;
export const ROWS = 38;

export interface Grid {
  readonly w: number;
  readonly hgt: number;
  readonly z: Float64Array;
}

export const STAT_NAMES = ['relief_m', 'slope_mean_deg', 'slope_p90_deg', 'frac_gt30', 'frac_gt45', 'upland_flat', 'fine_coarse', 'gully_per_km', 'crest_curv'] as const;
export type StatName = (typeof STAT_NAMES)[number];
export type Stats = Record<StatName, number>;

/** Separable Gaussian blur with mirrored edges. */
export function blur(g: Grid, sigma: number): Grid {
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const ksum = k.reduce((a, b) => a + b, 0);
  const mirror = (i: number, n: number): number => (i < 0 ? -i - 1 : i >= n ? 2 * n - i - 1 : i);
  const pass = (src: Float64Array, horizontal: boolean): Float64Array => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < g.hgt; y++)
      for (let x = 0; x < g.w; x++) {
        let s = 0;
        for (let t = -r; t <= r; t++) {
          const xx = horizontal ? mirror(x + t, g.w) : x, yy = horizontal ? y : mirror(y + t, g.hgt);
          s += k[t + r]! * src[yy * g.w + xx]!;
        }
        out[y * g.w + x] = s / ksum;
      }
    return out;
  };
  return { ...g, z: pass(pass(g.z, true), false) };
}

const quantile = (v: Float64Array | number[], q: number): number => {
  const s = Float64Array.from(v).sort();
  const pos = q * (s.length - 1), lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
};
const mean = (v: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]!;
  return s / v.length;
};
const std = (v: ArrayLike<number>): number => { const m = mean(v); return Math.sqrt(mean(Array.from(v, (x) => (x - m) ** 2))); };

export function slopes(g: Grid): Float64Array {
  const { w, hgt, z } = g;
  const at = (x: number, y: number): number => z[Math.min(hgt - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  return Float64Array.from({ length: w * hgt }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const gx = (at(x + 1, y) - at(x - 1, y)) / ((x === 0 || x === w - 1 ? 1 : 2) * RES_M);
    const gy = (at(x, y + 1) - at(x, y - 1)) / ((y === 0 || y === hgt - 1 ? 1 : 2) * RES_M);
    return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
  });
}

/** Sign changes per km of the 45-180 m band along rows and columns: how finely the ground is cut into gullies. */
function gullyCrossings(g: Grid): number {
  const a = blur(g, 1.5).z, b = blur(g, 6).z;
  const pos = (i: number): boolean => a[i]! - b[i]! > 0;
  let crossings = 0, steps = 0;
  for (let y = 0; y < g.hgt; y++) for (let x = 1; x < g.w; x++, steps++) if (pos(y * g.w + x) !== pos(y * g.w + x - 1)) crossings++;
  for (let y = 1; y < g.hgt; y++) for (let x = 0; x < g.w; x++, steps++) if (pos(y * g.w + x) !== pos((y - 1) * g.w + x)) crossings++;
  return crossings / ((steps * RES_M) / 1000);
}

export function measure(g: Grid): Stats {
  const s = slopes(g);
  const zHigh = quantile(g.z, 0.7);
  const high = Array.from(s).filter((_, i) => g.z[i]! > zHigh);
  const b1 = blur(g, 1).z, b3 = blur(g, 3).z, b8 = blur(g, 8).z;
  const fine = b1.map((v, i) => v - b3[i]!), coarse = b3.map((v, i) => v - b8[i]!);
  // Curvature of the lightly smoothed surface; the most convex 2% of cells are the crests.
  const curv = Float64Array.from({ length: g.z.length }, (_, i) => {
    const x = i % g.w, y = Math.floor(i / g.w);
    if (x === 0 || y === 0 || x === g.w - 1 || y === g.hgt - 1) return 0;
    return (b1[i - 1]! + b1[i + 1]! + b1[i - g.w]! + b1[i + g.w]! - 4 * b1[i]!) / RES_M ** 2;
  });
  return {
    relief_m: quantile(g.z, 0.98) - quantile(g.z, 0.02),
    slope_mean_deg: mean(s),
    slope_p90_deg: quantile(s, 0.9),
    frac_gt30: mean(s.map((v) => +(v > 30))),
    frac_gt45: mean(s.map((v) => +(v > 45))),
    upland_flat: mean(high.map((v) => +(v < 15))),
    fine_coarse: std(fine) / Math.max(std(coarse), 1e-6),
    gully_per_km: gullyCrossings(g),
    crest_curv: -quantile(curv, 0.02) * 1000,
  };
}
