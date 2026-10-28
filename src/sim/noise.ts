import { createRng, nextFloat } from './rng';

export type Noise2 = (x: number, y: number) => number;

/** Seeded 2D gradient (Perlin) noise in roughly [-1, 1] with unit lattice spacing. */
export function gradientNoise(seed: number): Noise2 {
  const rng = createRng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  const p = Uint8Array.from([...perm, ...perm]);
  const gx = Float64Array.from({ length: 256 }, (_, i) => Math.cos((i / 256) * 2 * Math.PI));
  const gy = Float64Array.from({ length: 256 }, (_, i) => Math.sin((i / 256) * 2 * Math.PI));
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h: number, x: number, y: number): number => gx[h]! * x + gy[h]! * y;
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0, u = fade(fx), v = fade(fy);
    const xi = x0 & 255, yi = y0 & 255;
    const h = (dx: number, dy: number): number => p[p[xi + dx]! + yi + dy]!;
    const n00 = dot(h(0, 0), fx, fy), n10 = dot(h(1, 0), fx - 1, fy), n01 = dot(h(0, 1), fx, fy - 1);
    const a = n00 + u * (n10 - n00), b = n01 + u * (dot(h(1, 1), fx - 1, fy - 1) - n01);
    return (a + v * (b - a)) * Math.SQRT2;
  };
}

/**
 * Fractal sum of octaves. `gain` sets how fast amplitude falls per octave: higher gain keeps more small-scale
 * roughness. `ridged` blends in folded noise, 1 - |n|, which turns soft hills into sharp crests.
 */
export function fractal(noise: Noise2, octaves: number, gain: number, ridged = 0): Noise2 {
  return (x, y) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = noise(x * freq + o * 17.3, y * freq - o * 31.7);
      sum += amp * ((1 - ridged) * n + ridged * (1 - 2 * Math.abs(n)));
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  };
}
