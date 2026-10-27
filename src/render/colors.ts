import type { Level, LiftType } from '../config';
import type { SkillLevel } from '../sim/skiers';

/** Shared by runs (difficulty) and skiers (skill), which use the same 0 to 3 scale. */
export const LEVEL_COLORS: Record<Level, string> = { 0: '#1f9d55', 1: '#1d6fe0', 2: '#15181d', 3: '#15181d' };
export const LIFT_COLORS: Record<LiftType, string> = { ropeTow: '#b5651d', chairlift: '#d64033', gondola: '#7a3fc9' };
export const SELECTED = '#ffb703';
export const INVALID = '#e63946';
/** Jackets for people whose skill isn't known, such as walkers at the base; picked by id so each keeps a colour. */
export const JACKETS = ['#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#06d6a0', '#fb5607'];
/**
 * Skier jackets by skill, like the coloured bibs ski schools give each class: green, blue and black match
 * the run colours, and experts wear the red the slope guide uses for expert terrain. A few shades each so
 * a crowd isn't uniform.
 */
const SKILL_JACKETS: Record<SkillLevel, readonly string[]> = {
  0: ['#1f9d55', '#2bb673', '#178a48'],
  1: ['#1d6fe0', '#3a86ff', '#1659b8'],
  2: ['#15181d', '#2b2f36', '#3a3f48'],
  3: ['#d62828', '#e63946', '#b51f1f'],
  4: ['#d4a72c', '#e6b93d', '#b8901f'],
};
export const skillJacket = (s: { readonly id: number; readonly skill: SkillLevel }): string => {
  const shades = SKILL_JACKETS[s.skill];
  return shades[s.id % shades.length]!;
};
