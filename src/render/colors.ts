import type { Level, LiftType } from '../config';

/** Shared by runs (difficulty) and skiers (skill), which use the same 0 to 3 scale. */
export const LEVEL_COLORS: Record<Level, string> = { 0: '#2e9e44', 1: '#1f6fd1', 2: '#111418', 3: '#111418' };
export const LIFT_COLORS: Record<LiftType, string> = { ropeTow: '#8a5a2b', chairlift: '#c0392b', gondola: '#7b2cbf' };
export const SELECTED = '#ffb703';
