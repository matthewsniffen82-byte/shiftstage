# Combined architecture and stability follow-up

This release implements the concrete worker and account findings from the previously deferred exercises. The earlier `final-architecture-review.md` remains a dated record of its own release. Final delivery and remaining operational exercises are recorded in `D:/Codex/MyDancr-validation-2026-09-11/arch-stability/deferred-followup/delivery.json`; this source document is not a deployment receipt.

## Worker execution and recovery

Automated image and video moderation, manual media approval and avatar recentering run inside a 45-second job deadline. Cron handlers reserve a 50-second invocation budget and do not admit another full job without sufficient time. The active job reaches real Supabase and OpenAI network transports and FFmpeg processes. Native processes are killed on cancellation and their close event is observed before temporary-file cleanup. Detached continuations cannot begin another wrapped request after their job ends; explicit state-write checks also protect injected clients. A completed or cancelled job does not cancel an independent job. Diagnostic requests are cached per OpenAI client to avoid sharing cancellation across jobs.

Image recovery selects due retry work and claims that have been stalled for at least five minutes. The claim compares status, decision, input identity, row version, lock and attempt count; it increments the attempt before media work starts. A crash after claiming therefore consumes the attempt. The processor uses the exact returned claim version, so late work cannot replace a newer decision. Rows at or above the four-attempt ceiling stay private and move to human review without another provider attempt.

Already-issued remote writes may commit after transport cancellation. Storage and provider calls are not database transactions. Public media already downloaded or cached cannot be recalled. Native recovery tests establish the checked claim and result predicates; a single native connection is not independent hosted concurrency evidence.

## Hosted accounts and Storage

The approved recovery copy is Supabase project `cwpsrrjhrkedwtyatntv`, restored from the September 12, 2026 10:08:02 UTC backup and brought forward using independently verified migrations. All rehearsal writes use newly tagged synthetic identities and objects. Production and two unrelated existing project references are rejected by the runner.

The actual hosted SDK exercise passed 24 checks over 102 bounded requests. It created customer, dancer, venue and administrator accounts, verified authoritative roles and private-row isolation, rejected user-metadata privilege escalation, rotated and revoked independent sessions, and verified private synthetic Storage bytes and access denials. All five created identities and both synthetic objects were removed. Twenty-four private reads at concurrency four measured 71 ms median, 126 ms p95 and 206 ms maximum. These measurements are a smoke test and do not establish production capacity.

The exercise found two real signup defects. Dancer link allocation now checks retained aliases under the same advisory lock used for assignment. Independent hosted signups contended on that lock and both completed with distinct backend connections. Administrator and invited-venue signup now reconcile the customer placeholder created before GoTrue saves trusted application metadata. Only the successful newly created identity enters this reconciliation, after its admin code or venue invitation has been validated. The helper verifies trusted metadata and the resulting active role; it is not a general role-upgrade API for existing accounts. Failed new-administrator setup cleans up only the newly returned identity.

The hosted SDK exercise does not establish an application browser journey, mailbox delivery or restoration of production Storage bytes. Those outcomes belong to their separate execution receipts. Revoking refresh tokens does not invalidate every already-issued access token before expiry.

## Isolated hosting and deployment

An explicit isolated configuration requires a distinct Supabase project reference, its exact HTTPS API origin, Vercel hosting and a matching single-project `vercel.app` site origin. Invalid explicit settings fail rather than reverting to production callbacks. Auth redirects in this mode remain on that isolated origin. Ordinary production origin behavior is preserved. Liveness exposes a valid hosting commit revision, or null when unavailable, so final checks can identify the running commit.

This release contains only the architecture and stability follow-up. The desktop metric alignment was published separately and is not part of its change set. Both migration sources were applied once in production with guarded record/catalog preservation and independent postflight before the application release. The original architecture candidate passed all 9,346 automated tests, TypeScript, lint, dependency/signature verification, the production build and configured artifact inspection. On resumption, its unchanged implementation is integrated with the subsequently published main branch using focused compatibility checks under the updated repository validation policy. The final receipt records source equivalence, the selected checks, matching local and remote main, exact successful Vercel status and hosted health checks.

Stripe/NATS payments and OneSignal push are not configured, as confirmed by the user. Their delivery and settlement checks cannot be counted as passed. Email delivery requires the designated safe test mailbox and provider access. No production stress test, real payment, push notification or production media publication is part of this exercise.
