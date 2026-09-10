# Step 11 — retain failed avatar uploads for recovery

## Finding and plan

`processImageModerationRetryRecord` deleted an avatar's private source after a non-retryable technical error or after exhausting automatic retries. The database still marked the upload as a review/error record and retained its source path. An unavailable provider, configuration failure or uncertain private-copy response could therefore make the record unrecoverable even though no moderation rejection had occurred.

Remove only that error-path cleanup. Preserve the private object and its existing moderation pointer, attempt count, released worker lock, error state and retry schedule. Keep the bounded retry limit and the cleanup branches for acknowledged moderation or face-policy rejection. No database migration, public visibility change, automatic retry expansion or production media mutation is needed.

## Validation

Run the real avatar retry function with temporary in-memory records and simulated provider/storage transport. Cover early and exhausted attempts, timeout/rate limiting, unauthorized/forbidden/bad requests, configuration errors, generic errors and unconfirmed review copies. Assert retained source/pointer and unchanged retry rules. Positive controls must still remove the source after acknowledged rejection. Compare against the preceding implementation, then run the entire release suite, lint, build, standalone TypeScript, migration guard, readiness and read-only preservation before exact push/deployment verification.

## Recovery and limits

An exhausted upload remains private with `moderation_error`; it does not become public, approved or endlessly retried. An authorized recovery action can inspect its recorded state and available source. A retained object is not automatic deletion authorization. General failed-upload provenance and operational reconciliation remain open for the recovery review.

This change does not make avatar profile/moderation writes atomic or alter other lifecycle writers. Rollback is an application-code revert; no existing file or record needs to be removed or restored as part of deployment.
