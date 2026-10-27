import { CONFIG } from '../config';
import { clamp, type Vec2 } from './geometry';
import { leadsSomewhere } from './network';
import type { FeelingKind, FeelingTally, Journal, Quote } from './skiers';
import { terrainExtent } from './terrain';
import type { Resort } from './world';

/** What the resort did since the last review. */
export interface Week extends Journal {
  days: number;
  arrivals: number;
  leftHappy: number;
  leftUnhappy: number;
}

export const emptyWeek = (): Week => ({ days: 0, arrivals: 0, leftHappy: 0, leftUnhappy: 0, tally: {}, quotes: {} });

/** Each part is scored 0 to 1 except happiness, which counts double; the total is the star rating. */
export interface ReviewScores {
  readonly happiness: number;
  readonly variety: number;
  readonly size: number;
  readonly terrain: number;
}

export interface Review {
  readonly day: number;
  readonly stars: number;
  readonly scores: ReviewScores;
  /** The best and worst things skiers said, best first. */
  readonly quotes: readonly Quote[];
}

export const PRAISE: readonly FeelingKind[] = ['greatRun', 'movedUp', 'goodMeal', 'comfyRide', 'bargain', 'goodRun'];
export const GRIPES: readonly FeelingKind[] = ['longLine', 'scared', 'nothingForMe', 'overpriced', 'crowdedRun', 'boredRun', 'lodgeFull', 'windHold', 'tiringTow', 'noLift'];

/** The kinds of feeling with the biggest total effect, largest first. */
export function topFeelings(tally: FeelingTally, kinds: readonly FeelingKind[], n: number): FeelingKind[] {
  return kinds.filter((k) => (tally[k]?.count ?? 0) > 0).sort((a, b) => Math.abs(tally[b]!.delta) - Math.abs(tally[a]!.delta)).slice(0, n);
}

export function writeReview(resort: Resort, day: number): Review {
  const { week } = resort;
  const { fullSizeSkiers, fullVertical } = CONFIG.review;
  const left = week.leftHappy + week.leftUnhappy;
  const skiable = resort.runs.filter((r) => leadsSomewhere(resort, r));
  const scores: ReviewScores = {
    happiness: left === 0 ? 0 : clamp(((week.leftHappy / left) - 0.4) / 0.5, 0, 1) * 2,
    variety: new Set(skiable.map((r) => r.profile.difficulty)).size / 4,
    size: clamp(week.arrivals / Math.max(1, week.days) / fullSizeSkiers, 0, 1),
    terrain: clamp(Math.max(0, ...resort.lifts.map((l) => l.rise)) / fullVertical, 0, 1),
  };
  const total = scores.happiness + scores.variety + scores.size + scores.terrain;
  const quotes = [...topFeelings(week.tally, PRAISE, 2), ...topFeelings(week.tally, GRIPES, 2)]
    .map((k) => week.quotes[k])
    .filter((q): q is Quote => q !== undefined);
  return { day, stars: clamp(Math.round(total), 1, 5), scores, quotes };
}

/** The northern edge (smallest y) of the land the resort owns, in metres. */
export const landEdge = (resort: Resort): number => CONFIG.land[resort.land - 1]!.fromY * terrainExtent(resort.terrain);

/** Why these points can't be built on, if any of them are on land the resort doesn't own yet. */
export function landProblem(resort: Resort, points: readonly Vec2[]): string | null {
  const next = CONFIG.land[resort.land];
  if (!next || points.every((p) => p.y >= landEdge(resort))) return null;
  return `That’s on ${next.name} land, which you don’t own yet. Buy it from the Resort panel.`;
}

/** Where a feeling happened most today, or '' if it isn't tied to a place. */
export function worstPlace(tally: FeelingTally, kind: FeelingKind): string {
  const places = Object.entries(tally[kind]?.places ?? {});
  return places.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
