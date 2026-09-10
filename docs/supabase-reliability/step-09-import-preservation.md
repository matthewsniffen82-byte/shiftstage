# Step 9: preserve media when import preparation fails

The whole-profile caller `a08f680c8a884c88592ad75612c9c00becf50749` was pushed with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/B6fRRMaVjpfKocw7Un2iKSaU6WLr). Health, protected routes, RPC schema exposure and thirty readiness checks passed at 07:24:49–53 UTC on September 10, 2026.

## Inspected risk and narrow plan

The administrator import endpoint's `replaceExisting` path calls `hideOwnMyDancrTvVideo` before creating replacement uploads. That helper removes video bytes, posters and archived originals before hiding metadata. A failed new preparation can therefore destroy working media. The shipped import script always sends `replaceExisting: false`.

Block bulk replacement with a typed conflict before any profile/video query or media mutation. Keep append imports and their existing capacity limits. Do not present deletion of existing videos as automatic recovery advice. A safe future replacement needs staged uploads and an explicit confirmed replacement transaction; do not enable it by merely moving destructive calls later in the loop.

Preparation also deletes newly prepared files and metadata after marker or audit errors, despite uncertain acknowledgments or parallel uploads. Remove that destructive compensation. Track known prepared IDs before marker writes, check marker ownership/status/receipt and the audit acknowledgment, and return a typed unconfirmed result with sanitized operator diagnostics if preparation cannot be confirmed. Retain metadata and bytes for reconciliation. Do not send signed upload credentials in errors or logs.

Await both async action handlers inside the route's existing try/catch so rejected preparation/finalization promises reach its safe API error policy. Keep authentication, active administrator checks, constant-time import-key verification and bounded bodies. No production import or media deletion will be used for testing.

## Verification and limits

Exercise actual endpoint handlers with stateful synthetic queries and simulated storage/creation/marker/audit failures, including response loss after commit. Verify replacement stops before any media access, successful append still works, uncertain rows/files survive, no fallback deletion occurs, and auth/key errors remain safe. Update obsolete source assertions; run full suite, lint, build, standalone TypeScript, migration/readiness checks and exact commit/push/Vercel/health gates.

This release deliberately blocks the unsafe bulk replacement option; it does not implement staged replacement. Failed preparation can retain reservations without a client state file and requires operator reconciliation. Batch identity still uses application checks rather than a durable unique batch claim; simultaneous preparation and automated resume remain separate failure-recovery work. Video deletion lifecycle and finalized import bookkeeping are still audited separately. No schema migration is needed.

## Validation before delivery

All forty focused checks passed, including 32 new stateful endpoint failure cases. The complete suite passed all 4,761 tests, with lint, production build, standalone TypeScript, migration guard and thirty live readiness checks passing. Postbuild skipped layout-review population. Read-only inspection at 07:32:18 UTC observed 34 videos, sixteen import markers and 168 audit records, with target RLS enabled and the installed profile-review function hash unchanged. No production import, storage deletion or migration was invoked. Exact push, Vercel success and deployed health remain required.
