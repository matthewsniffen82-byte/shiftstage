# Main-photo hair-color analytics

Venue Results includes a collapsed **Hair-color performance** report for the selected Tonight, 7-day or 30-day range. Internal covers table requests and their current outcomes. External covers explicitly venue-and-dancer-attributed profile opens, club opens, directions, offer and transport clicks, Going signals, pass claims and verified admissions. These are activity counts, not unique customer totals, causal findings, or dancer ratings. Distinct dancer counts provide group sample sizes; a dancer who changes photos can belong to several groups.

## Photo analysis and history

- Approved gallery photo writes and internal main-photo selections refresh each channel's effective photo. Public uses the explicitly primary approved photo. Internal follows `internalMainPhotos`: an explicit approved choice, otherwise the public primary, then the stable approved gallery fallback. This feature does not change or auto-fill any photo choice.
- Each photo ID/storage-path revision has one private job shared by channels using that photo. Changing or removing a main photo closes its half-open history period. Late results only update their original job, never the current photo or a newer revision.
- The authenticated `/api/cron/main-photo-analysis` worker runs every minute, claims at most four jobs with leases, and analyzes approved stored photos using the existing OpenAI account and `gpt-4.1-mini`. Responses use a strict two-field schema and `store: false`. Only color, confidence, model and queue metadata are retained; no image copies or embeddings are created.
- Colors: black, brown, blonde, red/auburn, gray/white, vivid, multicolor, unknown. Confidence below 0.8, obscured hair and ambiguous lighting produce Unknown. Temporary failures retry up to three attempts; stale leases recover after two minutes. Scanning never participates in approval or blocks an upload waiting for AI.
- New photo choices are tracked from deployment onward. Existing photos are not bulk-scanned and prior appearance is never invented. Activity without a recorded analyzed photo remains Unknown. Pending scans can later classify activity from that same photo's period; subsequent photos cannot relabel it.
- Admissions use the main photo at pass claim time, with admission counts selected by redemption time. Table outcomes use the photo at request time. Other actions use their event time.
- Deleted image files are not retained for this feature. Completed color estimates remain in history for reporting; deletion of the dancer profile cascades through analysis and history. Unprocessed deleted photos become unavailable.

## Access and deployment

The three new tables have RLS and no public or authenticated grants. All helper functions are invoker functions with an empty search path and service-role-only execution. Source photo tables already restrict writes to server workflows. `getVenueDashboard` resolves venue access before either report RPC; the client receives aggregates, never private paths, confidence values, job IDs or guest identities.

Apply `20261012225032_venue_hair_color_analytics.sql` before the app deployment. No new secret is required: `CRON_SECRET`, Supabase service credentials and `OPENAI_API_KEY` are already used by moderation workers. Verify the new RPC, grants and RLS with read-only SQL and inspect Supabase advisors. The worker returns processed/failed counts and logs sanitized failure metadata; never log source image contents.

Focused checks: `tests/venue-hair-color-postgres.test.mjs`, `tests/hair-color-worker.test.mjs`, `tests/venue-performance-service.test.mjs`, and `tests/venue-admin-presentation.test.mjs`. PGlite and in-memory service/component fixtures cover actual SQL history/aggregation, lease recovery, unknown results, authorization, and UI channel selection. No E2E journeys.
