import type { PeakEntry } from '../data/peaks';
import { CONFIG } from '../config';
import { fractal, gradientNoise } from './noise';
import { terrainFromGrid, type Terrain } from './terrain';

/** A real peak's terrain from its packed heightmap: little-endian uint16 decimetres above the entry's minHeight. */
export function peakTerrain(entry: PeakEntry, packed: ArrayBuffer, seed: number): Terrain {
  const size = CONFIG.terrain.size;
  const view = new DataView(packed);
  if (view.byteLength !== size * size * 2) throw new Error(`${entry.name}: expected ${size * size * 2} bytes, got ${view.byteLength}`);
  const h = Float64Array.from({ length: size * size }, (_, i) => entry.minHeight + view.getUint16(i * 2, true) / 10);
  const forest = fractal(gradientNoise(seed ^ 0xf0), 2, 0.5);
  // Forest patches keep the same size on the ground whatever the map's cell size.
  return terrainFromGrid({ size, cellSize: entry.cellSize, h }, (p) => 0.5 + 0.5 * forest(p.x / 90, p.y / 90));
}
