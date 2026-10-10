# Discovery ranking

The homepage dancer grid and MyDancr TV request a private, two-hour ordering snapshot. The snapshot is bound to the visitor, page visit, city, venue, feed filter and selected video. Returning to a tab or fetching another page keeps that order. A new page visit gets a new ranking. Content visibility and venue presence are checked again when serving each page; removed content never becomes visible because it was previously ranked.

| Signal | Dancer grid | TV |
| --- | ---: | ---: |
| Availability | 35 | 20 |
| Visitor engagement | 25 | 20 |
| Fresh approved media | 20 | 20 |
| Follow relevance | 20 | 15 |
| Video watch quality | 0 | 25 |

Availability gives full credit to a current verified club check-in, 60% for a shift within 24 hours, and 30% for a shift within seven days. Expired check-ins do not score in new snapshots. The directory retains its Working Now and Not Working Now filters, with earned order within each group.

Freshness fades linearly over seven days. Dates are capped to a UTC day and one bonus per candidate; extra uploads on the same day cannot stack the boost. A grid profile uses its newest approved photo or published video; TV uses the video's publication date.

Engagement uses a visitor's action rate per recorded impression, not lifetime counts. Each visitor/item/day contributes at most one impression and one action to scoring, even when several action types occur. Fourteen days of observations decay with a seven-day half-life. Placement cohorts (positions 1–3, 4–12, and later) and 50 prior exposures smooth sparse samples. Viewing quality also compares duration bands (up to 10, 20, and 30 seconds).

One in five positions is available for exploration, prioritizing the least-exposed eligible candidates. TV uses six distinct dancers at the beginning when available, then avoids the previous three dancers where possible. An explicitly linked video stays first. Recently engaged-with videos receive 45% of their normal score for seven days. “Show less from this dancer” suppresses that dancer for 30 days across grid and TV, except an explicitly opened video. Explicit New and Following filters retain their meaning.

The candidate pool is bounded to 800 dancers, 50 videos per dancer, and 5,000 videos per visit. Dancer sampling rotates with the visitor/visit seed. Videos are sampled in rounds by dancer to prevent upload volume from consuming the whole pool. Existing profile and curated venue readers keep their existing ordering contracts.

## Event integrity and privacy

The service verifies an issued snapshot, identity, entity and position before accepting events. Impressions require visible cards or actual video playback. Engaged views require at least three seconds (or half of a shorter video), and completions require 90% distinct played coverage. Seeking, hidden tabs, covered players and replaying a short fragment do not accumulate completion coverage. The server also enforces elapsed-time floors, real follow records, daily uniqueness, self-activity exclusion for verified signed-in owners, and IP/subject rate limits. Browser telemetry cannot prove attention or fully prevent deliberate automation; unauthenticated visitors cannot reliably be identified as a profile owner.

Account/device identifiers are HMAC hashed on the server. The two new tables and ranking RPC are accessible only to the service role; public API responses expose placement receipts, not scores or visitor history. Events expire after 30 days, and expired snapshots are pruned after one additional day. Pruning runs at most once per day per active server instance. Retention is opportunistic while the service receives traffic.

Dancer Results explains current availability/freshness boosts and the remaining ranking factors. Its existing city activity rank is labeled separately because personalized discovery has no single universal position.

## Validation and delivery

Focused tests cover policy, real PostgreSQL migration execution through PGlite, privileges, event validation, session isolation, pagination and existing homepage behavior. No browser journeys or E2E tests are used. Migration `20261010034253_discovery_ranking.sql` was applied to the Dancr Supabase project before deployment. These tables are additive; previous public readers continue to work without ranking headers.
