import { CONFIG, type Level, type Skill } from '../config';
import type { Request } from '../sim/requests';
import type { FeelingKind, Quote, Skier, Thought } from '../sim/skiers';
import type { Resort } from '../sim/world';

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
export const SKILL_NAMES: Record<Skill, string> = { 0: 'Beginner', 1: 'Intermediate', 2: 'Expert', 3: 'Pro', 4: 'Olympic' };

export function thoughtText(t: Thought): string {
  switch (t.kind) {
    case 'arrived': return 'Can’t wait to hit the slopes!';
    case 'back': return `Back again, visit number ${t.visits}!`;
    case 'movedUp': return `I’ve moved up: I’m ${SKILL_NAMES[t.skill].toLowerCase()} now!`;
    case 'boredRun': return `${t.run} is too easy for me.`;
    case 'eating': return `Heading into ${t.place} for something to eat.`;
    case 'apres': return `Lifts are closed. Drinks at ${t.place}!`;
    case 'longLine': return `The line for ${t.lift} is huge.`;
    case 'riding': return `Nice view from ${t.lift}.`;
    case 'enjoying': return `Here we go down ${t.run}!`;
    case 'tooSteep': return `${t.run} is too steep for me.`;
    case 'lovedRun': return `${t.run} was a great run!`;
    case 'lovedFeature': return `Loved ${t.feature} on ${t.run}!`;
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
    case 'toBuilding': return `Walking to ${resort.buildings.find((b) => b.id === state.buildingId)?.name ?? 'lunch'}`;
    case 'eating': return `Eating at ${resort.buildings.find((b) => b.id === state.buildingId)?.name ?? 'the lodge'}`;
    case 'toBar': return `Skiing down to ${resort.buildings.find((b) => b.id === state.buildingId)?.name ?? 'the lodge'} for après`;
    case 'apres': return `Après at ${resort.buildings.find((b) => b.id === state.buildingId)?.name ?? 'the lodge'}`;
    case 'leaving': return 'Heading home';
  }
}

export const FEELING_EMOJI: Record<FeelingKind, string> = {
  greatRun: '😍', goodRun: '🙂', boredRun: '😒', crowdedRun: '😣', scared: '😱', longLine: '😤', nothingForMe: '😞', noLift: '😞',
  overpriced: '💸', bargain: '🤑', tiringTow: '😮‍💨', comfyRide: '😌', goodMeal: '🍲', lodgeFull: '🍽️', windHold: '🌬️', movedUp: '🎉', greatApres: '🍻',
};

/** One line on why happiness changed, from the skier's point of view. */
export function feelingText(kind: FeelingKind, place: string): string {
  switch (kind) {
    case 'greatRun': return `Loved ${place}`;
    case 'goodRun': return `Skied ${place}`;
    case 'boredRun': return `${place} was too easy`;
    case 'crowdedRun': return `${place} was packed`;
    case 'scared': return `${place} was too steep`;
    case 'longLine': return `Long line at ${place}`;
    case 'nothingForMe': return `Nothing to ski from ${place}`;
    case 'noLift': return 'No lift to take';
    case 'overpriced': return 'The ticket cost too much';
    case 'bargain': return 'The ticket was a bargain';
    case 'tiringTow': return `${place} wore out my arms`;
    case 'comfyRide': return `Cozy ride on ${place}`;
    case 'goodMeal': return `Good food at ${place}`;
    case 'lodgeFull': return `${place} was full`;
    case 'windHold': return `${place} was stopped by wind`;
    case 'movedUp': return 'Moved up a level';
    case 'greatApres': return `Great après at ${place}`;
  }
}

/** A short label for a kind of feeling in the resort's tally, with how many times it happened. */
export function tallyText(kind: FeelingKind, count: number): string {
  const label: Record<FeelingKind, string> = {
    greatRun: 'Loved a run', goodRun: 'Enjoyed a run', boredRun: 'Run too easy', crowdedRun: 'Packed run',
    scared: 'Run too hard', longLine: 'Long line', nothingForMe: 'Nothing to ski off a lift', noLift: 'No lift to take',
    overpriced: 'Ticket too pricey', bargain: 'Ticket a bargain', tiringTow: 'Worn out on a long tow', comfyRide: 'Cozy covered lift',
    goodMeal: 'Good meal', lodgeFull: 'Lodge full', windHold: 'Lift on wind hold', movedUp: 'Came back a level better',
    greatApres: 'Great après',
  };
  return `${label[kind]} ×${count.toLocaleString('en-US')}`;
}

/** A magazine-style quote from a skier. */
export function quoteText(q: Quote): string {
  const said: Record<FeelingKind, string> = {
    greatRun: `${q.place} is the best run I’ve skied all season.`,
    goodRun: `${q.place} is a nice cruise.`,
    boredRun: `${q.place} is a bit tame for me.`,
    crowdedRun: `${q.place} was shoulder to shoulder.`,
    scared: `I ended up on ${q.place} and I was terrified.`,
    longLine: `I spent half my day in the line for ${q.place}.`,
    nothingForMe: `I rode ${q.place} and there was nothing up there I could ski.`,
    noLift: 'I couldn’t find a lift that went anywhere.',
    overpriced: 'The lift ticket is highway robbery.',
    bargain: 'Great value for the price of the ticket.',
    tiringTow: `My arms are still burning from ${q.place}.`,
    comfyRide: `${q.place} is so comfy, with heated seats and a bubble.`,
    goodMeal: `The chili at ${q.place} is worth the trip alone.`,
    lodgeFull: `${q.place} was packed and I couldn’t get a seat.`,
    windHold: `The wind shut ${q.place} and my day with it.`,
    movedUp: 'I learned so much here, I’ve moved up a level!',
    greatApres: `The après at ${q.place} is the best way to end a ski day.`,
  };
  return `“${said[q.kind]}” — ${q.name}, ${SKILL_NAMES[q.skill].toLowerCase()}`;
}

export function requestTitle(r: Request): string {
  switch (r.kind) {
    case 'skiClub': return `Ski club visit: ${r.target} blue runs off one lift`;
    case 'skiSchool': return `Ski school: ${r.target} green runs off a base lift`;
    case 'proSkier': return `Pro freeskier: a run steeper than ${Math.round(r.target * 100)}%`;
    case 'bigVertical': return `Leg burner: a run with ${r.target} m of vertical`;
    case 'busyDay': return `Big weekend: ${r.target} skiers in one day`;
    case 'happyDay': return `Five-star day: ${Math.round(r.target * 100)}% go home happy (150+ skiers)`;
    case 'shortLines': return `No waiting: every line under ${Math.round(r.target / 60)} min all day (200+ skiers)`;
    case 'lunchRush': return `Lunch rush: serve ${r.target} meals in one day`;
  }
}

export const stars = (n: number): string => (n <= 0 ? 'Not rated yet' : '★'.repeat(n) + '☆'.repeat(5 - n));

export const weatherText = (w: keyof typeof CONFIG.weather.kinds): string => `${CONFIG.weather.kinds[w].emoji} ${CONFIG.weather.kinds[w].label}`;
