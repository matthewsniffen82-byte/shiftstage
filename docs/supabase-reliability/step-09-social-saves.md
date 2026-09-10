# Step 9: social-link saves and review requests

Counter-notice caller `fa645e259ec490e01a88d280d78e6ee236c7fb2f` was pushed with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/2Sebx7kqBWnGGg2Fa6pAcH7T7eUR). Production health, protected routes, RPC exposure and thirty readiness checks passed at 05:31:19–23 UTC on 2026-09-10.

## Inspected risk and plan

Profile PATCH separately reads existing social fields, upserts links, enqueues reviews and clears inactive links. A queue failure leaves new content saved; retrying can see unchanged content and omit the review. An explicit submitted-platform list can also replace, rather than supplement, the changed-platform list. Existing uniqueness protects dancer/platform and pending reviews but does not join those writes.

First deploy an unused service-only invoker function with empty search path and bounded locks. Validate up to five canonical links, authenticate the active owner, serialize account/profile/link access, and save links plus pending reviews in one transaction through the existing queue helper. Changed links always require a pending review; explicit resubmissions supplement them. Unchanged saves preserve timestamps and do not create extra reviews. Inactive links are cleared only when submitted; absent inactive links are not invented. Preserve IDs, created times, completed review history, omitted platforms and all unrelated fields. Reject duplicate platforms and malformed inputs before writes. No retries, deletion compensation, publication changes or provider calls.

The 05:41:03 UTC read-only inspection found twelve socials, twenty reviews, sixteen profiles and twenty-nine accounts. Target tables have no user triggers. Capture all columns, constraints, enum labels and the exact nested queue definition; its MD5 is `29b2215964595c56f4339424df7e2a85`. Its service-only access must remain unchanged. Existing public social visibility depends on profile eligibility and active link state; this release preserves that behavior.

Test actual SQL with captured schema and synthetic references: owner/role/state gates, all platforms, changed/reactivated/inactive/omitted links, explicit submissions, duplicate requests, completed history, malformed input, foreign profiles and injected write/queue failures. Local PGlite queued calls do not replace deferred hosted multi-connection tests. Full suite/lint/build/TypeScript, guarded exact migration delivery, read-only preservation/access checks, exact Vercel success and deployed health are required before the caller changes.

## Limits and rollback

The existing administrator review path separately updates targets and all matching historical review rows, with no content-version guard. That requires the next independent transaction review; this release does not claim to fix it. Inactive/deleted-target review retirement belongs to lifecycle handling. Profile identity/media changes outside this social batch remain separate. A delayed retry after a newer intentional edit retains existing last-write-wins behavior; no new version or hidden client retry policy is introduced.

This migration only adds an unused function. Keep it in place during application rollback. Correct issues through a reviewed forward migration; never replay historical migrations, clear reviews or overwrite production social records to test recovery.

## Validation before delivery

All 55 new PostgreSQL tests and all 4,479 automated tests passed, along with full lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. The fixture retains all sixteen target columns, six constraints, two enums, the exact pending-review index and nested queue function. The deployment wrapper passed local transaction, repeated-version and schema-drift rejection rehearsals. It also rejects a changed or newly browser-accessible nested helper and compares existing data, access, catalog definitions, public functions and historical ledger before/after the additive migration. Postbuild skipped layout-review population.

Expected migration SHA-256 is `dcb5937cd13feca1a4a9ad4dc5094df0170b9b61989d26f9c8c86632241c536d`; new function MD5 is `6a29da79d7399da38b32fc3d753753af`. Exact push, committed SQL application, read-only preservation/permissions, Vercel success and production health remain required before caller changes.
