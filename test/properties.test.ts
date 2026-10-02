// Property tests: thousands of generated inputs, checked against invariants instead of fixed answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import type { DayWeather } from '../src/openMeteo.ts';
import { ACTIVITIES, rankActivities } from '../src/scoring.ts';
import { HOUR, setup } from './fake.ts';

// Open-Meteo sends null for missing values, so every generated number may be null too.
const value = (min: number, max: number) => fc.option(fc.double({ min, max, noNaN: true }), { nil: null, freq: 5 });
const dayArb = fc.record({
  date: fc.constant('2026-01-10'),
  tempMax: value(-60, 60),
  precipitation: value(0, 500),
  rain: value(0, 500),
  snowfall: value(0, 200),
  snowDepth: value(0, 20),
  windMax: value(0, 300),
  sunshine: value(0, 86_400),
  waveHeight: value(0, 25),
  wavePeriod: value(0, 30),
}) as fc.Arbitrary<DayWeather>;
const isScore = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100;

test('scores are integers 0-100, sorted, one entry per activity, availability matches the data', () => {
  fc.assert(
    fc.property(fc.array(dayArb, { minLength: 1, maxLength: 16 }), (week) => {
      const ranking = rankActivities(week);
      assert.deepEqual(ranking.map((a) => a.activity).sort(), [...ACTIVITIES].sort());
      const order = ranking.map((a) => a.weeklyScore ?? -1);
      assert.deepEqual(
        order,
        [...order].sort((a, b) => b - a),
      );

      for (const a of ranking) {
        if (!a.available) {
          assert.ok(a.reason && a.weeklyScore === null && a.days.length === 0);
          continue;
        }
        assert.ok(isScore(a.weeklyScore));
        assert.equal(a.days.length, week.length);
        for (const d of a.days) assert.ok(isScore(d.score));
      }
      const available = (activity: string) => ranking.find((a) => a.activity === activity)!.available;
      assert.equal(
        available('SURFING'),
        week.some((d) => d.waveHeight !== null),
      );
      assert.equal(
        available('SKIING'),
        week.some((d) => (d.snowDepth ?? 0) >= 0.1),
      );
    }),
    { numRuns: 3000 },
  );
});

test('more rain never makes outdoor better, nor indoor worse', () => {
  fc.assert(
    fc.property(dayArb, fc.double({ min: 0, max: 100, noNaN: true }), (day, extra) => {
      const wetter = { ...day, precipitation: (day.precipitation ?? 0) + extra };
      const score = (d: DayWeather, activity: string) => rankActivities([d]).find((a) => a.activity === activity)!.weeklyScore!;
      assert.ok(score(wetter, 'OUTDOOR_SIGHTSEEING') <= score({ ...day, precipitation: day.precipitation ?? 0 }, 'OUTDOOR_SIGHTSEEING'));
      assert.ok(score(wetter, 'INDOOR_SIGHTSEEING') >= score({ ...day, precipitation: day.precipitation ?? 0 }, 'INDOOR_SIGHTSEEING'));
    }),
    { numRuns: 2000 },
  );
});

const nasty = [
  "L'Aquila",
  'Saint-Étienne',
  '東京',
  'São Paulo',
  'Xi’an',
  '   ',
  '\u0000',
  '<img src=x onerror=alert(1)>',
  "' OR 1=1 --",
  'a'.repeat(100),
  'a'.repeat(101),
  '🏄',
  'Nowhereville',
  'é'.repeat(50),
];

test('any user input yields a result or a typed client error, never an internal one', async () => {
  const { query } = setup();
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.constantFrom(...nasty), fc.string({ unit: 'binary', maxLength: 120 }), fc.string({ unit: 'grapheme', maxLength: 30 })),
      fc.option(fc.string({ maxLength: 3 }), { nil: null }),
      async (place, countryCode) => {
        const { errors } = await query(place, countryCode);
        if (errors) assert.ok(['BAD_USER_INPUT', 'PLACE_NOT_FOUND'].includes(errors[0].extensions?.code), JSON.stringify(errors));
      },
    ),
    { numRuns: 1000 },
  );
});

const column = (min: number, max: number) => fc.array(value(min, max), { minLength: 8, maxLength: 8 });

test('odd but valid Open-Meteo payloads (nulls, extremes, missing country) always produce a full answer', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        weather: fc.record({
          temperature_2m_max: column(-60, 60),
          precipitation_sum: column(0, 500),
          rain_sum: column(0, 500),
          snowfall_sum: column(0, 200),
          snow_depth_max: column(0, 20),
          wind_speed_10m_max: column(0, 300),
          sunshine_duration: column(0, 86_400),
        }),
        marine: fc.record({ wave_height_max: column(0, 25), wave_period_max: column(0, 30) }),
        country: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
      }),
      async ({ weather, marine, country }) => {
        const { upstream, query } = setup();
        upstream.place = (name) => ({ name, country, latitude: 38.7, longitude: -9.1, timezone: 'UTC' });
        upstream.forecast = (time) => ({ time, ...weather });
        upstream.marine = (time) => ({ time, ...marine });

        const { data, errors } = await query('Lisbon');
        assert.equal(errors, undefined, JSON.stringify(errors));
        for (const a of data.activityRanking.activities) assert.equal(a.days.length, a.available ? 7 : 0);
      },
    ),
    { numRuns: 500 },
  );
});

test('cache keeps its contract over random timelines of clock jumps, outages and concurrent requests', async () => {
  const step = fc.record({
    hours: fc.integer({ min: 0, max: 60 }),
    failing: fc.boolean(),
    place: fc.constantFrom('Lisbon', 'Porto', 'Faro'),
    parallel: fc.integer({ min: 1, max: 4 }),
  });
  await fc.assert(
    fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 25 }), async (steps) => {
      const { upstream, clock, query } = setup();
      const fetchedAt = new Map<string, number>();

      for (const s of steps) {
        clock.now += s.hours * HOUR;
        upstream.failing = s.failing;
        const callsBefore = upstream.calls.forecast;
        const results = await Promise.all(Array.from({ length: s.parallel }, () => query(s.place)));
        const last = fetchedAt.get(s.place);
        const fresh = last !== undefined && clock.now - last < 3 * HOUR;

        if (fresh || !s.failing) {
          // Served from cache, or refetched exactly once no matter how many parallel requests.
          assert.equal(upstream.calls.forecast - callsBefore, fresh ? 0 : 1);
          if (!fresh) fetchedAt.set(s.place, clock.now);
          for (const r of results) {
            assert.equal(r.errors, undefined, JSON.stringify(r.errors));
            assert.equal(r.data.activityRanking.activities[0].days.length, 7);
          }
        } else {
          for (const r of results) assert.equal(r.errors?.[0].extensions.code, 'UPSTREAM_UNAVAILABLE', JSON.stringify(r));
        }
      }
    }),
    { numRuns: 300 },
  );
});
