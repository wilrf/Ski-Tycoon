import type { Level } from '../config';
import type { Resort } from '../sim/world';
import type { Skier, Thought } from '../sim/skiers';

export const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.floor(Math.abs(n)).toLocaleString('en-US')}`;
export const metres = (n: number): string => `${Math.round(n).toLocaleString('en-US')} m`;
export const percent = (n: number): string => `${Math.round(n)}%`;
export const grade = (n: number): string => `${Math.round(n * 100)}% grade`;
export const outOfTen = (n: number): string => `${n.toFixed(1)} / 10`;
export const minutes = (seconds: number): string => (seconds < 60 ? 'under a minute' : `${Math.round(seconds / 60)} min`);

export function clock(secondsSinceMidnight: number): string {
  const h = Math.floor(secondsSinceMidnight / 3600) % 24, m = Math.floor((secondsSinceMidnight % 3600) / 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const DIFFICULTY_NAMES: Record<Level, string> = { 0: 'Green', 1: 'Blue', 2: 'Black', 3: 'Double black' };
export const SKILL_NAMES: Record<Level, string> = { 0: 'Beginner', 1: 'Intermediate', 2: 'Advanced', 3: 'Expert' };

export function thoughtText(t: Thought): string {
  switch (t.kind) {
    case 'arrived': return 'Can’t wait to hit the slopes!';
    case 'longLine': return `The line for ${t.lift} is huge.`;
    case 'riding': return `Nice view from ${t.lift}.`;
    case 'enjoying': return `Here we go down ${t.run}!`;
    case 'tooSteep': return `${t.run} is too steep for me.`;
    case 'lovedRun': return `${t.run} was a great run!`;
    case 'okRun': return `${t.run} was fine.`;
    case 'survivedRun': return `I barely survived ${t.run}.`;
    case 'noRunForMe': return `Nothing up ${t.lift} I can ski. Riding back down.`;
    case 'nothingToSki': return 'There’s nothing here for someone like me.';
    case 'tired': return 'My legs are done. Time to head home.';
    case 'fedUp': return 'I’ve had enough of this place.';
    case 'closing': return 'Lifts are closed. What a day!';
  }
}

export function activityText(s: Skier, resort: Resort): string {
  const state = s.state;
  const lift = 'liftId' in state ? resort.lifts.find((l) => l.id === state.liftId)?.name : undefined;
  switch (state.kind) {
    case 'walking': return lift ? `Walking to ${lift}` : 'Looking for a lift';
    case 'queued': return `In line for ${lift}`;
    case 'riding': return state.down ? `Riding ${lift} back down` : `Riding ${lift}`;
    case 'skiing': return `Skiing ${resort.runs.find((r) => r.id === state.runId)?.name ?? 'off-piste'}`;
    case 'leaving': return 'Heading home';
  }
}
