# Step 9: import finalization bookkeeping

## Inspection and scope

The import endpoint publishes/moderates a video, reloads its status, then separately updates its private batch note and inserts an audit action. A failure between those last two writes leaves incomplete bookkeeping. The note write has no expected-version check; retries prepend duplicate markers and can return an earlier status. Preparation preservation shipped separately as `d27b110034a422decd745dbcc082e83dc10c228a`.

Read-only production inspection on 2026-09-10 at 07:44 UTC found 34 videos, 168 audit actions and 29 application users. Capture both complete target table definitions, constraints, indexes and triggers for native PostgreSQL tests. The status-notification trigger and link-validation trigger are column-specific: a review-note-only update must not run publication notifications or alter links.

## Controlled plan

1. Add an unused service-only, security-invoker RPC. Revalidate the active administrator and lock the video; compare the loaded status, review text, identity, storage path and review/moderation timestamps at database precision.
2. Keep every existing video field except the private review note unchanged. Prefix the current batch/status once, preserving the existing text. Commit that note and a mandatory audit receipt in one transaction.
3. Fingerprint the resulting normalized version in the audit text. Under the video lock, an identical replay returns the original audit receipt without another write. A different version conflicts. This protects this RPC's retries; it does not claim that unrelated legacy writers are idempotent.
4. Use a short lock timeout, explicit permissions and failure-injection tests. No storage, notification, publication, account, payout, RLS or existing-trigger changes.
5. Run the full release checks, commit/push only this foundation, apply its exact committed additive SQL in a guarded preservation transaction, and verify deployment and read-only health before switching the caller in a separate release.

## Recovery and limits

Application callers remain unchanged during the foundation release. Roll back the later caller to stop using the function; leaving an unused additive function is safe. Do not undo historical audit records or delete media as compensation. Do not replay older migrations. Significant schema drift aborts deployment for inspection. Publication, moderation and file processing still precede bookkeeping and cannot be rolled back by this SQL transaction. A later caller must distinguish their confirmed result from an unconfirmed finalization receipt. Hosted concurrent-session and account/email tests remain deferred; local SQL tests are not described as those hosted tests.

## Local verification

All 62 new PostgreSQL cases pass. The fixture retains 45 target columns, 21 constraints, nine indexes and both original triggers. Related account/profile/venue/shift/notification tables are explicitly synthetic projections. Tests cover rollback and suppressed/malformed writes, immutable video fields, no publication notifications, identical original/returned-version replay, stale reviews, all video statuses, microsecond timestamps and unauthorized roles. Concurrent promises use one serialized local engine and are not a hosted multi-session test.

The exact deployment wrapper passes application, repeated-ledger rejection and schema-drift rejection rehearsals. PostgreSQL 18's deparser flattens one equivalent AND grouping in the legacy dimensions check; only the local rehearsal comparison accounts for that known formatting difference. Production PostgreSQL 17 comparisons retain the exact captured constraint definition. No production data has been modified in this inspection/testing phase.

Full validation passed 4,823 automated tests, lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. Layout-review population was skipped by the production build. Exact push, committed migration application, preservation/permissions checks, Vercel success and deployed health remain required before the caller integration.
