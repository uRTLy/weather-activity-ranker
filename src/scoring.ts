import type { DayWeather } from './openMeteo.ts';

export const ACTIVITIES = ['SKIING', 'SURFING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING'] as const;

// [field it reads, does it apply?, points added to the base score, reason shown to the user].
// A missing (null) value never triggers a rule: no data is not bad weather.
type Rule = [keyof Omit<DayWeather, 'date'>, (value: number) => boolean, number, string];
// `unavailable` = impossible here this week (no sea, no snow), which is different from bad weather.
type Profile = { base: number; rules: Rule[]; unavailable?: (week: DayWeather[]) => string | false };

const OUTDOOR: Rule[] = [
  ['precipitation', (mm) => mm >= 5, -50, 'Heavy rain'],
  ['precipitation', (mm) => mm >= 1 && mm < 5, -25, 'Showers'],
  ['tempMax', (c) => c < 5, -30, 'Cold'],
  ['tempMax', (c) => c > 32, -30, 'Very hot'],
  ['windMax', (kmh) => kmh > 40, -25, 'Windy'],
  ['sunshine', (s) => s < 2 * 3600, -15, 'Overcast'],
];

// Thresholds are first-pass judgement calls (docs/QUESTIONS.md) - tune them here, nowhere else.
const PROFILES: Record<(typeof ACTIVITIES)[number], Profile> = {
  SKIING: {
    base: 100,
    unavailable: (week) => !week.some((d) => (d.snowDepth ?? 0) >= 0.1) && 'No snow cover forecast',
    rules: [
      ['snowDepth', (m) => m < 0.3, -40, 'Thin snow cover'],
      ['tempMax', (c) => c > 5, -30, 'Thaw softens the snow'],
      ['rain', (mm) => mm > 1, -30, 'Rain on snow'],
      ['windMax', (kmh) => kmh > 50, -40, 'Strong wind, lifts may close'],
      ['snowfall', (cm) => cm >= 5, 10, 'Fresh snow'],
    ],
  },
  SURFING: {
    base: 100,
    unavailable: (week) => week.every((d) => d.waveHeight === null) && 'No sea at this location',
    rules: [
      ['waveHeight', (m) => m < 0.5, -70, 'Flat sea'],
      ['waveHeight', (m) => m >= 0.5 && m < 1, -30, 'Small waves'],
      ['waveHeight', (m) => m > 3.5, -40, 'Big, powerful waves'],
      ['wavePeriod', (s) => s < 7, -25, 'Short-period wind swell'],
      ['windMax', (kmh) => kmh > 35, -30, 'Strong wind'],
    ],
  },
  OUTDOOR_SIGHTSEEING: { base: 100, rules: OUTDOOR },
  // Weather-proof, and more appealing the worse it is outside: outdoor rules mirrored at 60%.
  INDOOR_SIGHTSEEING: { base: 60, rules: OUTDOOR.map(([field, when, pts, why]): Rule => [field, when, -pts * 0.6, `${why} outdoors`]) },
};

const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)));

// Day score = base + matching rules; weekly score = mean of days. Best week first, unavailable last.
export function rankActivities(week: DayWeather[]) {
  return ACTIVITIES.map((activity) => {
    const { base, rules, unavailable } = PROFILES[activity];
    const reason = unavailable?.(week);
    if (reason) return { activity, available: false, reason, weeklyScore: null, days: [] };

    const days = week.map((d) => {
      const hits = rules.filter(([field, when]) => d[field] !== null && when(d[field]));
      return { date: d.date, score: clamp(hits.reduce((sum, [, , pts]) => sum + pts, base)), reasons: hits.map(([, , , why]) => why) };
    });
    return { activity, available: true, reason: null, weeklyScore: clamp(days.reduce((sum, d) => sum + d.score, 0) / days.length), days };
  }).sort((a, b) => (b.weeklyScore ?? -1) - (a.weeklyScore ?? -1));
}
