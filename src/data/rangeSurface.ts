import type { RangeKey } from '../sim/ranges';

/** Where each range's ground sits in the real world, for deciding what grows and what is bare. */
export interface RangeSurface {
  /** Altitude of a generated mountain's base, metres: the median low point of real ski-face-sized windows. */
  readonly baseM: number;
  /** Altitude where forest ends, metres. Above it the ground is open: snow, or rock where too steep to hold snow. */
  readonly treelineM: number;
  /** Where the tree line comes from. */
  readonly source: string;
}

export const RANGE_SURFACE: Readonly<Record<RangeKey, RangeSurface>> = {
  alps: { baseM: 1606, treelineM: 2200, source: 'Zermatt Flora; Wikipedia "Tree line" (Swiss Alps 2,200 m)' },
  rockies: { baseM: 3063, treelineM: 3400, source: 'Wikipedia "Tree line" (Rocky Mountain NP 3,250-3,550 m by aspect)' },
  andes: { baseM: 2938, treelineM: 2000, source: 'Estimate: the dry central Andes near Aconcagua are treeless at these heights' },
  himalayas: { baseM: 4013, treelineM: 4300, source: 'Erdkunde, Khumbu vegetation map (4,200-4,400 m by aspect)' },
  cascades: { baseM: 892, treelineM: 2050, source: 'NPS, Mount Rainier: Paradise tree line about 6,800 ft' },
  coast: { baseM: 987, treelineM: 1800, source: 'Estimate: Whistler Blackcomb tree line, near the Rendezvous Lodge' },
  sierra: { baseM: 2724, treelineM: 3400, source: 'Wikipedia "Tree line" (Yosemite 3,200 m west, 3,600 m east)' },
  appalachians: { baseM: 803, treelineM: 1350, source: 'Wikipedia "Tree line" (New Hampshire 1,350 m)' },
  japan_alps: { baseM: 1336, treelineM: 2900, source: 'Wikipedia "Tree line" (Japanese Alps 2,900 m)' },
  hokkaido: { baseM: 735, treelineM: 1500, source: 'Wikipedia "Hokkaido montane conifer forests" (conifers end near 1,500 m)' },
};

/** Peaks whose tree line differs from their range's. The southern Appalachians are forested to their summits. */
export const PEAK_TREELINE_M: Readonly<Record<string, number>> = {
  'mount-mitchell': Infinity,
  kuwohi: Infinity,
};
