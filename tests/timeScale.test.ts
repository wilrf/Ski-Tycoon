import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { timeScaleAt } from '../src/render/camera';

const { ticksPerSecond, gameSecondsPerTick, speeds, slowMotion } = CONFIG.loop;
const gameSecondsPerSecond = (zoom: number, speed: number): number =>
  ticksPerSecond * gameSecondsPerTick * speeds[speed]! * timeScaleAt(zoom, speed);

describe('timeScaleAt', () => {
  it('runs at full speed when zoomed out', () => {
    for (const speed of [1, 2, 3]) expect(timeScaleAt(slowMotion.fromZoom, speed)).toBe(1);
  });

  it('slows every speed to the same slow-motion pace when zoomed all the way in', () => {
    for (const speed of [1, 2, 3]) expect(gameSecondsPerSecond(slowMotion.toZoom, speed)).toBeCloseTo(slowMotion.gameSecondsPerSecond);
  });

  it('eases down steadily in between', () => {
    const mid = gameSecondsPerSecond(Math.sqrt(slowMotion.fromZoom * slowMotion.toZoom), 1);
    expect(mid).toBeLessThan(gameSecondsPerSecond(slowMotion.fromZoom, 1));
    expect(mid).toBeGreaterThan(slowMotion.gameSecondsPerSecond);
  });

  it('leaves a paused game paused', () => {
    expect(gameSecondsPerSecond(slowMotion.toZoom, 0)).toBe(0);
  });
});
