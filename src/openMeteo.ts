export type Location = { name: string; country?: string; latitude: number; longitude: number; timezone: string };

// Our name -> Open-Meteo daily variable. Units: °C, mm, cm of snowfall, m of depth/waves, km/h, seconds.
const WEATHER = {
  tempMax: 'temperature_2m_max',
  precipitation: 'precipitation_sum',
  rain: 'rain_sum',
  snowfall: 'snowfall_sum',
  snowDepth: 'snow_depth_max',
  windMax: 'wind_speed_10m_max',
  sunshine: 'sunshine_duration',
} as const;
const MARINE = { waveHeight: 'wave_height_max', wavePeriod: 'wave_period_max' } as const;

// Any value may be null. Marine values are all null inland - that is how we know surfing is impossible.
export type DayWeather = { date: string } & Record<keyof typeof WEATHER | keyof typeof MARINE, number | null>;

// Any provider fault. The server log gets the detail; app.ts shows clients a generic retryable error.
export class UpstreamError extends Error {}
export const unavailable = (detail: string): never => {
  throw new UpstreamError(`Open-Meteo: ${detail}`);
};

const plain = (s: string) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); // "Zürich" == "zurich"

export function createOpenMeteo(fetchImpl: typeof fetch = fetch) {
  const get = async (url: string): Promise<any> => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) }).catch((e) => unavailable(`${e.message} ${url}`));
    if (!res.ok) unavailable(`${res.status} ${url}`);
    return res.json().catch(() => unavailable(`invalid JSON from ${url}`));
  };
  // Open-Meteo returns columns (one array per variable); take day i as a row.
  const row = (daily: any, fields: Record<string, string>, i: number) =>
    Object.fromEntries(Object.entries(fields).map(([ours, theirs]) => [ours, daily[theirs][i]]));
  const complete = (daily: any, fields: Record<string, string>) =>
    Array.isArray(daily?.time) && Object.values(fields).every((f) => daily[f]?.length === daily.time.length);

  return {
    // Search also hits alternate names ("Venice" ranks Dayton, OH first), so prefer an exact name match,
    // most populous first ("Paris" -> Paris, FR unless countryCode says otherwise).
    async geocode(name: string, countryCode?: string | null): Promise<Location | undefined> {
      const q = new URLSearchParams({ name, count: '10', ...(countryCode ? { countryCode } : {}) });
      const results: any[] = (await get(`https://geocoding-api.open-meteo.com/v1/search?${q}`)).results ?? [];
      const exact = results.filter((r) => plain(r.name) === plain(name)).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
      const r = exact[0] ?? results[0];
      if (!r) return undefined;
      if (typeof r.name !== 'string' || typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || typeof r.timezone !== 'string')
        unavailable('malformed place');
      return { name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone };
    },

    // 8 days, so a cached forecast still covers 7 after local midnight. Same query => both APIs return the same dates.
    async forecast(lat: number, lon: number): Promise<DayWeather[]> {
      const q = `latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=8&daily=`;
      const [{ daily: w }, { daily: m }] = await Promise.all([
        get(`https://api.open-meteo.com/v1/forecast?${q}${Object.values(WEATHER).join()}`),
        get(`https://marine-api.open-meteo.com/v1/marine?${q}${Object.values(MARINE).join()}`),
      ]);
      // Checked before caching, so a malformed response is never served for the next 3 h.
      if (!complete(w, WEATHER) || !complete(m, MARINE) || m.time.length !== w.time.length) unavailable('incomplete forecast');
      return w.time.map((date: string, i: number) => ({ date, ...row(w, WEATHER, i), ...row(m, MARINE, i) }));
    },
  };
}
