import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOUR, setup } from './fake.ts';

test('ranks activities for 7 local days, best first', async () => {
  const { query } = setup();
  const { data } = await query('Lisbon');
  const ranking = data.activityRanking;
  assert.equal(ranking.location.name, 'Lisbon');
  assert.deepEqual(
    ranking.activities.map((a: any) => a.activity),
    ['SURFING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING', 'SKIING'],
  );
  assert.equal(ranking.activities[0].days.length, 7);
  assert.equal(ranking.activities[0].days[0].date, '2026-01-10');
});

test('serves repeat and concurrent requests from one upstream fetch', async () => {
  const { upstream, query } = setup();
  await Promise.all([query('Lisbon'), query('lisbon '), query('Lisbon')]);
  await query('Lisbon');
  assert.equal(upstream.calls.forecast, 1);
  assert.equal(upstream.calls.marine, 1);
});

test('an expired forecast is refetched', async () => {
  const { upstream, clock, query } = setup();
  await query('Lisbon');
  clock.now += 4 * HOUR;

  const { data } = await query('Lisbon');
  assert.equal(upstream.calls.forecast, 2);
});

test('does not return a partial week when Open-Meteo is down', async () => {
  const { upstream, clock, query } = setup();
  await query('Lisbon');
  clock.now += 48 * HOUR;
  upstream.failing = true;

  const { errors } = await query('Lisbon');
  assert.equal(errors[0].extensions.code, 'UPSTREAM_UNAVAILABLE');
});

test('unknown places return a typed error', async () => {
  const { query } = setup();
  const { errors } = await query('Nowhereville');
  assert.equal(errors[0].extensions.code, 'PLACE_NOT_FOUND');
});

test('rejects malformed input before any upstream call', async () => {
  const { upstream, query } = setup();
  for (const place of ['', 'x'.repeat(101), '<script>', 'Paris; DROP TABLE cache']) {
    const { errors } = await query(place);
    assert.equal(errors[0].extensions.code, 'BAD_USER_INPUT', place);
  }
  assert.equal(upstream.calls.geocoding, 0);
});

test('does not cache an incomplete upstream forecast', async () => {
  const { upstream, query } = setup();
  const complete = upstream.forecast;
  upstream.forecast = (dates) => ({ time: dates });
  assert.equal((await query('Lisbon')).errors[0].extensions.code, 'UPSTREAM_UNAVAILABLE');
  upstream.forecast = complete;
  assert.equal((await query('Lisbon')).errors, undefined);
  assert.equal(upstream.calls.forecast, 2);
});

test('rejects malformed values and misaligned marine dates before caching', async () => {
  const { upstream, query } = setup();
  const weather = upstream.forecast;
  upstream.forecast = (dates) => ({ ...weather(dates), temperature_2m_max: dates.map(() => 'warm') });
  assert.equal((await query('Lisbon')).errors[0].extensions.code, 'UPSTREAM_UNAVAILABLE');

  upstream.forecast = weather;
  const marine = upstream.marine;
  upstream.marine = (dates) => ({ ...marine(dates), time: dates.map(() => '2026-01-01') });
  assert.equal((await query('Lisbon')).errors[0].extensions.code, 'UPSTREAM_UNAVAILABLE');

  upstream.marine = marine;
  assert.equal((await query('Lisbon')).errors, undefined);
  assert.equal(upstream.calls.forecast, 3);
});

test('reports malformed geocoding results as a provider error', async () => {
  const { upstream, query } = setup();
  upstream.place = () => ({ name: 'Lisbon', latitude: NaN, longitude: -9, timezone: 'UTC' });
  assert.equal((await query('Lisbon')).errors[0].extensions.code, 'UPSTREAM_UNAVAILABLE');
});

test('prefers an exact name match over a bigger fuzzy one', async () => {
  const { upstream, query } = setup();
  const at = (name: string, country: string, population: number) => ({
    name,
    country,
    population,
    latitude: 45,
    longitude: 12,
    timezone: 'UTC',
  });
  upstream.place = () => [
    at('Dayton', 'United States', 135_512),
    at('Bāli', 'India', 1),
    at('Venice', 'Italy', 51_298),
    at('Venice', 'United States', 22_211),
  ];
  assert.equal((await query('venice')).data.activityRanking.location.country, 'Italy');
  assert.equal((await query('Bali')).data.activityRanking.location.country, 'India');
  assert.equal((await query('Springfield')).data.activityRanking.location.name, 'Dayton'); // no exact match: API order
});

test('a missing marine day has no score and cannot produce a perfect weekly score', async () => {
  const { upstream, query } = setup();
  const marine = upstream.marine;
  upstream.marine = (dates) => {
    const data = marine(dates);
    data.wave_height_max[1] = null;
    data.wave_period_max[1] = null;
    return data;
  };

  const { data, errors } = await query('Lisbon');
  assert.equal(errors, undefined);
  const surfing = data.activityRanking.activities.find((a: any) => a.activity === 'SURFING');
  assert.equal(surfing.status, 'UNKNOWN');
  assert.equal(surfing.days.length, 7);
  assert.equal(surfing.days[1].score, null);
  assert.ok(surfing.days[1].reasons.length > 0);
  assert.equal(surfing.weeklyScore, null);
  assert.equal(surfing.days[0].score, 100);
  const outdoor = data.activityRanking.activities.find((a: any) => a.activity === 'OUTDOOR_SIGHTSEEING');
  assert.equal(outdoor.status, 'SCORED');
  assert.equal(outdoor.weeklyScore, 100);
});

test('missing weather inputs cannot produce a perfect sightseeing score', async () => {
  const { upstream, query } = setup();
  const forecast = upstream.forecast;
  upstream.forecast = (dates) => ({ ...forecast(dates), temperature_2m_max: dates.map(() => null) });

  const { data, errors } = await query('Lisbon');
  assert.equal(errors, undefined);
  for (const activity of ['OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING']) {
    const result = data.activityRanking.activities.find((a: any) => a.activity === activity);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.days.length, 7);
    assert.equal(result.weeklyScore, null);
    for (const day of result.days) {
      assert.equal(day.score, null);
      assert.ok(day.reasons.length > 0);
    }
  }
});

for (const marineDays of [6, 7, 9]) {
  test(`rejects different row counts (8 weather, ${marineDays} marine) before caching and recovers`, async () => {
    const { upstream, query } = setup();
    const marine = upstream.marine;
    upstream.marine = (dates) => marine([...dates, '2026-01-18'].slice(0, marineDays));

    const rejected = await query('Lisbon');
    assert.equal(rejected.errors?.[0].extensions.code, 'UPSTREAM_UNAVAILABLE');

    upstream.marine = marine;
    const recovered = await query('Lisbon');
    assert.equal(recovered.errors, undefined);
    const surfing = recovered.data.activityRanking.activities.find((a: any) => a.activity === 'SURFING');
    assert.equal(surfing.status, 'SCORED');
    assert.equal(surfing.days.length, 7);
    assert.equal(surfing.weeklyScore, 100);
    assert.equal(upstream.calls.forecast, 2);
    assert.equal(upstream.calls.marine, 2);
  });
}
