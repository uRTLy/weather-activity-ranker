# Decisions

## 02.10.2026 review: validate before storing

The first review found that an array of strings passed the old length check and could be cached as weather. Keep the small hand-written parser, but check dates, numeric values, and marine/weather date alignment before writing to SQLite. Malformed provider data becomes `UPSTREAM_UNAVAILABLE`.

Remaining gaps: date checks only validate string shape, and invalid geocoding
candidates or timezones can become internal errors. Fix these separately from scoring.

## 02.10.2026 review: require matching forecast rows

A shorter marine response passed date alignment because the check only visited its own rows. Require equal weather and marine
row counts before joining or caching. Missing values in a present row stay `null`; a missing row is a malformed response and
returns `UPSTREAM_UNAVAILABLE`. Chose this next because otherwise incomplete provider data remains cached for 3 h. Keep
geocoding and calendar validation as separate fixes.

## 02.10.2026 review: require a full week

A two-day-old cached forecast returned only six days during an outage. Drop stale fallback: an expired forecast is refreshed, and a failed refresh returns `UPSTREAM_UNAVAILABLE`. Also check for exactly seven local dates before ranking. This removes the `stale` field and keeps one clear response contract.

## 02.10.2026 review: one scoring function per activity

Replace the generic rule table with four named functions. The scores and thresholds stay the same in this change; the existing tests check that. Each activity's conditions are now readable in one place, which will make the next missing-data fix easier to review.

## Stack

Node 24 with native TypeScript (no build), GraphQL Yoga, `node:sqlite` (no native deps, one-command setup), `node:test` + fast-check.
Prettier for formatting. No ESLint: strict `tsc` covers most of it at this size.

## Storage

One key-value table: `key, fetched_at, data (JSON)`. Every read is "whole thing by key", so columns buy nothing yet.
We store parsed daily rows, not raw API responses, and score on read. Changing rules needs no refetch or migration.

## Cache key

Forecasts are keyed by coordinates rounded to 0.01° (~1 km), not by name. "Kraków" and "Krakow" share an entry.
0.01° is finer than any model grid, so no accuracy loss. Considered 0.1°: shares more, but can move mountain towns
to a different elevation and coastal towns inland.

## Freshness

- Forecast: 3 h (models update every few hours). Geocoding: 30 days.
- Expired -> refetch. Refetch fails -> return `UPSTREAM_UNAVAILABLE`.
- Concurrent requests for one key share one upstream call.
- Dropped stale-while-revalidate (serve old, refresh in background): more code, saves ~0.3 s once per 3 h per place.

## Scoring

- Four scoring functions own the activity rules in one file.
- Required inputs: sightseeing uses temperature, precipitation, wind and sunshine; surfing uses wave height, wave period and wind;
  skiing uses snow depth, temperature, rain, wind and snowfall.
- Missing required input -> day score `null`, with a reason. Complete days retain their scores.
- `SCORED`: all seven days assessed; weekly score = their mean. Otherwise `UNKNOWN`, with no weekly score.
- `UNAVAILABLE`: known snow depth below 0.1 m for every day; no day scores. Missing snow data cannot establish this.
- Missing wave data means unknown, not proof of no sea. Unknown and unavailable weeks sort after scored weeks.

## Errors

Client sees `BAD_USER_INPUT`, `PLACE_NOT_FOUND` or `UPSTREAM_UNAVAILABLE` (retry later). The Open-Meteo client throws
its own `UpstreamError`, `app.ts` maps it; the client does not know about GraphQL. Everything else is masked.

## Security

- Input allow-list: `place` letters (any script), digits, `.,'’()-`, max 100. `countryCode` two letters.
- graphql-armor: max 3 aliases (each can mean upstream calls), plus depth/cost/token limits.
- SQL via prepared statements only.
- Numeric columns and basic response shape checked before caching; the remaining date and geocoding gaps are listed above.
- Per-IP rate limit, request timeout, 10 s upstream timeout, graceful shutdown. GraphiQL off in production.

## Known, left out on purpose

- **No cache eviction.** Rows are small and keys bounded by real places. When needed: a periodic `DELETE WHERE fetched_at < ?`.
- **Rate limit sees the proxy, not the client, behind a load balancer.** The real limit belongs at the gateway.
  `X-Forwarded-For` is only trustworthy when our own proxy sets it, so not read here. Limit is also per instance.
- **No schema validation lib (zod).** Hand checks on the few fields we use. Worth it with more endpoints.
- **CORS open, introspection on.** Public API, nothing secret in the schema. Revisit once we know the clients.
- **Not built:** auth, metrics/tracing, Docker/deploy, CI, prewarming popular cities, hourly "best window",
  finding the nearest coast for towns slightly inland, `language` hint for non-Latin names.
- **Data quirks seen live:** "McMurdo" resolves to Canada; some places have no country (Nuuk, Pago Pago) - `country` is nullable.
