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

test('no sea and no snow make surfing and skiing unavailable, ranked last', () => {
  const ranking = rankActivities([day()]);
  assert.deepEqual(
    ranking.slice(2).map((a) => [a.activity, a.available, a.reason]),
    [
      ['SKIING', false, 'No snow cover forecast'],
      ['SURFING', false, 'No sea at this location'],
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

test('missing values trigger no rules', () => {
  const blank = day({ tempMax: null, precipitation: null, windMax: null, sunshine: null });
  assert.deepEqual(find([blank], 'OUTDOOR_SIGHTSEEING').days[0].reasons, []);
});
