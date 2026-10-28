/**
 * Builds the terrain viewer page: every range's generated mountains beside real faces from that range, and all
 * famous peaks, each as packed heights the page draws in 3D, from above, and as a side silhouette.
 *
 *   npx tsx tools/terrain-viewer/build.ts <out.html>
 *
 * Heights are packed as base64 little-endian uint16 decimetres above a minimum, the same format as the peak files.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PEAKS } from '../../src/data/peaks';
import { RANGE_PARAMS } from '../../src/data/rangeParams';
import { generateRangeGrid } from '../../src/sim/rangeTerrain';
import { RANGE_KEYS, RANGE_NAMES } from '../../src/sim/ranges';
import { createRng, nextFloat } from '../../src/sim/rng';
import { crop, readNpy } from '../terrain-fit/grids';
import { COLS, ROWS } from '../terrain-fit/stats';

const ROOT = join(import.meta.dirname, '../..');
const SEEDS = [1, 2];
const REAL_PER_RANGE = 3;

function pack(h: ArrayLike<number>): { min: number; b64: string } {
  let min = Infinity;
  for (let i = 0; i < h.length; i++) min = Math.min(min, h[i]!);
  const u = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) u[i] = Math.min(65535, Math.round((h[i]! - min) * 10));
  return { min: +min.toFixed(1), b64: Buffer.from(u.buffer).toString('base64') };
}

/** A few real faces from the range: above-median-relief windows the size of the game's face, picked at random. */
function realFaces(key: string): { w: number; h: number; cell: number; min: number; b64: string }[] {
  const dir = join(ROOT, 'tools/terrain-stats/cache', key);
  if (!existsSync(dir)) return [];
  const wins = readdirSync(dir).filter((f) => f.endsWith('.npy')).sort().flatMap((f) => {
    const tile = readNpy(join(dir, f));
    const out = [];
    for (let y = 0; y + ROWS <= tile.hgt; y += ROWS) for (let x = 0; x + COLS <= tile.w; x += COLS) out.push(crop(tile, x, y, COLS, ROWS));
    return out;
  });
  const relief = (z: Float64Array): number => Math.max(...z) - Math.min(...z);
  const median = wins.map((w) => relief(w.z)).sort((a, b) => a - b)[wins.length >> 1]!;
  const big = wins.filter((w) => relief(w.z) >= median);
  const rng = createRng(RANGE_KEYS.indexOf(key as never) + 101);
  return Array.from({ length: REAL_PER_RANGE }, () => big[Math.floor(nextFloat(rng) * big.length)]!).map((w) => ({ w: COLS, h: ROWS, cell: 30, ...pack(w.z) }));
}

const fitReport = JSON.parse(readFileSync(join(ROOT, 'tools/terrain-stats/results/fit-report.json'), 'utf8'));
const data = {
  ranges: RANGE_KEYS.map((key) => ({
    key, name: RANGE_NAMES[key], params: RANGE_PARAMS[key], fitLoss: fitReport[key]?.loss ?? null,
    mountains: SEEDS.map((seed) => {
      const g = generateRangeGrid(seed, RANGE_PARAMS[key]);
      return { seed, n: g.size, cell: g.cellSize, ...pack(g.h) };
    }),
    real: realFaces(key),
  })),
  peaks: PEAKS.map((p) => {
    const b = readFileSync(join(ROOT, 'public/terrain/peaks', `${p.id}.bin`));
    return { ...p, n: 160, cell: p.cellSize, min: p.minHeight, b64: b.toString('base64') };
  }),
};

const template = readFileSync(join(import.meta.dirname, 'template.html'), 'utf8');
const out = process.argv[2] ?? join(import.meta.dirname, 'terrain-viewer.html');
writeFileSync(out, template.replace('/*DATA*/null', JSON.stringify(data)));
console.log(`wrote ${out} (${(Buffer.byteLength(readFileSync(out)) / 1e6).toFixed(1)} MB)`);
