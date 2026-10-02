# activity-forecast

GraphQL service. Give it a city, get the next 7 days ranked for skiing, surfing, outdoor and indoor sightseeing.
Weather from [Open-Meteo](https://open-meteo.com), cached in SQLite.

## Run

Node 24+ (runs TypeScript natively, no build step).

```sh
npm install
npm start            # http://localhost:4000/graphql (GraphiQL in dev)
```

```graphql
{
  activityRanking(place: "Lisbon") {
    location {
      name
      country
    }
    fetchedAt
    activities {
      activity
      status
      reason
      weeklyScore
      days {
        date
        score
        reasons
      }
    }
  }
}
```

```sh
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ activityRanking(place: \"Paris\", countryCode: \"US\") { activities { activity weeklyScore } } }"}'
```

```sh
npm test             # offline, ~7k generated cases
npm run check        # format + types + tests
```

Env: `PORT` (4000), `DB_PATH` (forecast.sqlite), `RATE_LIMIT` (60 req/min/IP), `NODE_ENV=production` turns GraphiQL off.

## What it does

- `place` -> Open-Meteo geocoding. Exact name wins, then population. `countryCode` narrows.
- Forecast + marine data, one row per local day, cached 3 h. Expired data is refetched; provider failure returns `UPSTREAM_UNAVAILABLE`.
- Each day scored 0-100 by simple rules, with reasons. Missing required inputs -> `score: null`.
- `SCORED`: all seven days assessed, ranked by their mean. `UNKNOWN`: missing inputs, `weeklyScore: null`.
- `UNAVAILABLE`: a known unmet condition (snow depth below 0.1 m for every day). No scores; reason supplied.
- Unknown and unavailable weeks rank after scored weeks. Missing wave data does not prove there is no sea.
- Errors: `BAD_USER_INPUT`, `PLACE_NOT_FOUND`, `UPSTREAM_UNAVAILABLE`. Anything else is masked.

## Code

```
src/openMeteo.ts   API client, response checks
src/cache.ts       SQLite cache: TTL, one upstream call per key
src/scoring.ts     rules, pure
src/app.ts         schema, resolver, input checks
src/server.ts      HTTP, rate limit, shutdown
test/              unit, integration (fake Open-Meteo), property tests
```

## Assumptions

Short version: rank = per-day score per activity, sorted by weekly mean; days are local to the place; thresholds are my guesses.
Full list with the questions I'd ask a PM: [docs/QUESTIONS.md](docs/QUESTIONS.md).

Decisions and what I left out on purpose: [docs/DECISIONS.md](docs/DECISIONS.md). How it got built: [docs/NOTES.md](docs/NOTES.md).
