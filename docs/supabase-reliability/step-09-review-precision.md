# Step 9: preserve review timestamp precision

The previous content-decision caller is deployed as `d81459f37ed8286381f56d5df9af0e9155aa87bc`; local and remote main matched, its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/9jDGiHBEgSWk6ys2RYYqWMuGHQQv) succeeded, and both health routes, protected administrator/account routes, RPC schema exposure and thirty readiness checks passed at 06:48:09–12 UTC on September 10, 2026.

## Finding and narrow plan

PostgreSQL selects a pending review first, then the latest `coalesce(reviewed_at, created_at)` at microsecond precision, then descending UUID. The administrator mapper used `Date.parse`, which discards fractional precision beyond milliseconds. Two completed reviews within one millisecond could therefore select different snapshots in the mapper and transaction. The transaction fails safely, but refreshing cannot resolve that false conflict.

Preserve the remaining three fractional digits in the server's ordering comparison. Keep timezone normalization, pending precedence, created-time fallback, UUID ties and raw snapshot strings. Do not change the deployed SQL, data, authorization, publication rules or review history. Existing invalid-date fallback remains unchanged; invalid or infinite snapshot timestamps remain rejected by the caller's version validator.

## Verification and recovery

Exercise the actual mapper and endpoint against the native PostgreSQL transaction for photo and social reviews, including same-millisecond timestamps, offsets, created-time fallback, dates before the epoch, equivalent instants and different milliseconds. Confirm the regression fails against the prior mapper and freshly loaded snapshots succeed after the fix. Run the full suite, lint, build, standalone TypeScript, migration guard, live readiness and read-only dependency checks. Commit and push only this change; verify exact Vercel success and production health before continuing.

No database migration or production decision is needed. Reverting this application commit restores the earlier safe-conflict behavior; it does not require data restoration. Other timestamp-dependent application behavior remains for the dedicated timestamp audit.

## Validation before delivery

All 118 focused tests passed, including twelve new native mapper/endpoint cases; eight fail against the prior mapper. All 4,632 automated tests, lint, production build, standalone TypeScript, migration guard and thirty live readiness checks passed. Postbuild skipped layout-review population. Read-only dependency checks at 06:52:14–16 UTC retained the frozen function, queue, social-save and ledger hashes, service-only execution, RLS and aggregate data counts. No migration was reapplied and no production decision was submitted. Exact push, Vercel success and deployed health remain required.
