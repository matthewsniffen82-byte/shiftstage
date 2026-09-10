# Step 10: use bounded TV metric totals

The foundation was pushed as `ab0a1078d928b2397593d03d7f410bdf1ff52ece`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/4md3FapwozqYfp1Q5yqaXU86VUK2) succeeded. Health/readiness/authorization checks passed at 11:03:51–54 UTC on 2026-09-10, with matching main references. The committed migration `20260910105400` is applied and frozen.

Read-only verification at 11:02:37 UTC confirmed function MD5 `f7c115daa49ec58ad85ff8cdd4d65e12`, ledger source MD5 `572e4360051937c83437c7e8c301d8f2`, service-only execution, stable/invoker settings and the three unchanged event indexes. The API exposes the function, returns an empty result for an empty selected list and rejects an anonymous request. Existing events, account/video records, permissions, constraints, triggers, 125 functions and 108 prior ledger entries were preserved.

## Controlled caller change

Replace the owner/venue helper's raw event selection with the deployed aggregate. Use only the video IDs already selected by the authorized workspace. Validate UUIDs, deduplicate them and request at most 100 IDs per sequential batch with one common thirty-day cutoff. Empty lists make no request. Retain parallel signing/analytics startup in the owner workspace and all existing video ownership, visibility, publication and signing rules.

Require an object containing exactly the selected video IDs. Accept only the existing event types and nonnegative safe-integer totals. Fill existing zero metrics explicitly. Missing, malformed, foreign-video or failed responses must not appear as valid zero totals; do not fall back to the capped raw query. Stop after a failed batch instead of returning partial analytics.

Verify the actual helper against native SQL, including more than 1,000 events, batch boundaries, deduplication, empty selections, unknown keys, missing totals, invalid numeric values and transport errors. Retain the actual owner/venue call sites and existing workspace signing tests. Run the full release checks, preserve the frozen SQL, commit/push only this caller step and verify exact Vercel/health before continuing the performance audit.

## Verification

All 81 focused checks pass: forty new caller tests, thirty-five native aggregate tests and six existing workspace-signing tests. The actual owner workspace receives 1,600 native events while retaining its owner/dancer filters and batch signing. The helper returns exact counts for 5,500 events and bounds a 251-video historical selection to 100/100/51 IDs. Failure cases reject partial or malformed totals and stop subsequent requests.

Fresh read-only database/API checks at 11:17:04 UTC on 2026-09-10 confirmed the frozen function and migration fingerprints, service-only permissions, RLS and unchanged event indexes. The empty selected-list RPC returned `{}`; anonymous execution returned 401. No SQL was reapplied or private event rows retrieved. Full validation and exact deployment verification remain required.

Full validation passed all 5,320 automated tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks. The production build skipped layout-review population as intended. Exact commit/push, matching main references and Vercel/health verification remain the release gates. Rollback is a caller-code revert; retain the backward-compatible aggregate and its frozen migration.
