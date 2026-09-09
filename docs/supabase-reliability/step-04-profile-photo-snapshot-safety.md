# Step 4: profile-save photo snapshot safety

## Inspection and plan

This controlled change starts after `5652eb3c7529e34751929e792406287cfaa7d86a` was pushed and its exact Vercel deployment succeeded. At 22:44 UTC both health routes passed, four protected upload/moderation routes denied unauthenticated requests and all thirty readiness checks passed. The previous release passed 3,133 tests, lint, build and standalone TypeScript.

`PATCH /api/dancer/profile` still contains an older URL-based photo writer. It can insert pending rows from submitted URLs, broadly clear primary flags, reorder existing photos and delete pending rows inferred from occupied positions. Those operations bypass the new publisher's locks and exact replacement identity. A stale URL snapshot can therefore recreate or reposition media, and position-based cleanup can race a newer approval.

Current routed and live-shell editors upload through the moderated photo API. Their profile-save requests contain identity/social fields and explicit deleted photo IDs, not main/gallery URL publication instructions. The older URL fields can remain compatible as read-only snapshots of media already belonging to the dancer; they must not authorize new rows, ordering, primary changes or implicit deletion.

1. Before any profile/social/deletion write, validate any nonempty legacy URL snapshot against the authenticated dancer's stored photo paths. Permit known snapshots without writing media. Reject unknown/foreign/deleted paths with a useful refresh/upload instruction; do not silently claim a new photo was saved.
2. Remove the URL insertion/reordering and slot-inferred pending cleanup. Keep explicit ID deletion, moderated uploads, profile fields, socials and submission behavior.
3. Test current requests with no URL fields, recognized raw/public/legacy paths, duplicates, unknown and foreign paths, deleted-result retries, provider read failures and rejection before other profile writes.
4. Run the complete suite, lint, production build, standalone TypeScript and live readiness/authentication-boundary checks. Review the diff, commit only this step, push main and verify its exact deployment and health before proceeding.

No SQL migration, production data repair or historical media cleanup is part of this change. Keep legacy rows; remove only the obsolete writer. Primary-promotion and general admin/maintenance concurrency remain separate review work before table-level uniqueness is considered.

## Implementation and recovery

The guard runs immediately after loading the authenticated dancer's profile, before identity, social, submission or deletion writes. Requests without URL fields perform no additional query. Recognized raw storage keys, encoded public URLs and existing legacy external URLs remain compatible. Read failures propagate, and paths outside the dancer's current library return HTTP 409. A known snapshot accompanying explicit photo IDs does not itself delete anything. Existing profile-response formatting is retained.

The obsolete URL insertion, broad primary/order updates, inferred pending deletion and duplicate-URL cleanup are removed. No existing rows are rewritten or repaired. The canonical upload, exact-ID deletion and atomic publication paths remain responsible for media changes. Fourteen targeted tests cover compatibility, ownership, read failures, deleted-result retries, early rejection and profile-response presentation.

This is an application-only release: no schema, ledger, storage bucket or production-data rollback is required. Reverting this commit restores the old writer and its known races, so a forward fix is preferable if a compatibility issue is discovered. Preserve unrelated browser-session and pending-upload-identity changes when reverting or deploying. Authenticated production profile saves and real-media uploads are not performed as tests; synthetic route tests and read-only production health/readiness checks provide the release evidence.

## Validation

Final validation on `686743648d7a46bcbb41c9b46993db2cca20f115` passed all 3,209 tests with no failures, skips or cancellations, full lint, the production build and standalone TypeScript. The suite used three workers after the standard generators. All fourteen new snapshot/presentation tests passed. Concurrent browser-session and pending-upload-identity fixes were preserved and the complete checks repeated after each integration. An initial build caught a still-used display helper; it was restored before the successful final checks. The build skipped layout-review population. All thirty live Supabase readiness checks passed. No production account, media or schema mutation was used for testing. Exact push, Vercel success and post-deployment health remain the final release gates.

The final push encountered concurrent security commit `4c7ae4d5f244633e88a4572076a5b5235acd1cc1`. The task commit was rebased without dropping its strict callback and normalized local-return-path protections. Full validation was repeated on that integrated parent: all 3,260 tests, full lint, production build, standalone TypeScript and all thirty live readiness checks passed. The earlier 3,209-test result remains historical; this 3,260-test run is the release result. The final task diff still contains only the profile handler, its two test files and these two reliability documents.
