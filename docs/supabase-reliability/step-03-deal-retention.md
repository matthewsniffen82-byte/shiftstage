# Step 3: relationship integrity and recoverable Club Deal removal

## Result

The live review found no orphaned references across all 195 public foreign keys, no missing primary keys, no SET NULL conflicts with required columns, and no mismatched profile roles, shift affiliations, or video/shift dancer ownership. All foreign keys are validated. One active dancer account lacks a profile; this is a reverse-provisioning finding, not a broken foreign key. An intentional admin profile deletion can retain its login. It requires the Step 7 provisioning/lifecycle review before any repair.

The existing `club_deals_liquor_free_check` remains NOT VALID with one inactive historical exception and zero active exceptions. No row or constraint was changed to force validation.

Fresh catalog capture: `2026-09-09T16:27:46.476096+00:00`. Additional aggregate checks: `2026-09-09T16:36:33.799001+00:00`. Queries ran in explicit read-only transactions with statement and lock timeouts. The 195 foreign-key definitions matched the initial inventory. Full aggregate evidence is in `step-03-relationship-results.json`; reusable additional checks are in `relationships-read-only.sql`. No private account records, emails, credentials or storage contents are included.

## Application hardening

Concurrent commit `cc1bf3d5` already replaced the admin hard-delete path with archival and enabled direct removal of both live and draft offers. Its archive fields and stale-editor protections are preserved. This audit does not claim that prior change as its own, and does not reinstate a pause-first requirement.

This change makes repeated removal recoverable. When the guarded archive update affects zero rows, the server reads the same deal under the same venue. It succeeds only if that row is already archived and inactive. A missing row returns 404; an inconsistent/unconfirmed state returns 409. Provider failures propagate without a hard-delete fallback or an automatic write retry. The original removal timestamp and linked history are preserved. This handles a lost response after commit, a failed subsequent catalog read, and another completed removal request.

Authorization remains in the existing active-admin API boundary. Both the write and retry confirmation are venue-scoped. No public/venue permissions, RLS policies, triggers, functions or database constraints changed. No migration is added or applied; the existing archive column and inactive-archive constraint were confirmed in the fresh catalog.

## Relationship and deletion review

- Auth/application and dancer/customer profile keys enforce referenced account existence and one profile per account. Reverse initialization is checked separately.
- Favorites, follows and venue affiliations have composite primary/unique keys. Photos, videos and schedules have required ownership references. Optional venue ownership preserves the venue through SET NULL.
- All 77 SET NULL foreign keys permit null in the affected column. The catalog also contains 85 CASCADE and 33 RESTRICT references; each definition and target remains mapped in the architecture inventory.
- Financial history has multiple deletion paths. The direct admin Club Deal path now archives. Account/profile deletion and the unused legacy venue deletion export still require the dedicated account-lifecycle review; no global cascade changes are inferred or applied.
- Polymorphic moderation/audit target IDs intentionally need context beyond a single FK. Deleted-target history is not automatically an orphan to remove. Storage object cleanup is separate from row-level cascades.

## PostgreSQL regression tests

The repository now includes PGlite through concurrent work. The new `admin-deal-retention-postgres.test.mjs` uses an empty in-memory PostgreSQL database and synthetic records. It loads the six captured foreign keys relevant to Club Deal retention. It demonstrates the destructive cascade/set-null result of the old DELETE inside a rolled-back local transaction, then executes the application removal function through a parameterized SQL adapter and verifies that archival retains the original relationships.

Tests cover live/draft removal, repeated and queued requests, a lost response after commit, failure before writing, failure during the post-commit catalog read, unconfirmed zero-row writes and cross-venue retry isolation. The existing admin API tests continue to verify authorization and stale-editor behavior. Queued operations in a single PGlite instance do not prove multi-connection transaction scheduling. The fixture is not full Supabase/Auth/Storage integration or historical migration replay.

Targeted result: 14 tests passed. The final complete suite passed all 2,973 tests with no failures, skips or cancellations. Full lint, explicit TypeScript and the production build exited successfully; postbuild skipped layout-review population. All 30 Supabase readiness checks passed again. Final application validation includes the browser-security update on `a777507f28d3c02d67c0bfc8f2f9e4c751259f19`. The final parent `1878d946e3fa9f5d5472ce3383a9540778adbf7a` changes only performance reports and measurement scripts; application/test/build inputs remain unchanged, and both changed scripts passed additional lint/syntax checks. The old local candidate was adapted to current main, preserving the concurrent live-offer removal behavior.

## Recovery and remaining work

No production data was changed by this audit. Reverting the new retry-confirmation code leaves the existing archive behavior intact; there is no database rollback or data restore to perform. Completed archives remain idempotent at the row level because the write requires `removed_at IS NULL`.

Step 2 historical replay remains deferred at the user's request. The one missing dancer profile, account/profile retention choices, and inactive historical CHECK exception remain explicit follow-ups. Step 3 must not be marked released until its exact commit is pushed, Vercel succeeds, and post-deployment health passes. The full 24-step audit is not complete.

After Git write access was restored, the candidate was synchronized with the browser-security update on `a777507f28d3c02d67c0bfc8f2f9e4c751259f19` and release checks were repeated. Local logs and the earlier candidate patch are preserved under `outputs/supabase-step03-release/`; these local output files are not part of the commit. The execution ledger records final validation and subsequent deployment evidence.
