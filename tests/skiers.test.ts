import { describe, expect, it } from 'vitest';
import { CONFIG, type LiftType } from '../src/config';
import { vec, type Vec2 } from '../src/sim/geometry';
import type { Lift } from '../src/sim/lifts';
import { leadsSomewhere, liftsFrom, runsFromLift, type Mountain } from '../src/sim/network';
import type { Run } from '../src/sim/runs';
import { chooseRun, updateSkier, type SkierContext, type SkillLevel } from '../src/sim/skiers';
import { makeContext, makeLift as makeLiftOn, makeRun, makeSkier, plane, rng, runOf } from './helpers';

const t = plane(0.3);

const makeLift = (id: number, bottom: Vec2, top: Vec2, type: LiftType = 'chairlift'): Lift => makeLiftOn(t, id, bottom, top, type);

describe('run to lift connections', () => {
  const upper = makeLift(1, vec(300, 500), vec(300, 150));
  const lower = makeLift(2, vec(600, 600), vec(600, 200));
  const toLower = makeRun(t, [vec(310, 160), vec(590, 590)]);
  const toBase = makeRun(t, [vec(320, 150), vec(320, 900)]);
  const deadEnd = makeRun(t, [vec(300, 160), vec(150, 600)]);
  const elsewhere = makeRun(t, [vec(800, 100), vec(800, 400)]);
  const m: Mountain = { terrain: t, lifts: [upper, lower], runs: [toLower, toBase, deadEnd, elsewhere] };

  it('finds runs that start near a lift’s top station', () => {
    expect(runsFromLift(m, upper)).toEqual([toLower, toBase, deadEnd]);
    expect(runsFromLift(m, lower)).toEqual([]);
  });

  it('connects a run’s end to lifts whose bottom station is near it', () => {
    expect(liftsFrom(m, vec(590, 590))).toEqual([lower]);
    expect(liftsFrom(m, vec(590, 400))).toEqual([]);
  });

  it('treats the whole base area as one hub', () => {
    const base = makeLift(3, vec(800, 950), vec(800, 700));
    expect(liftsFrom({ ...m, lifts: [upper, lower, base] }, vec(100, 950))).toEqual([base]);
  });

  it('only counts runs that end at a lift or the base as skiable', () => {
    expect(leadsSomewhere(m, toLower)).toBe(true);
    expect(leadsSomewhere(m, toBase)).toBe(true);
    expect(leadsSomewhere(m, deadEnd)).toBe(false);
  });
});

describe('run choice by skill', () => {
  const all = [runOf(0), runOf(1), runOf(2), runOf(3)];
  const picks = (runs: Run[], skill: SkillLevel) => {
    const r = rng(7);
    return Array.from({ length: 500 }, () => chooseRun(runs, skill, r));
  };

  it.each([0, 1, 2, 3] as const)('a skill %s skier never picks a run above their level when one at or below exists', (skill) => {
    for (const choice of picks(all, skill)) {
      expect(choice?.scared).toBe(false);
      expect(choice!.run.profile.difficulty).toBeLessThanOrEqual(skill);
    }
  });

  it('prefers runs that match the skier’s level', () => {
    const matches = picks(all, 2).filter((c) => c!.run.profile.difficulty === 2).length;
    expect(matches).toBeGreaterThan(250);
  });

  it('sometimes sends a beginner down a run one level up, scared, and never two levels up', () => {
    const blueOnly = picks([runOf(1)], 0);
    const scared = blueOnly.filter((c) => c?.scared).length;
    expect(scared / blueOnly.length).toBeCloseTo(CONFIG.skiers.braveChance, 1);
    expect(picks([runOf(2), runOf(3)], 0).every((c) => c === null)).toBe(true);
  });

  it('returns null when there are no runs at all', () => {
    expect(chooseRun([], 3, rng())).toBeNull();
  });
});

describe('skiers on the mountain', () => {
  const lift = makeLift(1, vec(500, 900), vec(500, 400));
  const context = (runs: Run[]): SkierContext => makeContext({ terrain: t, lifts: [lift], runs });

  function rideToTop(ctx: SkierContext, skill: SkillLevel) {
    const s = makeSkier(vec(500, 950), skill);
    lift.queue.length = 0;
    for (let i = 0; i < 2000 && s.state.kind !== 'queued'; i++) updateSkier(ctx, s, 1);
    lift.queue.length = 0;
    s.state = { kind: 'riding', liftId: lift.id, down: false, progress: 0.999 };
    updateSkier(ctx, s, 10);
    return s;
  }

  it('walks from the base to a lift and joins its line', () => {
    const ctx = context([]);
    const s = makeSkier(vec(450, 960));
    for (let i = 0; i < 2000 && s.state.kind !== 'queued'; i++) updateSkier(ctx, s, 1);
    expect(s.state.kind).toBe('queued');
    expect(lift.queue).toContain(1);
  });

  it('rides back down, unhappier, when no run from the top suits them', () => {
    const black = makeRun(plane(0.55), [vec(505, 400), vec(505, 950)]);
    const s = rideToTop(context([black]), 0);
    // A beginner may bravely try one level up, but black is two.
    expect(s.state).toMatchObject({ kind: 'riding', down: true });
    expect(s.thought).toEqual({ kind: 'noRunForMe', lift: lift.name });
  });

  it('leaves unhappy when every reachable lift has let them down', () => {
    const ctx = context([]);
    const s = rideToTop(ctx, 1);
    for (let i = 0; i < 2000 && s.state.kind === 'riding'; i++) updateSkier(ctx, s, 1);
    expect(s.state).toEqual({ kind: 'leaving', happy: false });
    expect(s.thought.kind).toBe('nothingToSki');
  });

  it('skis a suitable run back to the lift and gets tired over time', () => {
    const green = makeRun(t, [vec(505, 405), vec(700, 600), vec(510, 890)]);
    const ctx = context([green]);
    const s = rideToTop(ctx, 1);
    expect(s.state).toMatchObject({ kind: 'skiing', runId: green.id, scared: false });
    const energy = s.energy;
    for (let i = 0; i < 2000 && s.state.kind === 'skiing'; i++) updateSkier(ctx, s, 1);
    expect(s.state).toEqual({ kind: 'walking', liftId: lift.id });
    expect(s.energy).toBeLessThan(energy);
  });
});
