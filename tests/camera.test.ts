import { describe, expect, it } from 'vitest';
import { follow } from '../src/render/camera';

describe('follow', () => {
  it('eases toward the target at the same rate whatever the frame rate', () => {
    const a = { x: 0, y: 0, zoom: 2 }, b = { x: 0, y: 0, zoom: 2 };
    for (let i = 0; i < 60; i++) follow(a, { x: 100, y: 50 }, 1 / 60);
    for (let i = 0; i < 30; i++) follow(b, { x: 100, y: 50 }, 1 / 30);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.x).toBeGreaterThan(95);
    expect(a.x).toBeLessThan(100);
  });
});
