import type { DatabaseSync } from 'node:sqlite';
import { GraphQLError } from 'graphql';
import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor';
import { createSchema, createYoga, maskError } from 'graphql-yoga';
import { createCache } from './cache.ts';
import { createOpenMeteo, unavailable, UpstreamError } from './openMeteo.ts';
import { rankActivities } from './scoring.ts';

const HOUR = 3_600_000;
// Allow-list: letters in any script, digits and the punctuation real place names use (L'Aquila, Saint-Étienne).
const PLACE = /^[\p{L}\p{M}\p{N} .,'’()-]{1,100}$/u;
const COUNTRY = /^[A-Za-z]{2}$/;

const typeDefs = /* GraphQL */ `
  enum Activity {
    SKIING
    SURFING
    OUTDOOR_SIGHTSEEING
    INDOOR_SIGHTSEEING
  }

  type Query {
    "Next 7 local days. Ambiguous names pick the most populous match; countryCode (e.g. PL) narrows."
    activityRanking(place: String!, countryCode: String): ActivityRanking!
  }

  "Activities sorted best week first."
  type ActivityRanking {
    location: Location!
    fetchedAt: String!
    activities: [ActivityForecast!]!
  }

  type Location {
    name: String!
    country: String
    latitude: Float!
    longitude: Float!
    timezone: String!
  }

  "available = false means impossible here (no sea, no snow), not bad weather; reason says which."
  type ActivityForecast {
    activity: Activity!
    available: Boolean!
    reason: String
    weeklyScore: Int
    days: [DayScore!]!
  }

  type DayScore {
    date: String!
    score: Int!
    reasons: [String!]!
  }
`;

// 0.01° (~1 km) is finer than any model grid: dedupes lookups without changing the forecast.
// Coarser keys would share entries between towns but skew mountain elevation and coastlines.
const gridKey = (n: number) => Math.round(n * 100) / 100;
const localDate = (timeZone: string, ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(ms); // YYYY-MM-DD

// Everything with side effects is injected, so tests run offline with a fake clock.
type Deps = { db: DatabaseSync; fetch?: typeof globalThis.fetch; now?: () => number };

export function createApp({ db, fetch = globalThis.fetch, now = Date.now }: Deps) {
  const meteo = createOpenMeteo(fetch);
  const cached = createCache(db, now);

  async function activityRanking(_: unknown, args: { place: string; countryCode?: string | null }) {
    const place = args.place.trim();
    const countryCode = args.countryCode?.toUpperCase();
    if (!PLACE.test(place) || (countryCode && !COUNTRY.test(countryCode))) {
      throw new GraphQLError('place must be 1-100 letters; countryCode two letters', { extensions: { code: 'BAD_USER_INPUT' } });
    }
    // Places don't move: keep a month. Forecast models update every few hours: keep 3 h.
    const geoKey = `geo:${place.toLowerCase()}|${countryCode ?? ''}`;
    const { value: location } = await cached(geoKey, 30 * 24 * HOUR, async () => {
      const found = await meteo.geocode(place, countryCode);
      if (!found) throw new GraphQLError(`No place found for "${place}"`, { extensions: { code: 'PLACE_NOT_FOUND' } });
      return found;
    });
    const [lat, lon] = [gridKey(location.latitude), gridKey(location.longitude)];
    const forecast = await cached(`wx:${lat},${lon}`, 3 * HOUR, () => meteo.forecast(lat, lon));

    const today = localDate(location.timezone, now());
    const week = forecast.value.filter((d) => d.date >= today).slice(0, 7);
    if (week.length !== 7) unavailable(`forecast for ${lat},${lon} does not cover seven days`);
    return {
      location,
      fetchedAt: new Date(forecast.fetchedAt).toISOString(),
      activities: rankActivities(week),
    };
  }

  return createYoga({
    schema: createSchema({ typeDefs, resolvers: { Query: { activityRanking } } }),
    // Each alias can cost upstream calls, so cap them; armor also bounds depth, cost and query size.
    plugins: [EnvelopArmorPlugin({ maxAliases: { n: 3 } })],
    graphiql: process.env.NODE_ENV !== 'production', // dev-only playground at /graphql
    // Provider faults become one retryable code; everything else stays masked as an internal error.
    maskedErrors: {
      maskError: (error, message, isDev) =>
        error instanceof GraphQLError && error.originalError instanceof UpstreamError
          ? new GraphQLError('Weather provider unavailable, try again later', {
              path: error.path,
              extensions: { code: 'UPSTREAM_UNAVAILABLE' },
            })
          : maskError(error, message, isDev),
    },
  });
}
