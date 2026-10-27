import type { Level, LiftType } from '../config';

/** Shared by runs (difficulty) and skiers (skill), which use the same 0 to 3 scale. */
export const LEVEL_COLORS: Record<Level, string> = { 0: '#1f9d55', 1: '#1d6fe0', 2: '#15181d', 3: '#15181d' };
export const LIFT_COLORS: Record<LiftType, string> = { ropeTow: '#b5651d', chairlift: '#d64033', gondola: '#7a3fc9' };
export const SELECTED = '#ffb703';
export const INVALID = '#e63946';
/** Skier jackets; picked by id so each skier keeps a colour. */
export const JACKETS = ['#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#06d6a0', '#fb5607'];
