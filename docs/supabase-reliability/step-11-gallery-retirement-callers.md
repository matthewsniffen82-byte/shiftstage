# Step 11: guarded gallery cleanup callers

## Previous release

Foundation `111ea6dab0c48d1744adad1f6e9a892cd68aad5f` was pushed and its [exact deployment](https://vercel.com/ai-movie-jobs/shiftstage/BWZBGxDbDmeYEREnnDMC6BVUYDH8) succeeded. Its committed additive migration passed guarded application and preservation/security checks; read-only health/readiness passed at 13:09:24–29 UTC on 2026-09-10. All 5,557 tests, lint, build and standalone TypeScript passed. There were zero production retirement claims; existing business and storage records were preserved.

## Inspected issue and bounded plan

The existing gallery publication cleanup checks references and then deletes bytes, leaving a race between those operations. Owner photo/avatar removal, avatar replacement/recentering and admin photo/profile cleanup also directly remove public gallery bytes. Connect only those physical cleanup calls to the deployed retirement RPC. Do not change the database migration, metadata deletion or account lifecycle in this correction.

Require a matching profile/path, permanent retirement UUID and timestamp before deleting the master, its responsive variants, then its private original. A retained receipt performs no storage operation. A failed or malformed RPC receipt never falls back to direct deletion. Validate storage SDK deletion acknowledgments, allow empty/subset acknowledgments for already absent objects, reject foreign or malformed names, and stop subsequent cleanup after uncertainty. Permanent markers remain for explicit operational retry; there is no automatic repeated write or marker removal.

Metadata operations already acknowledged by their existing callers stay acknowledged if optional byte cleanup fails; log a generic retained-cleanup event. Admin callers retain their warnings mechanism. This is not proof that the existing multi-write metadata lifecycle is atomic or fully acknowledged. Photo path/version deletion guards, avatar/moderation removal transactions, private review/temp cleanup, and account/DMCA lifecycle remain separate corrections.

The deployed RPC deliberately recognizes only canonical gallery masters. Actual avatar uploads use an additional `/avatar/` directory, so those paths will be retained pending a separately tested additive path-contract change. Do not widen the deployed migration in place or bypass its rejection. Shared gallery masters used as avatars are protected now. No retrospective orphan deletion, production upload, claim, delete, or account mutation is a test.

## Required verification

Exercise actual cleanup code with the native deployed retirement functions and triggers, synthetic storage responses, current references, late publishers, unknown paths, lost acknowledgments, partial deletion and explicit retries. Verify caller integration, including admin paths, and preserve publication replay behavior. Run the complete suite, lint, production build, standalone TypeScript, migration checks and thirty read-only readiness checks. Capture read-only data/access/ledger fingerprints before and after release. Commit only this correction, push, verify matching main references, exact Vercel success and deployed health before continuing.

Rollback must retain permanent database retirement markers and reference guards. Disable cleanup or forward-fix its caller if needed; do not roll back to blind storage deletion or remove markers after claims.

## Verification evidence

The actual retirement gateway passes 56 tests using the native foundation functions and triggers, actual responsive/original path mapping and synthetic storage transport. Cases cover shared master/variant references across gallery/avatar/moderation, a late rejected publisher, unmatched history and path formats, malformed or lost retirement receipts, two-phase storage failures, missing-object retries, and publication replay preservation. Twenty additional actual owner/admin caller cases cover the confirmed, retained, failed and malformed retirement boundaries after metadata operations; all twenty fail against the prior caller implementation.

Publication acknowledgment tests retain explicit cleanup stubs for their isolated boundary, while the new native tests exercise the real gateway. Two earlier admin source-contract assertions still expected direct file deletion; they now require the guarded cleanup call and preserve their ownership, billing, audit and login-retention checks. No assertion was removed to permit unsafe cleanup.

Build, standalone TypeScript, lint, migration checks and thirty readiness checks passed. Read-only verification confirms the deployed retirement function definitions, RLS and permissions. The final full-suite rerun and exact release/preservation/health gates remain required.

The final complete suite passed all 5,633 tests with zero failures or skipped tests. Lint was rerun after the test-contract changes; production build and standalone TypeScript passed, with postbuild population explicitly skipped. No migration or production business/storage mutation was performed. Exact commit/push, matching main references, deployment success and fresh preservation/health checks remain the release gates.
