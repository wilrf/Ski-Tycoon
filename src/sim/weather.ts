import { CONFIG, type Weather, type WeatherSpec } from '../config';
import { pickWeighted, type Rng } from './rng';

export interface Forecast {
  today: Weather;
  /** Shown the evening before, so the player can plan for it. */
  tomorrow: Weather;
}

const KINDS = Object.keys(CONFIG.weather.kinds) as Weather[];

export const weatherSpec = (w: Weather): WeatherSpec => CONFIG.weather.kinds[w];

/** Weather follows a simple chain: storms tend to leave powder behind, powder clears to bluebird, and so on. */
export const nextWeather = (rng: Rng, from: Weather): Weather =>
  pickWeighted(rng, KINDS, (k) => weatherSpec(from).next[k]) ?? 'cloudy';

export function advanceForecast(f: Forecast, rng: Rng): void {
  f.today = f.tomorrow;
  f.tomorrow = nextWeather(rng, f.today);
}
