import { PEAKS } from '../data/peaks';
import { RANGE_PARAMS } from '../data/rangeParams';
import { RANGE_SURFACE } from '../data/rangeSurface';
import { peakTerrain } from '../sim/peakTerrain';
import { generateRangeTerrain } from '../sim/rangeTerrain';
import { isRangeKey, RANGE_NAMES } from '../sim/ranges';
import type { MountainSite } from '../sim/world';

export type SiteMaker = (seed: number) => MountainSite;

/**
 * The mountain a link asks for: ?range=alps builds a generated mountain in that range's character (a new one per
 * seed), ?peak=matterhorn loads that real peak. Null when the link names neither; an error message when it names
 * something that doesn't exist or can't be loaded.
 */
export async function linkedSite(params: URLSearchParams): Promise<{ make: SiteMaker } | { error: string } | null> {
  const range = params.get('range'), peak = params.get('peak');
  if (range !== null) {
    if (!isRangeKey(range)) return { error: `No range called “${range}”.` };
    return { make: (seed) => ({ terrain: generateRangeTerrain(seed, RANGE_PARAMS[range], RANGE_SURFACE[range]), name: `${RANGE_NAMES[range]} Resort` }) };
  }
  if (peak !== null) {
    const entry = PEAKS.find((p) => p.id === peak);
    if (!entry) return { error: `No peak called “${peak}”.` };
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}terrain/peaks/${entry.id}.bin`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const packed = await res.arrayBuffer();
      return { make: (seed) => ({ terrain: peakTerrain(entry, packed, seed), name: entry.name }) };
    } catch (e) {
      return { error: `Couldn’t load ${entry.name}: ${(e as Error).message}` };
    }
  }
  return null;
}
