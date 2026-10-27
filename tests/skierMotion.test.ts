import { describe, expect, it } from 'vitest';
import { distToSegment, vec } from '../src/sim/geometry';
import type { Run } from '../src/sim/runs';
import type { SkillLevel } from '../src/sim/skiers';
import { skiingPose } from '../src/render/skierMotion';
import { makeRun, makeSkier, plane } from './helpers';

const line = [vec(500, 100), vec(500, 700)];

const skierOn = (run: Run, skill: SkillLevel, distance: number) => {
  const s = makeSkier(vec(0, 0), skill);
  s.state = { kind: 'skiing', runId: run.id, scared: false, distance };
  return s;
};

describe('skiing pose', () => {
  it('carves either side of the run line but stays on the groomed width', () => {
    const run = makeRun(plane(0.3), line);
    const offsets = Array.from({ length: 60 }, (_, i) => {
      const pose = skiingPose(skierOn(run, 1, 20 + i * 8), [run], 1)!;
      return pose.pos.x - 500;
    });
    expect(Math.min(...offsets)).toBeLessThan(-3);
    expect(Math.max(...offsets)).toBeGreaterThan(3);
    for (const o of offsets) expect(Math.abs(o)).toBeLessThan(11);
  });

  it('flies over a jump the skier likes and skis around one they would skip', () => {
    const run: Run = { ...makeRun(plane(0.3), line), features: [{ type: 'largeJump', at: 300 }] };
    expect(skiingPose(skierOn(run, 3, 312), [run], 1)!.air).toBeGreaterThan(3);
    expect(skiingPose(skierOn(run, 0, 312), [run], 1)!.air).toBe(0);
    // Square to the lip on the way in.
    const lip = skiingPose(skierOn(run, 3, 300), [run], 1)!;
    expect(distToSegment(lip.pos, line[0]!, line[1]!)).toBeLessThan(0.01);
  });

  it('is only for skiers on a run', () => {
    const run = makeRun(plane(0.3), line);
    const s = skierOn(run, 1, 50);
    s.state = { kind: 'walking', liftId: 1 };
    expect(skiingPose(s, [run], 1)).toBeNull();
  });
});
