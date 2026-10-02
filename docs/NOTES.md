# Notes

Working log, 28.09.2026.

## How I worked

Paired with an AI coding assistant (Claude Code). I set scope and direction and reviewed each step; it drafted code,
probed the API and wrote tests. Where I steered:

- Asked for a plan before any code, then cut it down twice: less code, no layers for their own sake.
- Rejected treating missing weather values as 0 ("no temperature" was scoring as "Cold").
- Asked for a security pass, then for generated tests over lots of odd data to find what we missed.
- Asked to keep the Open-Meteo client free of GraphQL.

## Plan (upfront)

Things in the brief that need a decision:

1. A city name is not a place ("Paris" is also in Texas).
2. "Ranks how good the next 7 days will be for each activity" can be read three ways. See QUESTIONS.md.
3. Skiing and surfing depend on the place, not just the weather. "No sea" is not a 0.
4. Storage and refresh are called out as part of the problem.

First plan: service/resolver/store layers, zod, vitest, 0.1° grid, stale-while-revalidate.
Kept the ideas, dropped the layers and libraries.

## Log

In the order it happened. Commits were grouped by area at the end, so their timestamps don't show this.

- Probed Open-Meteo before writing rules. Marine API returns all `null` inland: free "no sea" signal. Geocoding sorts by population.
  `snow_depth_max` exists daily, no hourly aggregation needed.
- Client, cache, scoring, GraphQL. 10 tests, fake `fetch` and clock, no network.
- Cut: zod, vitest, layers, background refresh. ~300 -> 210 lines.
- Grid 0.1° -> 0.01°: 0.1° is ~11 km, enough to change a mountain town's elevation or put a coastal point inland.
- Security pass: input allow-list, alias cap, upstream checks, rate limit, timeouts.
  Hit two copies of `graphql` (armor on 16, Yoga on 17): armor errors got masked as "Unexpected error". Pinned 16.
- Property tests (fast-check) + live sweep of 105 places. Found:
  - no `country` for Nuuk, Longyearbyen, Pago Pago, Majuro -> whole response failed. Made nullable.
  - Open-Meteo down with nothing cached -> generic internal error. Now `UPSTREAM_UNAVAILABLE`.
  - "Venice" -> Dayton, OH; "Bali" -> a town in India (alternate names + population sort). Now exact name first.
  - live data had no nulls in weather fields; handled anyway.
- Also covered while writing those tests: an outage longer than the cached week left an empty week and a NaN score. Same error now.
- Nulls: rules now read one field each and skip on `null`.
- Prettier.

## If I had more time

Ask the PM the questions first. Then: `language` hint for geocoding, candidates for ambiguous names,
best-day vs mean as an option, metrics on cache hit rate and upstream latency.

## 02.10.2026 — missing-data scoring

Review reproduced a perfect surfing week with a missing marine day, and perfect sightseeing scores with missing temperature.
Changed the API from `available` to `SCORED`, `UNKNOWN`, or `UNAVAILABLE`. Missing required inputs leave the day and weekly
scores unknown; complete days keep their scores. Kept the four scoring functions. Deferred resort lookup and the separate
provider/date-validation fixes.
