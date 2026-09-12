# Avatar publication and defensive validation

The remaining security implementation is part of the user-authorized combined release with the final report and the outstanding architecture/recovery exercises. It is not an additional independent deployment reservation.

## Confirmed problem and resulting behavior

Avatar approval previously reread the latest profile immediately before writing its new path, then updated its moderation record separately. A late upload could therefore adopt a newer avatar as its predecessor. A rejected or deleted review could leave the profile changed even when the second write failed. Deletion removed reviews and cleared the profile in separate operations; recentering also reread the latest avatar and recorded its audit separately.

The new service-only transaction boundaries preserve the original avatar path and version through upload reservation, retry and approval. Reserving an upload advances `avatar_updated_at` while leaving the visible avatar in place, and saves that exact intent with the review. A newer reservation, deletion, publication or recenter operation invalidates the older intent. Monotonic database triggers prevent same-value writes or a path changing away and back from reusing an old version. Every avatar review update advances its version, and workers consume the version actually returned by the database.

Publication changes the profile and review together. A repeated approved request can acknowledge only the result still referenced by the current profile and present in Storage. It does not restore an old result. Historical pending reviews have no recorded intent: automatic approval fails, while an explicit current administrator decision may bind the profile snapshot captured before its media work. Deletion compares its initial profile snapshot and clears the avatar and owned reviews together. Recenter compares both the original avatar and, when used, the exact approved gallery source, and commits its required audit in the same transaction.

The four functions use `SECURITY INVOKER`, an empty search path, service-only execution, a three-second lock timeout and read-committed transactions. Existing lifecycle, media-retirement and reference-history triggers remain in force. No browser receives execution rights to these functions. Two nullable intent columns preserve every existing review as legacy; the migration does not assign intent to old records or change existing profile/media rows.

## Validation boundaries

The dedicated PostgreSQL fixture compares all 52 pre-change target column identities, 15 constraint definitions and all seven current attached trigger definitions/function fingerprints against the catalog captured on September 12 at 19:37:34 UTC. It includes the committed account-pause and copyright-ownership tables, their foreign keys and profile triggers. Storage is a synthetic metadata projection; no native test contacts a provider or writes production data.

Tests exercise the compiled application callers, native transactions, stale original snapshots, newer review decisions, same-value/ABA changes, legacy moderation, missing or retired objects, both API roles, inactive owners/reviewers, required-audit rollback, repeated results and lost/malformed acknowledgements. Existing publication-recovery and guarded-cleanup fixtures use the new atomic receipt. The comparison run uses the exact prior application source from `ab90b36f78cf589b2a89711498d920d0ed19b079` with its pre-change database behavior.

The final combined validation evidence must record focused results, all eight canonical release gates, the exact committed SQL preflight/application/postflight and the exact deployed commit. This document alone is not a deployment receipt.

## Delivery and limits

The combined source is validated and committed locally before the exact new migration is applied once with bounded preflight and independent postflight. The final integrator pushes only after that database proof succeeds, ensuring that the new application is not deployed without its required functions. The immutable migration manifest records source identity; the actual provider ledger and independent application receipt establish execution. These are distinct claims.

Database atomicity does not extend to Storage APIs or already running external work. An upload may leave retained files after an uncertain response, and retirement remains a separate guarded operation after a checked acknowledgement. Previously running deployments cannot be retroactively fenced. The combined architecture change adds 45-second moderation jobs with transport and child-process cancellation, a 50-second cron budget, and stale image recovery after five minutes. Claims consume attempts immediately and results retain the exact database claim version. Exhausted work remains private for human review. Already-issued remote operations can still commit after cancellation; these execution bounds do not make Storage part of the database transaction.

## Focused integration evidence

The candidate passed 313 focused tests at 2026-09-12T20:14:35.738Z with no failures, skips or cancellations. The exact old application comparison passed five cases and failed nine behavioral assertions; the same fourteen caller cases pass in the candidate. Standalone TypeScript and full zero-warning lint passed. The earlier 45 and four fixture failures remain in the external run receipts; they were corrected without relaxing the production assertions.

Native guarded deployment at 2026-09-12T20:20:46.357Z verified the six new function bodies, two triggers, two columns and constraint, preserving all existing fixture records and unrelated metadata. It rejected reapplication, unexpected row mutation, unexpected privilege mutation and an altered function body. The verified normalized SQL SHA-256 is b040215faf24858f23aa296a6e22c23013f8723278c94755879103c6354c20a4. No production SQL has been executed at this preparation stage. The candidate now includes the separately deployed desktop-header commit babd1b2bb20ee4b6046df69e2da4e9a2c60d7101 as its parent.

The combined architecture receipt records the complete release gates, hosted exercises and final exact-commit deployment at `D:/Codex/MyDancr-validation-2026-09-11/arch-stability/deferred-followup/delivery.json`. Its existence and successful checks, rather than this preparation document, establish final delivery.
