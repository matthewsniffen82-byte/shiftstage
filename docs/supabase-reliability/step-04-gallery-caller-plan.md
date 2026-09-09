# Step 4: activate the atomic gallery publisher

## Starting evidence

The foundation migration is deployed as `4fed8cb7a3e9e8f96b0ef99ccfd4f8144f69789f`, applied with original data/access preserved, and frozen in the migration manifest. The replacement-intent prerequisite is deployed as `c39d80d23bf2e9a6f17e6a4db16356b59b4d32fe`. Its exact Vercel deployment succeeded; production serves the replacement-ID code, health routes returned 200/ok at 22:02 UTC on 2026-09-09, unauthenticated photo POST returned 401, and all thirty readiness checks passed. All 3,104 tests, lint, build and explicit TypeScript passed before that release. The publisher and both intent columns are present in the REST schema. No approval caller has switched yet.

## Controlled implementation plan

1. Add a shared server gateway for the existing publication RPC. Pass the moderation record's exact updated_at value; validate the committed photo/review relationship before returning success. Map confirmed conflicts to useful application errors. Do not retry writes or fall back to the legacy multi-request publisher.
2. Return the record version when creating moderation records. Automatic gallery approval passes that captured version through asynchronous moderation. Retry workers must conditionally advance a still-pending record and use the returned version. Guard nonterminal and rejection writes against a newer decision, so late provider results cannot downgrade an approval or reverse a rejection.
3. Switch automatic and administrator gallery approvals to the RPC. Keep avatar publication separate. Remove slot-inferred replacement and separate gallery photo/approval/profile writes. Return the committed photo ID, slot, status and URL. Handle already-approved retries without uploading another file, and reject deleted/inconsistent results rather than creating replacements implicitly.
4. Check the administrator queue's decision controls before adding conditional rejection. An initial upload review must not overwrite a decision that changed during the request. Existing approved-content moderation remains a separate path; do not silently remove a supported emergency moderation capability.
5. Perform cleanup only after confirmed commit. Retain potentially referenced files after uncertain calls. For superseded paths, preserve shared references and legacy paths whose ownership cannot be established; cleanup failures must leave an acknowledged publication successful and log sanitized context. No blanket orphan purge.
6. Adapt the existing gallery fault tests to atomic outcomes while retaining avatar coverage. Use the actual SQL in embedded PostgreSQL for queued competing approvals, stale decisions and rollback; combine this with application-level response-loss and cleanup-failure tests. Do not claim PGlite is a multi-connection production load test.
7. Run the complete suite, lint, build, explicit TypeScript, read-only production schema/readiness and authentication-boundary checks. Review only this scope's diff, commit, push main, verify exact Vercel success and post-deployment health before another controlled change.

No new production account, email, real-media approval/deletion or historical migration replay is needed for testing this release. Do not edit the already-applied foundation migration. If its contract needs correction, use a separately tested additive migration before dependent callers.

## Integration adjustment

Before release, concurrent commit `cfa033300507aa6a2eaed1f10a34c833014de5b5` delivered the atomic callers, duplicate-key recovery, terminal guards and conditional pending deletion. Its exact Vercel deployment and production health were verified before integrating it. Preserve that implementation and all its native caller/cancellation/microsecond tests. The remaining release is a follow-up for exact pending-version checks, confirmed replay/result validation and reference-aware/private-source cleanup, using the established `photo-publication.ts` module. Rerun the complete validation on the integrated tree; earlier pre-integration checks are not its release evidence.
