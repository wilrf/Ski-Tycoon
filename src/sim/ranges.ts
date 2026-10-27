export const RANGE_KEYS = ['alps', 'rockies', 'andes', 'himalayas', 'cascades', 'coast', 'sierra', 'appalachians', 'japan_alps', 'hokkaido'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_NAMES: Readonly<Record<RangeKey, string>> = {
  alps: 'Alps', rockies: 'Colorado Rockies', andes: 'Central Andes', himalayas: 'Himalayas', cascades: 'Cascades',
  coast: 'Coast Mountains', sierra: 'Sierra Nevada', appalachians: 'Appalachians', japan_alps: 'Japanese Alps', hokkaido: 'Hokkaido',
};

/** The knobs of the range generator. Each one moves a shape statistic the eye reads; the fit tunes them per range. */
export interface RangeParams {
  /** Summit-to-base drop of the ski face, metres. */
  readonly relief: number;
  /** Face profile exponent: above 1 the face steepens toward the top, below 1 it bulges like a dome. */
  readonly profile: number;
  /** 0..1 blend of folded noise: 0 gives rounded spurs, 1 knife-edge crests. */
  readonly ridged: number;
  /** Octave gain 0.3..0.7: how much small-scale roughness survives next to the big forms. */
  readonly gain: number;
  /** Amplitude of the noise the erosion starts from, as a share of relief. */
  readonly spurs: number;
  /** Strength of river and gully cutting: higher carves a deeper, denser drainage network. */
  readonly incision: number;
  /** Soil creep 0..0.5: rounds crests and fills hollows, the worn look of old ranges. */
  readonly creep: number;
  /** Steepest angle rock holds, degrees; steeper ground slides until it reaches it. */
  readonly talus: number;
  /** 0..1 flattening of the upper face into benches and broad tops. */
  readonly bench: number;
}

export const isRangeKey = (s: string): s is RangeKey => (RANGE_KEYS as readonly string[]).includes(s);
