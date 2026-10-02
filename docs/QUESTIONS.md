# Questions for a PM

Question -> what I assumed.

1. **What does "rank" mean?** Days per activity, activities for the week, or both?
   -> Both. Each assessed day gets a 0-100 score; missing required inputs leave it unknown. Complete weeks are sorted by mean.
2. **Weekly = mean or best day?** A skier may only need one good day.
   -> Mean of all seven days. If any day is unknown, the weekly score is also unknown.
3. **Ambiguous city** ("Paris", "Springfield")?
   -> Exact name match first, then the most populous. `countryCode` narrows. Alternative: return candidates and let the client pick.
4. **Activity unavailable or data missing** (surfing in Warsaw)?
   -> `UNAVAILABLE` only for a known unmet condition; `UNKNOWN` for missing inputs. Both rank after scored weeks.
   Null marine data is not proof of no sea. Skiing is unavailable when every day has known snow depth below 0.1 m.
5. **Is indoor sightseeing weather dependent?**
   -> Weather-proof, and more attractive when it is bad outside. Base 60, outdoor penalties mirrored at 60%.
6. **Whose "next 7 days"?**
   -> Local days at the place, today included.
7. **How fresh must data be?**
   -> 3 h. If Open-Meteo is down after expiry, return a retryable error rather than a partial week.
8. **Scoring thresholds?**
   -> My guesses (e.g. waves 1-3.5 m, rain >= 5 mm is heavy). Would want a surfer and a ski ops person to review. No skill levels.
9. **Surfing on lakes?** Open-Meteo has marine data for big lakes (Chicago gets a surf score).
   -> Left as is.
10. **Who calls this?** Affects auth, CORS, rate limits.
    -> Public, anonymous, any origin.
11. **Place names in other scripts** (Москва, 東京)?
    -> English / Latin names. Open-Meteo only finds those with a matching `language` hint; not exposed yet.
