# Step 9: administrator content-review decisions

Social caller `e0fcd3437cfef53af6c78db081e1cff6f1ae669f` is pushed with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/H16v37vVgTsA9bvcQfgZzNBC5dKf). Both health routes, protected profile/account/admin denials, server RPC exposure and thirty readiness checks passed at 06:01:37–39 UTC on 2026-09-10.

## Inspected issue and controlled plan

`reviewSubmissionContent` separately changes a photo, recalculates its profile summary, updates every review with the target's type, inserts an audit action and sends notifications. This rewrites completed history. Any failure can leave a partially recorded decision. Social links reuse IDs when edited, so an administrator's stale page can approve content that was never viewed. Concurrent/retried decisions have no expected-version guard.

First deploy an unused service-only invoker function with empty search path, bounded locks and UTC timestamps. Validate the active administrator inside the transaction. Lock the profile, target and its reviews in consistent order, then compare the expected target fields and selected review supplied from the loaded administrator view. Include social updated time; normalize timestamp values in SQL so timezone formatting does not create false conflicts. Pending review takes precedence over completed history. Missing or stale snapshots fail without writes.

For a pending request, record only that review's decision. If there is no pending request, append a new completed decision and preserve prior history. Commit photo status, the existing photo-summary calculation, review decision and mandatory audit together. Preserve profile publication/account/venue/verification fields, photo positions/pins and social active state. Existing active-photo uniqueness guards remain authoritative. Keep optional notification storage/provider delivery outside this transaction, and make later caller failures truthful.

A repeated old snapshot conflicts after a committed decision, preventing duplicate decision/audit writes without a new receipt table. The caller must tell the reviewer to refresh after an uncertain result and never retry invisibly. A new deliberate decision after a refreshed snapshot can append history. This is optimistic concurrency protection, not an exactly-once external-message guarantee.

## Production evidence, verification and rollback

Read-only inspection at 06:05:56 UTC found 72 photos, twelve socials, twenty reviews, 168 actions, sixteen profiles and twenty-nine accounts. Capture all 55 columns and constraints across profiles/photos/socials/reviews/actions, current indexes and both profile triggers. Neither existing profile trigger is activated by changing only `photo_review_status`; preserve both definitions. The social-save and queue functions remain frozen. No production decision is used as a test.

Test actual SQL with captured schema and synthetic account/venue references, completed history, active-position conflicts, pending precedence, stale targets/reviews, same-snapshot races, timestamp offsets/precision, role/state denial and injected failures at each write. PGlite queued calls do not replace deferred hosted multi-connection tests. Run full suite, lint, build, TypeScript, readiness and guarded committed SQL deployment; verify data/access/catalog/helper preservation, exact Vercel success and production health before caller changes.

The migration only adds an unused function. Keep it during application rollback; use a reviewed forward migration for corrections. No destructive history repair, table reset or data rewrite. Existing public-social visibility rules and wider profile-level approval logic are unchanged and remain separate audit boundaries.

## Validation before delivery

All 54 new PostgreSQL cases and all 4,573 automated tests passed, along with full lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. Target fixtures retain 55 columns, eighteen constraints, thirteen indexes and both exact profile triggers; related account/venue/alias references are synthetic projections. Postbuild skipped layout-review population.

The guarded deployment passed local transaction, repeat-version and schema-drift rejection rehearsals. It checks exact target columns, constraints and triggers, both existing content-function fingerprints, and before/after data/access/catalog/function/ledger preservation. Expected source SHA-256 is `911a97c634d97b4f6603a507532bf80113f794a557ed23f31f2a92bb0430eb5a`; new function MD5 is `98ca354aa34c4128586778fbe839535f`. Exact committed application, push, read-only permissions/data verification, Vercel success and production health remain required before callers change.
