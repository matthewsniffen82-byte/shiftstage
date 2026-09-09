# Step 4: gallery decision and cleanup follow-up

## Issue and resulting behavior

The atomic caller integration landed concurrently as `cfa033300507aa6a2eaed1f10a34c833014de5b5` and was merged before this follow-up. Its exact Vercel deployment succeeded and both health routes passed at 22:32 UTC. That release already removes slot-inferred publication and protects terminal decisions and pending deletion. This follow-up strengthens the remaining gaps: competing updates to a still-pending review, incomplete replay/result validation, shared predecessor storage and private-source loss during a pointer update.

The existing service-only `publish_approved_dancer_gallery_photo` transaction remains unchanged. New additions receive a free slot under the profile lock; replacements retain the durable exact photo ID. This follow-up validates the returned owner, photo/review relationship, status, path and position, and returns the committed ID, position and focal metadata on replay. There is no separate-write fallback or automatic publication retry.

The record creation response already includes its database version. Automatic results now carry that version into pending/rejected/error updates after asynchronous analysis. Retry workers conditionally advance the exact pending version and pass the returned version to publication. A stale result returns a useful conflict instead of overwriting another worker's newer pending state. Existing terminal guards, duplicate-key recovery and conditional pending deletion remain. The proposed next timestamp is strictly later than the captured timestamp, including multiple updates within the same millisecond; the caller uses the returned database timestamp if a trigger changes it.

The administrator queue's approve/reject controls appear only for pending reviews. The separate, existing content-review path in `reviewDancerSubmissionContent` remains available for moderation of published photos. This release does not remove that capability or redesign avatar publication.

## Recovery and storage

A completed gallery retry verifies and returns the transaction's existing result without another upload. Deleted or inconsistent results are rejected rather than silently resurrected. An uncertain publication retains public/private files and uses version-guarded diagnostic bookkeeping; it never compensates with destructive photo/file deletion.

Moving an image into private review now copies the bytes first, acknowledges the versioned record-pointer update, then removes the original. A failed or lost pointer-update response preserves both copies. A failed gallery provider retry retains its source for later recovery.

Only acknowledged publication permits superseded-file cleanup. Cleanup checks remaining gallery/avatar references and skips paths outside the owner's directory, shared files and uncertain lookups. Storage errors are sanitized and do not turn a committed approval into a reported failure. This is bounded per-operation cleanup, not a historical orphan purge. Files retained after uncertainty still require the reference-aware reconciliation work in the storage/recovery audit.

## Validation and live preflight

Twelve additional native PostgreSQL/application-gateway tests cover queued additions, lost-response replay, stale terminal decisions, worker-version claims, competing rejection/publication, deleted results, malformed success responses, missing versions and cleanup failures. Existing SQL rollback, exact replacement, privilege and owner-isolation tests remain. Ten additional moderation-lifecycle tests exercise delayed provider results, pointer-write failures before/after commit, confirmed private-source cleanup and retry version propagation. Existing gallery fault tests now expect transaction rollback/commit outcomes; avatar and recentering tests remain.

PGlite uses queued requests in one embedded instance. These are real SQL/transaction regression tests with application-boundary fault injection, not a multi-connection production load test. No real account, email, photo publication/deletion or storage modification is used for testing.

At 22:27 UTC on 2026-09-09, read-only catalog checks confirmed that the deployed function and ledger exactly match migration `20260909203842`, SHA-256 `819e7b9651aacb26fa480416b1ec67c23f331feddfceb53e64b7584065e63301`. It remains SECURITY INVOKER, service-executable, inaccessible to browser roles, with the intent constraint validated and all three relevant tables retaining RLS. All thirty readiness checks passed. At 22:28 UTC, an anonymous null-input RPC was denied with 401/42501; the service null-input request was rejected with 400/22023 before any row lookup or mutation.

Full final suite, lint, production build, standalone TypeScript and exact commit/deployment health are release gates recorded in the execution ledger. No new migration or production repair is included.

## Rollback and remaining scope

Retain the deployed additive columns/function and all media data. Prefer rolling back a defective application caller with a reviewed forward fix. Reverting to the earlier application implementation reintroduces its multi-request races, so it is an emergency availability fallback rather than an integrity fix. Do not drop columns/functions, rewrite historical SQL, replay migrations or delete retained media to roll back this release.

The generic content-review path and maintenance/import writers still need their publication/slot assumptions reviewed before adding broader table-level slot uniqueness. Avatar publication remains a separate workflow. Step 4, the full RLS audit, authentication/recovery testing and the rest of the 24-step audit are not declared complete by this release. Historical migration replay remains deferred at the user's request.
