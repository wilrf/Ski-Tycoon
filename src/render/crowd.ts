import { CONFIG } from '../config';
import type { Skier } from '../sim/skiers';
import { activeResort, type World } from '../sim/world';
import type { Selection } from '../ui/tools';

/**
 * The skiers to draw this frame. At high speeds only a steady sample is drawn, so the map reads as a calm
 * flow, not a swarm; the sim still runs every skier. Fast-forward in management games keeps the sim exact
 * and changes only what's shown.
 */
export function drawnSkiers(world: World, speedIndex: number, selection: Selection): readonly Skier[] {
  const skiers = activeResort(world).skiers;
  const every = CONFIG.loop.drawEvery[speedIndex] ?? 1;
  if (every <= 1) return skiers;
  const selected = selection?.kind === 'skier' ? selection.id : -1;
  return skiers.filter((s) => s.id % every === 0 || s.id === selected);
}
