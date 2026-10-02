import { mock } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/cache.ts';

export const HOUR = 3_600_000;
export const START = Date.parse('2026-01-10T09:00:00Z');
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

mock.method(console, 'error', () => {}); // the tests trigger thousands of logged provider failures

const fill = (dates: string[], v: number) => dates.map(() => v);

// A fresh app wired to a fake Open-Meteo. Swap `upstream.place/weather/marine` to shape responses.
export function setup() {
  const clock = { now: START };
  const upstream = {
    calls: { geocoding: 0, forecast: 0, marine: 0 },
    failing: false,
    // Distinct name lengths => distinct coordinates => distinct forecast cache keys.
    place: (name: string): any =>
      name.startsWith('Nowhere')
        ? undefined
        : { name, country: 'Portugal', latitude: 38 + name.length / 10, longitude: -9.1, timezone: 'UTC' },
    forecast: (dates: string[]): any => ({
      time: dates,
      temperature_2m_max: fill(dates, 18),
      precipitation_sum: fill(dates, 0),
      rain_sum: fill(dates, 0),
      snowfall_sum: fill(dates, 0),
      snow_depth_max: fill(dates, 0),
      wind_speed_10m_max: fill(dates, 12),
      sunshine_duration: fill(dates, 30_000),
    }),
    marine: (dates: string[]): any => ({ time: dates, wave_height_max: fill(dates, 1.6), wave_period_max: fill(dates, 12) }),
  };

  const fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const endpoint = url.hostname.startsWith('geocoding') ? 'geocoding' : url.hostname.startsWith('marine') ? 'marine' : 'forecast';
    upstream.calls[endpoint]++;
    if (upstream.failing) return new Response('down', { status: 503 });
    if (endpoint === 'geocoding') {
      const place = upstream.place(url.searchParams.get('name')!);
      return Response.json(place ? { results: [place].flat() } : {});
    }
    const dates = Array.from({ length: Number(url.searchParams.get('forecast_days')) }, (_, i) => isoDay(clock.now + i * 24 * HOUR));
    return Response.json({ daily: upstream[endpoint](dates) });
  };

  const app = createApp({ db: openDb(':memory:'), fetch: fetch as typeof globalThis.fetch, now: () => clock.now });
  const query = async (place: string, countryCode?: string | null) => {
    const res = await app.fetch('http://test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query ($place: String!, $cc: String) { activityRanking(place: $place, countryCode: $cc) {
          location { name country } fetchedAt activities { activity available reason weeklyScore days { date score reasons } } } }`,
        variables: { place, cc: countryCode },
      }),
    });
    return res.json() as Promise<any>;
  };
  return { upstream, clock, query };
}
