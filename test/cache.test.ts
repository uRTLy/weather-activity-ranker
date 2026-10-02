import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOUR, setup } from './fake.ts';

test('persisted forecasts survive an app restart and still expire on schedule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-forecast-'));
  const path = join(dir, 'forecast.sqlite');
  try {
    const first = setup(path);
    let ranking;
    try {
      const { data, errors } = await first.query('Lisbon');
      assert.equal(errors, undefined);
      ranking = data.activityRanking;
    } finally {
      first.close();
    }

    const restarted = setup(path);
    try {
      restarted.clock.now += HOUR;
      restarted.upstream.failing = true;
      const { data, errors } = await restarted.query('Lisbon');
      assert.equal(errors, undefined);
      assert.deepEqual(data.activityRanking, ranking);
      assert.deepEqual(restarted.upstream.calls, { geocoding: 0, forecast: 0, marine: 0 });

      restarted.clock.now += 3 * HOUR;
      const expired = await restarted.query('Lisbon');
      assert.equal(expired.errors?.[0].extensions.code, 'UPSTREAM_UNAVAILABLE');
      assert.deepEqual(restarted.upstream.calls, { geocoding: 0, forecast: 1, marine: 1 });
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
