# Step 9: atomic whole-profile administrator reviews

The prior precision fix was pushed as `e913c86fd902a6f5a70e9d965d77ddf450284ca1`, with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/4Tp42dAk13NQv1Rch9ovBYm4Y2E2). Health, protected routes, RPC exposure and thirty readiness checks passed at 06:57:23–26 UTC on September 10, 2026.

## Inspected production behavior

`reviewDancerProfile` calls the existing publication transition, inserts profile review history, reads issue summaries, then separately inserts the administrator audit and notification. Any later failure reports failure after a persisted state change. Repeating the action can append duplicate history. The current UI exposes rejection; the existing API also accepts approval, which leaves the profile pending and private rather than activating it.

Read-only preflight at 06:58:59 UTC captured 16 profiles, 29 accounts, twenty reviews, 168 audit entries, 72 photos and twelve social links. It confirmed the new function is absent and captured the current publication transition definition and fingerprint `0c6d40bbafb36514bb03a65b4efb3e49`. Existing target columns, constraints, indexes and triggers are compared with the content-decision fixture before reuse.

## Narrow additive plan

Add an unused service-only, invoker transaction. Revalidate and lock the active administrator, then lock the dancer account before its profile, matching the existing publication transition's lock order. Require the administrator's loaded profile snapshot, retaining timestamps at database precision and comparing timestamp values rather than formatting. A changed profile conflicts before writes. Call the existing publication transition inside this transaction, then append the profile review and mandatory administrator audit. Check the actual persisted state and every returned write receipt; suppressed or failed writes roll everything back.

Keep the existing transition frozen, including venue activation requirements, administrative and DMCA suspension markers, disabled-account behavior and private pending approval behavior. Preserve earlier review/audit history and all media. Advance the profile version on every successful review so repeating an old snapshot cannot create another decision. Optional notifications stay outside this transaction for a later caller integration.

## Validation and recovery

Use the captured PostgreSQL schema and exact nested transition in local tests. Cover both decisions, each stale snapshot field, equivalent timestamp offsets, inactive/non-administrator actors, missing/changed accounts, suspension preservation, old-snapshot retries, fresh intentional decisions and errors or suppressed writes at every write point. Validate service-only execution and unchanged dependencies. Run the full suite, lint, production build, standalone TypeScript, migration guard and live readiness.

Apply only exact committed additive SQL through a guarded transaction with source/ledger checks, schema guards and before/after data/catalog/permission fingerprints. Do not invoke a production business decision. Verify exact push, Vercel success, deployed health and read-only SQL hashes/access before integrating the caller. An unused function can remain during application rollback; no record restoration or destructive rollback is needed. Historical migration replay and hosted destructive tests remain deferred.

The snapshot covers profile identity, review/publication state and suspension/venue markers. Concurrent changes to individual media are independently versioned by their content-review transactions; this function does not approve or reject individual media or grant venue activation.

## Validation before delivery

All fifty new PostgreSQL tests and all 4,682 automated tests passed. Full lint, production build, standalone TypeScript, migration guard and thirty live readiness checks passed; postbuild skipped layout-review population. The captured 55 columns, eighteen constraints, thirteen indexes, two triggers and enums match the existing fixture. The guarded deployment passed transaction, repeated-version and schema-drift rejection rehearsals. Exact push, committed SQL application, read-only preservation/access checks and Vercel/health gates remain required. Existing application callers are unchanged in this release.
