import { CONFIG } from '../config';
import { vec, type Vec2 } from '../sim/geometry';
import { JACKETS } from './colors';
import { stampSkier } from './skierArt';
import { footpaths } from './terrainArt';

/** Walkers per footpath at the busiest; the base fills up as the resort does. */
const MOST_WALKERS = 12;
const WALK_SPEED = 1.2;
const PATH_LENGTH = 150;

const bezier = ([a, b, c]: [Vec2, Vec2, Vec2], t: number): Vec2 =>
  vec((1 - t) ** 2 * a.x + 2 * (1 - t) * t * b.x + t * t * c.x, (1 - t) ** 2 * a.y + 2 * (1 - t) * t * b.y + t * t * c.y);

/**
 * Background life around the base village while the resort is open: people carrying their skis between
 * the parking lot and the lodges. They aren't simulated guests, just scenery that grows with the crowd.
 */
export function drawBaseBustle(ctx: CanvasRenderingContext2D, entrance: Vec2, time: number, skiers: number, at: (p: Vec2) => Vec2, u: number): void {
  const { openHour, closeHour } = CONFIG.calendar;
  if (time < openHour * 3600 || time > closeHour * 3600) return;
  const count = Math.min(MOST_WALKERS, Math.round(skiers / 10));
  const period = PATH_LENGTH / WALK_SPEED;
  for (const [n, path] of footpaths(entrance).entries()) {
    for (let k = 0; k < count; k++) {
      const seed = n * 31 + k;
      let t = (time / period + ((seed * 0.618) % 1)) % 1;
      // Half head up to the lodge, half walk back down to their cars.
      if (k % 2 === 1) t = 1 - t;
      const p = bezier(path, t), ahead = bezier(path, Math.min(1, Math.max(0, t + (k % 2 === 1 ? -0.01 : 0.01))));
      const across = (((seed * 0.377) % 1) - 0.5) * 3;
      const heading = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      const placed = vec(p.x - Math.sin(heading) * across, p.y + Math.cos(heading) * across);
      stampSkier(ctx, at(placed), heading, u, JACKETS[(seed * 7) % JACKETS.length]!, 'walking', false);
    }
  }
}
