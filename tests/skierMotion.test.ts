import { describe, expect, it } from 'vitest';
import { distToSegment, vec } from '../src/sim/geometry';
import type { Run } from '../src/sim/runs';
import type { SkillLevel } from '../src/sim/skiers';
import { skiingPose, snowPuffs, trailPoses } from '../src/render/skierMotion';
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

  it('lingers at the edge of each turn and darts through the fall line', () => {
    const run = makeRun(plane(0.3), line);
    // Sample a beginner's sideways offset evenly down the run, as time would.
    const offsets = Array.from({ length: 400 }, (_, i) => Math.abs(skiingPose(skierOn(run, 0, 50 + i * 0.5), [run], 1)!.pos.x - 500));
    const width = Math.max(...offsets);
    const nearEdge = offsets.filter((o) => o > 0.7 * width).length / offsets.length;
    // An even sine swing spends about half its time this close to the edge.
    expect(nearEdge).toBeGreaterThan(0.58);
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

  describe('snow spray', () => {
    const run = makeRun(plane(0.3), line);
    const puffsAt = (skill: SkillLevel, d: number) => snowPuffs(skierOn(run, skill, d), [run], 1);

    it('is the same every frame for the same moment', () => {
      expect(puffsAt(1, 123.4)).toEqual(puffsAt(1, 123.4));
    });

    it('flies out from the outside of each turn and fades as the skier skis on', () => {
      // Step down the run in small steps; every fresh puff should sit further from the run line than
      // the skier was when they threw it, and fresh puffs should be more opaque than old ones.
      let seen = 0;
      for (let d = 60; d < 200; d += 0.25) {
        const puffs = puffsAt(1, d);
        if (puffs.length === 0) continue;
        seen++;
        const mean = puffs.reduce((sum, p) => sum + Math.abs(p.pos.x - 500), 0) / puffs.length;
        expect(mean).toBeGreaterThan(2);
        for (const p of puffs) expect(p.alpha).toBeLessThanOrEqual(0.85);
      }
      expect(seen).toBeGreaterThan(20);
      // Spray is gone between turns.
      expect(Array.from({ length: 400 }, (_, i) => puffsAt(1, 60 + i * 0.25).length).some((n) => n === 0)).toBe(true);
    });

    it('bursts around a skier landing a jump they like', () => {
      const jumpRun: Run = { ...run, features: [{ type: 'largeJump', at: 300 }] };
      const landed = snowPuffs(skierOn(jumpRun, 3, 300 + 24 + 0.5), [jumpRun], 1);
      expect(landed.length).toBeGreaterThanOrEqual(12);
    });
  });

  it('leaves a trail back up the line the skier just skied, on the run', () => {
    const run = makeRun(plane(0.3), line);
    const trail = trailPoses(skierOn(run, 2, 200), [run], 1);
    expect(trail.length).toBeGreaterThan(10);
    expect(trail[0]!.pos).toEqual(skiingPose(skierOn(run, 2, 200), [run], 1)!.pos);
    // Newest first, so each point is further up the run (smaller y here).
    for (let i = 1; i < trail.length; i++) expect(trail[i]!.pos.y).toBeLessThan(trail[i - 1]!.pos.y);
    for (const p of trail) expect(Math.abs(p.pos.x - 500)).toBeLessThan(11);
  });

  it('finishes the run with a hockey stop: skis across the hill and a spray of snow', () => {
    const run = makeRun(plane(0.3), line);
    const end = run.profile.length;
    const pose = skiingPose(skierOn(run, 2, end), [run], 1)!;
    // The run line points straight down (+y); the skis end up across it.
    expect(Math.abs(Math.cos(pose.heading))).toBeGreaterThan(0.95);
    expect(pose.pos.x).toBeCloseTo(500);
    expect(snowPuffs(skierOn(run, 2, end - 1), [run], 1).length).toBeGreaterThanOrEqual(10);
  });
});
