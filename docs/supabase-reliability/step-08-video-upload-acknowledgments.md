# Step 8: preserve video upload reservations on uncertain preparation

## Prerequisite and issue

Optional-auth handling was pushed as `794a1850a2ee49f7109b95e6a0d759ed27c01762`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/GaPEorifQViEZY7J7KXxiWGaRxMu) succeeded. Both health routes, unauthenticated account denial, affected public input gates and all thirty readiness checks passed at 03:10:38–40 UTC on 2026-09-10. No production activity or provider email was invoked.

The video prepare function inserts a pending record, then requests a Storage upload token. A returned signing error deletes the pending record without checking the delete result. Another request can already be resuming that same upload identity, so cleanup can erase its metadata. The existing browser upload identity and resume branch already support retaining the reservation. The insert result also lacks exact returned identity/path checks, and a null Storage listing is treated as confirmed absence on resume.

## Controlled plan

Keep the pending record when upload signing fails or returns an unusable token. Report the failure through the existing safe API boundary; do not delete or retry the database write. Verify the insert acknowledgment matches the exact expected ID and path before requesting an upload token. Reject an absent/malformed resume listing and a mismatched signed-upload path. Retain the established explicit retry identity, completed-object and submitted-video recovery paths, role/ownership gates and media limits.

Use stateful synthetic database/Storage tests for uncertain committed insert/signing responses, explicit retry, concurrent completion, invalid identity/token/path/listing and legitimate empty/existing objects. No production upload/delete or schema change is required. Run the full suite, lint, production build, TypeScript and live read-only readiness, then commit/push/deploy/verify before another correction.

## Other inspected findings

Public venue claim submission and administrator claim mutation routes return 410; the legacy write functions have no active application callers. Retain their historical data and code for now, and do not count dormant cleanup candidates as active query fixes. The administrator legacy claim reader remains protected.

Platform import compensation, pending upload retention/cleanup, NFC support's multi-record workflow, account-state compensation and counter-notice delivery remain separate atomicity/storage/lifecycle findings. Retaining a reservation uses a library slot until the dancer resumes or removes it; that is preferable to deleting metadata during uncertainty. The later storage step must document conservative orphan/abandoned-upload handling.

## Implementation and focused evidence

The pending video is retained for both returned and thrown signing failures. New reservations require the exact returned video ID and path before signing. New/resumed upload tokens must be nonempty strings and their returned path must match when present. Resume rejects an absent/malformed object list instead of inferring that the video was not uploaded. Existing matching objects and already-submitted videos keep their established recovery paths.

Twenty-one new stateful runtime tests execute the actual video function and its dancer route with synthetic database/Storage adapters. Thirteen cases fail against the previous committed source and all twenty-one pass after this correction; the focused set including existing TV/import checks passes 41 cases. Coverage includes a lost committed insert response, explicit retry without a second insert, concurrent completion, mismatched insert identity, invalid signing responses, uncertain listing, correct uploaded-object recovery, different-file/owner rejection and sanitized API errors. These fixtures verify control flow and preservation, not a live upload, hosted concurrency or native RLS execution.

## Release validation

Validation on `794a1850` passed all 4,012 tests without failures, skips or cancellations, full lint, production build, standalone TypeScript and thirty live readiness checks. Postbuild skipped layout-review population. No production upload, deletion, account or schema change was used for testing. Exact push, Vercel success and post-deployment health remain required.
