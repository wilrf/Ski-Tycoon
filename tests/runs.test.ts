import { describe, expect, it } from 'vitest';
import { vec } from '../src/sim/geometry';
import { gradeToDifficulty, profileRun, runProblems } from '../src/sim/runs';
import { cellGrade, generateTerrain, heightAt, TerrainType, terrainFromHeights } from '../src/sim/terrain';
import { plane } from './helpers';

const straightDown = [vec(500, 100), vec(500, 700)];

describe('slope and difficulty', () => {
  it('measures the fall-line grade of a plane', () => {
    expect(cellGrade(plane(0.3), 50, 40)).toBeCloseTo(0.3, 5);
  });

  it.each([
    [0.2, 0],
    [0.3, 1],
    [0.5, 2],
    [0.8, 3],
  ] as const)('a straight run on a %s grade is difficulty %s', (grade, difficulty) => {
    const profile = profileRun(plane(grade), straightDown);
    expect(profile.steepestGrade).toBeCloseTo(grade, 2);
    expect(profile.difficulty).toBe(difficulty);
    expect(profile.vertical).toBeCloseTo(600 * grade, 0);
  });

  it('puts exact limits in the easier band', () => {
    expect(gradeToDifficulty(0.25)).toBe(0);
    expect(gradeToDifficulty(0.2501)).toBe(1);
  });

  it('rates a run by its steepest section, not its average', () => {
    // Gentle 0.1 grade with one 50 m wall at 0.7.
    const t = terrainFromHeights(100, 10, (p) => (1000 - p.y) * 0.1 + (p.y < 400 ? 35 : p.y < 450 ? (450 - p.y) * 0.7 : 0));
    const profile = profileRun(t, straightDown);
    expect(profile.vertical / 600).toBeLessThan(0.25);
    expect(profile.difficulty).toBe(3);
  });

  it('makes a traverse easier than the fall line', () => {
    const t = plane(0.5);
    const traverse = [vec(100, 100), vec(900, 300)];
    expect(profileRun(t, traverse).difficulty).toBeLessThan(profileRun(t, straightDown).difficulty);
  });

  it('rejects runs that climb or are too short', () => {
    const t = plane(0.3);
    expect(runProblems(t, [vec(500, 700), vec(500, 100)])).toContain('Runs must go downhill. Pick a lower point.');
    expect(runProblems(t, [vec(500, 100), vec(500, 120)])[0]).toMatch(/at least/);
    expect(runProblems(t, [vec(500, 100)])).toHaveLength(1);
    expect(runProblems(t, straightDown)).toEqual([]);
  });
});

describe('generated mountain', () => {
  const t = generateTerrain(42);

  it('is reproducible from its seed', () => {
    expect(generateTerrain(42).heights).toEqual(t.heights);
    expect(generateTerrain(43).heights).not.toEqual(t.heights);
  });

  it('has a flat base along the bottom and a peak above it', () => {
    const extent = t.size * t.cellSize;
    expect(t.types[(t.size - 1) * t.size + t.size / 2]).toBe(TerrainType.Base);
    expect(Math.max(...t.heights) - heightAt(t, vec(extent / 2, extent - 15))).toBeGreaterThan(400);
  });

  it('offers every difficulty somewhere', () => {
    const grades = new Set<number>();
    for (let cy = 1; cy < t.size - 1; cy++) for (let cx = 1; cx < t.size - 1; cx++) grades.add(gradeToDifficulty(cellGrade(t, cx, cy)));
    expect([...grades].sort()).toEqual([0, 1, 2, 3]);
  });
});
