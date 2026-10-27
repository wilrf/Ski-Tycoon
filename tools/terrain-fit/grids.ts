import { readFileSync } from 'node:fs';
import type { HeightGrid } from '../../src/sim/erosion';
import { COLS, RES_M, ROWS, type Grid } from './stats';

/** Reads a 2D float32 .npy array as written by numpy.save. */
export function readNpy(path: string): Grid {
  const buf = readFileSync(path);
  const headerLen = buf.readUInt16LE(8);
  const header = buf.toString('latin1', 10, 10 + headerLen);
  const [hgt, w] = /'shape': \((\d+), (\d+)\)/.exec(header)!.slice(1).map(Number) as [number, number];
  if (!header.includes("'<f4'")) throw new Error(`${path}: expected little-endian float32`);
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset + 10 + headerLen, buf.byteOffset + buf.length));
  return { w, hgt, z: Float64Array.from(data) };
}

export const crop = (g: Grid, x0: number, y0: number, w: number, hgt: number): Grid =>
  ({ w, hgt, z: Float64Array.from({ length: w * hgt }, (_, i) => g.z[(y0 + Math.floor(i / w)) * g.w + x0 + (i % w)]!) });

/** The game face (above the base strip) resampled from the game's grid onto the 30 m stats grid. */
export function faceGrid({ size, cellSize, h }: HeightGrid): Grid {
  const at = (x: number, y: number): number => {
    const gx = Math.min(size - 1.001, Math.max(0, x / cellSize - 0.5)), gy = Math.min(size - 1.001, Math.max(0, y / cellSize - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, i = y0 * size + x0;
    return (h[i]! * (1 - fx) + h[i + 1]! * fx) * (1 - fy) + (h[i + size]! * (1 - fx) + h[i + size + 1]! * fx) * fy;
  };
  return { w: COLS, hgt: ROWS, z: Float64Array.from({ length: COLS * ROWS }, (_, i) => at(((i % COLS) + 0.5) * RES_M, (Math.floor(i / COLS) + 0.5) * RES_M)) };
}
