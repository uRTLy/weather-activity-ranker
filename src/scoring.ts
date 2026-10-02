import type { DayWeather } from './openMeteo.ts';

export const ACTIVITIES = ['SKIING', 'SURFING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING'] as const;

type Effect = [points: number, reason: string];
const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
const scored = (date: string, base: number, effects: Effect[]) => ({
  date,
  score: clamp(base + effects.reduce((sum, [points]) => sum + points, 0)),
  reasons: effects.map(([, reason]) => reason),
});

function outdoorEffects(d: DayWeather): Effect[] {
  const effects: Effect[] = [];
  if (d.precipitation !== null && d.precipitation >= 5) effects.push([-50, 'Heavy rain']);
  else if (d.precipitation !== null && d.precipitation >= 1) effects.push([-25, 'Showers']);
  if (d.tempMax !== null && d.tempMax < 5) effects.push([-30, 'Cold']);
  if (d.tempMax !== null && d.tempMax > 32) effects.push([-30, 'Very hot']);
  if (d.windMax !== null && d.windMax > 40) effects.push([-25, 'Windy']);
  if (d.sunshine !== null && d.sunshine < 2 * 3600) effects.push([-15, 'Overcast']);
  return effects;
}

function scoreOutdoor(d: DayWeather) {
  return scored(d.date, 100, outdoorEffects(d));
}

function scoreIndoor(d: DayWeather) {
  const effects = outdoorEffects(d).map(([points, reason]): Effect => [-points * 0.6, `${reason} outdoors`]);
  return scored(d.date, 60, effects);
}

function scoreSkiing(d: DayWeather) {
  const effects: Effect[] = [];
  if (d.snowDepth !== null && d.snowDepth < 0.3) effects.push([-40, 'Thin snow cover']);
  if (d.tempMax !== null && d.tempMax > 5) effects.push([-30, 'Thaw softens the snow']);
  if (d.rain !== null && d.rain > 1) effects.push([-30, 'Rain on snow']);
  if (d.windMax !== null && d.windMax > 50) effects.push([-40, 'Strong wind, lifts may close']);
  if (d.snowfall !== null && d.snowfall >= 5) effects.push([10, 'Fresh snow']);
  return scored(d.date, 100, effects);
}

function scoreSurfing(d: DayWeather) {
  const effects: Effect[] = [];
  if (d.waveHeight !== null && d.waveHeight < 0.5) effects.push([-70, 'Flat sea']);
  else if (d.waveHeight !== null && d.waveHeight < 1) effects.push([-30, 'Small waves']);
  else if (d.waveHeight !== null && d.waveHeight > 3.5) effects.push([-40, 'Big, powerful waves']);
  if (d.wavePeriod !== null && d.wavePeriod < 7) effects.push([-25, 'Short-period wind swell']);
  if (d.windMax !== null && d.windMax > 35) effects.push([-30, 'Strong wind']);
  return scored(d.date, 100, effects);
}

// The four functions above own their activity rules. This function only builds and sorts the weekly response.
export function rankActivities(week: DayWeather[]) {
  const profiles = [
    { activity: 'SKIING', scoreDay: scoreSkiing, unavailable: !week.some((d) => (d.snowDepth ?? 0) >= 0.1) && 'No snow cover forecast' },
    { activity: 'SURFING', scoreDay: scoreSurfing, unavailable: week.every((d) => d.waveHeight === null) && 'No sea at this location' },
    { activity: 'OUTDOOR_SIGHTSEEING', scoreDay: scoreOutdoor, unavailable: false },
    { activity: 'INDOOR_SIGHTSEEING', scoreDay: scoreIndoor, unavailable: false },
  ] as const;

  return profiles
    .map(({ activity, scoreDay, unavailable }) => {
      if (unavailable) return { activity, available: false, reason: unavailable, weeklyScore: null, days: [] };
      const days = week.map(scoreDay);
      return {
        activity,
        available: true,
        reason: null,
        weeklyScore: clamp(days.reduce((sum, day) => sum + day.score, 0) / days.length),
        days,
      };
    })
    .sort((a, b) => (b.weeklyScore ?? -1) - (a.weeklyScore ?? -1));
}
