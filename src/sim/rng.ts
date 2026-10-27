/** Seeded RNG (mulberry32). The state is a plain number so it serializes with the world. */
export interface Rng {
  state: number;
}

export const createRng = (seed: number): Rng => ({ state: seed >>> 0 });

export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const nextRange = (rng: Rng, [min, max]: readonly [number, number]): number => min + (max - min) * nextFloat(rng);

/** Picks an item with probability proportional to its weight; undefined when nothing has positive weight. */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | undefined {
  const weights = items.map(weight);
  let roll = nextFloat(rng) * weights.reduce((a, b) => a + b, 0);
  let picked: T | undefined;
  for (let i = 0; i < items.length && roll >= 0; i++) {
    if (weights[i]! <= 0) continue;
    picked = items[i];
    roll -= weights[i]!;
  }
  return picked;
}
