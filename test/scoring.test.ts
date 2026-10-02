import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DayWeather } from '../src/openMeteo.ts';
import { rankActivities } from '../src/scoring.ts';

const day = (overrides: Partial<DayWeather> = {}): DayWeather => ({
  date: '2026-01-10',
  tempMax: 20,
  precipitation: 0,
  rain: 0,
  snowfall: 0,
  snowDepth: 0,
  windMax: 10,
  sunshine: 8 * 3600,
  waveHeight: null,
  wavePeriod: null,
  ...overrides,
});

const find = (week: DayWeather[], activity: string) => rankActivities(week).find((a) => a.activity === activity)!;

test('a pleasant dry day is perfect for outdoor sightseeing', () => {
  const outdoor = find([day()], 'OUTDOOR_SIGHTSEEING');
  assert.equal(outdoor.days[0].score, 100);
  assert.deepEqual(outdoor.days[0].reasons, []);
});

test('bad weather lowers outdoor and raises indoor, with reasons', () => {
  const rainy = [day({ precipitation: 12, rain: 12, sunshine: 0 })];
  const outdoor = find(rainy, 'OUTDOOR_SIGHTSEEING');
  const indoor = find(rainy, 'INDOOR_SIGHTSEEING');
  assert.equal(outdoor.days[0].score, 35);
  assert.deepEqual(outdoor.days[0].reasons, ['Heavy rain', 'Overcast']);
  assert.ok(indoor.weeklyScore! > outdoor.weeklyScore!);
});

test('missing marine data is unknown while a snowless week is unavailable, ranked last', () => {
  const ranking = rankActivities([day()]);
  assert.deepEqual(
    ranking.slice(2).map((a) => [a.activity, a.status, a.reason]),
    [
      ['SKIING', 'UNAVAILABLE', 'No snow cover forecast'],
      ['SURFING', 'UNKNOWN', 'Missing data for some days'],
    ],
  );
});

test('clean groundswell scores well for surfing, a flat sea does not', () => {
  const surf = find([day({ waveHeight: 1.8, wavePeriod: 11 }), day({ date: '2026-01-11', waveHeight: 0.2, wavePeriod: 4 })], 'SURFING');
  assert.deepEqual(
    surf.days.map((d) => d.score),
    [100, 5],
  );
  assert.equal(surf.weeklyScore, 53);
});

test('deep cold snow with fresh powder beats a rainy thaw for skiing', () => {
  const ski = find(
    [
      day({ tempMax: -4, snowDepth: 1.2, snowfall: 15 }),
      day({ date: '2026-01-11', tempMax: 7, snowDepth: 0.2, rain: 6, precipitation: 6 }),
    ],
    'SKIING',
  );
  assert.deepEqual(
    ski.days.map((d) => d.score),
    [100, 0],
  );
});

test('missing values cannot produce a score', () => {
  const blank = day({ tempMax: null, precipitation: null, windMax: null, sunshine: null });
  const result = find([blank], 'OUTDOOR_SIGHTSEEING');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.weeklyScore, null);
  assert.equal(result.days[0].score, null);
  assert.deepEqual(result.days[0].reasons, ['Missing weather data']);
});

const required: [string, (keyof DayWeather)[]][] = [
  ['SKIING', ['snowDepth', 'tempMax', 'rain', 'windMax', 'snowfall']],
  ['SURFING', ['waveHeight', 'wavePeriod', 'windMax']],
  ['OUTDOOR_SIGHTSEEING', ['precipitation', 'tempMax', 'windMax', 'sunshine']],
  ['INDOOR_SIGHTSEEING', ['precipitation', 'tempMax', 'windMax', 'sunshine']],
];

for (const [activity, fields] of required) {
  for (const field of fields) {
    test(`${activity} cannot be scored without ${field}`, () => {
      const complete = day({ snowDepth: 1, waveHeight: 1.5, wavePeriod: 10 });
      const result = find([complete, { ...complete, date: '2026-01-11', [field]: null }], activity);
      assert.equal(result.status, 'UNKNOWN');
      assert.equal(result.weeklyScore, null);
      assert.notEqual(result.days[0].score, null);
      assert.equal(result.days[1].score, null);
      assert.ok(result.days[1].reasons.length > 0);
    });
  }
}

test('unknown snow depth does not prove a snowless week', () => {
  const result = find([day(), day({ date: '2026-01-11', snowDepth: null })], 'SKIING');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.weeklyScore, null);
  assert.equal(result.days.length, 2);
});
