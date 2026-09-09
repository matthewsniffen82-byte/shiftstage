# Step 6 — Supabase request efficiency

Step 5 was pushed as `b9ca4140fae0b14f656a87fa4bff21a7974ea679` and [deployed successfully](https://vercel.com/ai-movie-jobs/shiftstage/F6aMciXAAQtpJrGN4XwJvEqdU3ye). Live filter/scroll and three-role dashboard checks passed. Startup formatter construction fell 179 → 3; per-tap construction fell 177–183 → 0–2. Median synchronous tap work fell 176.55 → 98.25 ms (44.4%). The home interaction proxy fell 712 → 560 ms. Home LCP varied 1,336 → 1,436 ms; venue LCP 1,420 → 1,380 ms. Page weight was effectively unchanged. No universal paint/scroll timing improvement is claimed; all six deployed samples had no JavaScript errors or critical failed requests. The delivery archive contains raw and summarized runs.

## Audit and baseline

- Public discovery/profile access already selects named fields, bounds directory/media/shift rows and runs independent hydration operations concurrently. Public dancer/venue counts use aggregated RPCs; ranking reads use bounded batches with tested outage handling. No per-dancer fallback query was introduced.
- Public TV already signs media URLs in a batch and overlaps independent photo/avatar queries. Its publication, verification, disabled-account, expiry and venue checks remain intact.
- The owner TV workspace instead signed every selected video separately, **after** waiting for analytics. The admin review queue also signed each of its up-to-100 selected videos separately.
- The actual server loaders executed against an instrumented SDK fixture made **50 signing requests for a 50-video owner workspace** and **100 for a 100-row admin queue**. Database-query counts were 3 and 1. These are deterministic request counts, not measurements of production private-data latency.
- Existing migration indexes cover dancer/status/city, dancer/venue shift starts, public video status/publication, dancer video creation, admin review status/submission and video-event lookup. No production query plan was available in this session; no speculative indexes or migrations were added. There are no added realtime subscriptions.
- The existing 30-day TV analytics reader returns raw event rows and may encounter the backend row cap on high-volume accounts. Server-side aggregation merits a separate verified migration; this pass preserves analytics rather than inventing totals or changing a production database without a query plan.

## Change and checks

Use the existing Supabase batch-signing API for already-authorized workspace/review rows, deduplicate paths and cap each request at 100 paths. Match responses by storage path, not array position. Preserve the one-hour expiry, private bucket, selected rows/order, eligibility checks and empty URL on an unavailable object. Empty workspaces make no Storage request. Owner analytics and signing can run concurrently after the scoped video query succeeds.

The same fixture now makes **one** signing request for either workspace (98%/99% fewer), with identical returned rows, URLs, metrics and expiry. Tests cover reversed response order, an individual unavailable object, Storage outage, missing/rejected owner queries, empty lists, duplicates, historical oversized lists and independent analytics/signing startup. RLS, route authentication/admin authorization and database queries are unchanged. Public read-only API/media probes establish adjacent health/latency baselines; production checks are repeated after deployment without accessing real private accounts.

No new vendor, dependency, recurring cost, public caching of private URLs, or security-policy change is part of this step.

All 2,127 automated tests, TypeScript, lint, migration guard and the production build passed before commit. Exact-commit deployment health, public API/media probes, anonymous private-route rejection and the three-role browser regression journey are required before proceeding to Step 7.

The initial push was rejected because the concurrent authorization release `5db6de15` reached main first. The step was rebased without overwriting it, then **all 2,307 tests**, TypeScript, lint, migration guard and the production build passed again. No force push is used.
