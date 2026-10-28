/**
 * Target shape statistics per range at game scale. Each cached 10 km tile is cut into face-sized windows; windows with
 * lakes or sea are dropped; and only windows with above-median relief for their range are kept, since ski resorts
 * sit on the bigger faces. Writes tools/terrain-stats/results/game-targets.json.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RANGE_KEYS } from '../../src/sim/ranges';
import { crop, readNpy } from './grids';
import { COLS, measure, ROWS, slopes, STAT_NAMES, type Stats } from './stats';

const CACHE = join(import.meta.dirname, '../terrain-stats/cache');
const OUT = join(import.meta.dirname, '../terrain-stats/results/game-targets.json');

const hasWater = (s: Float64Array): boolean => s.filter((v) => v < 0.1).length > 0.05 * s.length;

const summary = (rows: Stats[]) => Object.fromEntries(STAT_NAMES.map((k) => {
  const v = rows.map((r) => r[k]), m = v.reduce((a, b) => a + b, 0) / v.length;
  return [k, { mean: +m.toFixed(4), sd: +Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)).toFixed(4) }];
}));

const out: Record<string, unknown> = {};
for (const key of RANGE_KEYS) {
  const dir = join(CACHE, key);
  if (!existsSync(dir)) throw new Error(`no cached tiles for ${key}; run tools/terrain-stats/sample.py first`);
  const rows: Stats[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.npy')).sort()) {
    const tile = readNpy(join(dir, f));
    for (let y = 0; y + ROWS <= tile.hgt; y += ROWS)
      for (let x = 0; x + COLS <= tile.w; x += COLS) {
        const win = crop(tile, x, y, COLS, ROWS);
        if (!hasWater(slopes(win))) rows.push(measure(win));
      }
  }
  const median = [...rows].sort((a, b) => a.relief_m - b.relief_m)[rows.length >> 1]!.relief_m;
  const faces = rows.filter((r) => r.relief_m >= median);
  out[key] = { windows: rows.length, faces: faces.length, stats: summary(faces) };
  console.log(key.padEnd(13), `${faces.length} faces`, Object.entries(summary(faces)).map(([k, v]) => `${k}=${v.mean}`).join(' '));
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
