# Step 21: error handling and information disclosure

Step 21 started only after Step 20's closing commit 060b2976d3e7856efb2cc0c9ce3c64c0732fb919 was pushed, deployed successfully and verified. Its exact [Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/5zw4t5k9VYB5zPPepZXMFUjGK26z) succeeded. At 18:49:24–41 UTC on 2026-09-10, seventeen health/authorization checks, thirty readiness checks, four webhook rejections, fifteen header checks and read-only financial-function/transfer comparisons passed. Step 20's inactive-provider deferrals remain explicit in its closing review. The branch matched origin/main and was clean.

## Inspection and retained controls

The syntax inventory covers 383 TypeScript/TSX source files, including 117 API routes. It identifies six variable API fallbacks, twenty variable PublicApiError messages and twenty-two variable direct JSON error expressions for tracing. These counts are syntax candidates, not vulnerabilities or a proof that every dynamically assembled response is safe. Separate text searches trace warning arrays, stored provider errors, SDK/decoder errors, server-rendered pages and logging.

The existing resolveApiError/apiError boundary is retained. Unexpected messages are replaced with fixed operation text, known availability failures become generic 503 responses, and only explicitly public errors or exact known messages are published. Its logger already uses allowlisted metadata instead of messages, stacks or response bodies. The source traces establish:

| Surface | Current behavior |
| --- | --- |
| Public directory/profile reads and health probes | Fixed error responses; health exposes only service readiness, without database errors or settings. |
| Auth, recovery and account settings | Explicit local validation, fixed provider failures and safe outage responses; password/reset/session behavior from earlier steps remains intact. |
| Body validation and input wrappers | Caller-defined constant messages and fixed bounds; parsed JSON does not supply executable getters to local notification validation. |
| Media uploads | Decoder exceptions reach the shared fallback. Avatar-face rejection uses an application-defined error. Persisted moderation errors require the separate follow-up below. |
| Venue affiliation, DMCA and notifications | The variable fallback callers supply fixed operation text. Affiliation maps database failures to authored messages; rate-limit classes construct fixed feedback. |
| Venue review | The existing shared wrapper conceals its untyped database-derived error, even though an internal helper classifies a substring match. This is not reported as a demonstrated public disclosure. |
| Finance cron | The separately delivered handler already replaces aggregate errors with fixed review instructions and counts. Its stronger handling is preserved. The admin action and stored-record paths are separate candidates below. |

The review follows [OWASP's error-handling guidance](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html): unexpected failures must not publish implementation details. MyDancr's existing data-minimized diagnostics are retained rather than logging raw errors.

## First bounded correction

**LOW — unexpected venue account-creation errors became public input errors.** createVenueSignupRequest wrapped any thrown Error from createRequestManager as VenueSignupRequestUserError, which the public signup route intentionally publishes. A thrown dependency exception could therefore reach an unauthenticated applicant and lose its original 503 classification. Returned Auth errors and ordinary provisioning failures already had safe authored messages; those paths are preserved. This is reproduced with synthetic exceptions through the real route, signup service and manager helper. No real secret disclosure or account takeover is claimed.

The manager helper now labels only its own validation/setup messages with VenueRequestAccountUserError. The signup service converts that exact class to public feedback and lets unknown errors reach the existing shared boundary. Matching an error's name is insufficient. Successful signup, the configured password requirements, existing-email feedback, duplicate handling, saved-request recovery and cleanup limited to a newly created manager remain unchanged.

**LOW — administrative content-deletion warning arrays included raw errors.** Six warning sites in photo/social cleanup interpolated database or exception messages after deletion had succeeded. The authenticated admin API returned those warnings directly. Admin access does not require disclosure of SQL, paths or provider details. Fixed warnings now identify the failed cleanup stage, while ADMIN_CONTENT_CLEANUP_FAILED retains safe operational metadata. A cleanup warning still preserves the completed deletion and does not trigger a retry or undo the result. Existing owner/target predicates, primary-photo selection, guarded storage retirement and audit attempts remain in place.

This release changes only these error boundaries. It introduces no migration, permission change, provider request, new service, account workflow or UI redesign.

## Regression evidence

Thirty-six new tests execute the actual public signup route/service/manager and admin deletion route/library with synthetic Auth/database dependencies. Twenty-two assertions fail against the previous code; all thirty-six pass with the correction. Fourteen cases already passed before the change. The pre-fix failures include wrong failure classification or missing safe diagnostic metadata as well as raw disclosure; they are not twenty-two distinct vulnerabilities.

Coverage includes plain exceptions, connection/outage codes, forged class names, object/string rejections, local credential feedback, provider-declared setup failure, new-account compensation, normal signup, returned/thrown cleanup failures, retained completed deletions, successful cleanup, unauthenticated requests and customer attempts. The focused run passes 81 checks, including existing account provisioning, abuse budgets, admin deletion and shared error/logging tests. These are controlled request-handler tests, not destructive production tests or hosted provider fault injection.

Full tests, lint, standalone TypeScript, production build, isolated browser checks, task-only commit/push, exact Vercel success and safe deployed checks are required before the next correction.

## Remaining Step 21 follow-up

Step 21 remains open after this first correction until the following paths are resolved or explicitly justified. Step 22 has not begun.

| Candidate | Evidence and next review |
| --- | --- |
| Stored provider/moderation errors | Finance and agent dashboards select last_error/failure_message, and moderation retry stores a raw truncated message. RLS ownership alone does not sanitize a readable column. Audit the writer and direct database boundary, plus existing rows; changing only the visible UI would be insufficient. |
| Admin finance results | run_automation/process_payouts and related NATS actions can return raw aggregate error arrays via successfulFinanceMutation. Review failures after partial completion without repeating financial work or changing success accounting. |
| Persisted provider results and audit diagnostics | NATS result/metadata and financial audit reasons need an explicit data-minimization decision. Preserve reconciliation semantics and avoid a new payment operation. |

A read-only production catalog query at 19:00:20 UTC confirms RLS on all eight inspected stored-error tables and owner/admin SELECT policies. The ten inspected error/result columns have browser-role column grants, but RLS still limits rows; this is not anonymous access to private records. Aggregate counts find one nonempty club-invoice error and one nonempty dancer NATS-export error, with zero nonempty errors in the other six tables. The query returns no error contents, identifiers, account data or credentials. Those two values have not been classified as sensitive and no credential compromise is inferred. Source review and isolated tests will determine the next bounded fix.

Final validation on 060b2976d3e7856efb2cc0c9ce3c64c0732fb919 passed all 6,079 tests with zero failures, skips or cancellations, full uncached lint, standalone TypeScript, the production build and eight isolated browser checks at 19:06:24 UTC on 2026-09-10. The 158-file migration guard preserved all 142 frozen files, and postbuild skipped demo population. This build reported no disk-space cache warning. The existing npm configuration warning remains for Step 24. Final review is limited to three error-boundary source files, the 36-test regression suite and the security records. Exact task-only commit/push, Vercel success and deployed verification follow; Step 21 remains open for its separately documented stored-error and finance-result work.

## First delivery and finance-result correction

The first correction was pushed as fa3b140543c4c5092be431f43b1c3a37793123d2, with clean HEAD matching origin/main. Its exact [Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/EScVLL64y1i66sSgWigVkywGkMj5) succeeded. At 19:10:22–32 UTC, four targeted malformed-signup/unauthenticated-admin checks, seventeen health/authorization checks, thirty readiness checks, four webhook rejections and fifteen header checks passed. The targeted checks create no account, send no email and delete no production data. Only after this delivery did the next correction begin.

**LOW — admin finance action results bypassed the error-message boundary.** Five action paths return aggregate errors through successfulFinanceMutation: automation, direct-payout processing, NATS account verification, failed-export retry and reconciliation that confirms an export was not sent. The underlying workers collect raw dependency messages in their errors arrays. The admin route serializes those arrays even when the overview refresh fails. Existing authorization limits this exposure to admins; this finding does not establish leaked credentials or an unauthenticated financial operation.

The response helper now replaces each aggregate error entry with the existing finance-cron review instruction. It preserves the array length, all outcome counters, disabled/provider flags, completed work, null results and financeRefreshRequired behavior. Internal worker results are not mutated. It performs no extra database/provider call and adds no retry. Other stored error fields remain the separate review described above.

Thirty-four new tests execute the real admin route, database-backed role check, input parser, dispatcher and response helper with controlled operation/reporting dependencies. Twenty fail before the correction and all thirty-four pass afterward. They cover every affected action with zero, one and two error entries, including object entries, both successful and failed overview refresh, 401/403 denials, invalid actions and confirmed-export reconciliation that must not dispatch again. The focused suite passes 111 checks, including prior Step 21, finance-cron, response-contract and safe-logging coverage. No financial operation is run against production. Full validation and exact deployment gates remain required; Step 21 stays open.

The first finance-result candidate on fa3b140543c4c5092be431f43b1c3a37793123d2 passed all 6,113 tests, full uncached lint, standalone TypeScript, the production build and eight browser checks at 19:21:25 UTC. Before publication, independent dancer-enrollment locking release 2adc54ba92b64abfb504315f62084b0fbfd852f6 reached origin/main. Its two function changes and 25 native regressions were reviewed and preserved. Exact Vercel deployment FievemMRf2zF7mVqpyUfkHwKry6o succeeded. This security task does not apply its SQL, invoke a production tap or claim hosted concurrent-session testing. The combined version is being fully revalidated before the finance-result correction can be committed and deployed.

Final combined validation on 2adc54ba92b64abfb504315f62084b0fbfd852f6 passed all 6,138 tests with zero failures, skips or cancellations, full uncached lint, standalone TypeScript, the production build and eight isolated browser checks at 19:34:08 UTC on 2026-09-10. The migration guard passed 159 files with all 142 frozen files preserved; postbuild skipped demo population. The final task diff contains only the finance response helper, 34 route regressions and these security records. No SQL or financial action is applied. Exact commit/push, Vercel success and deployed verification are the remaining delivery gates for this bounded correction.

## D: handoff reconciliation and moderation retry correction

The authoritative checkout resumed on 2026-09-12 at db9dbf0bd908d68843ce9f389c576a2ed18c02b6. Prior uncommitted moderation edits were not copied or treated as delivered. The finance aggregate correction fcd8e58e53b5565abe3c6a19c190ff0028987b79 is in current history; its exact Vercel status was freshly verified as success at https://vercel.com/ai-movie-jobs/shiftstage/7TCJyAT7y1rC23jxaBDHxy6o6XxX. The independently completed demo scheduling release 87863f2dda46db18c58c859eb0be9e96adb9722c is preserved as this candidate's source baseline. Its two-file scope was inspected; Security does not run that maintenance command.

**LOW — moderation retries stored raw exception text in an owner-readable diagnostic column.** The worker's safeErrorMessage helper only truncated messages. Error instances, strings and stringified objects could therefore persist provider details in last_error_message. The retry worker now stores the existing fixed error classification code in that field. Its last_error_code, error_code, reason codes, user response, retry timing/limit, attempt counter, lock release, version checks, moderation decision and private recovery source are preserved. The unused raw-message helper is removed. No new provider request, SQL migration, production moderation action or historical data rewrite is introduced.

Thirty-two synthetic regressions exercise avatar and gallery retries, retryable and exhausted attempts, and eight failure shapes/classifications. All 32 fail on the pre-fix source; the candidate passes all 95 lifecycle tests. They verify diagnostic persistence, fixed responses, counters, locks, retry state and private-image retention. Object failures also verify normalization, not just disclosure of an Error message. Synthetic fault injection is isolated from live storage/providers.

At 2026-09-12T04:16:14Z, fresh HEAD-only production aggregate queries found zero nonempty last_error_code and last_error_message fields in image_moderation_records. No row contents, identifiers or credentials were retrieved. No existing moderation diagnostics need cleanup at that snapshot; the aggregate will be repeated after deployment. This REST count check does not independently certify the current RLS catalog.

Full combined validation, reviewed task-only commit/push, exact Vercel success and deployed health remain release gates. Step 21 remains open for payout/export/provider diagnostics and NATS results/metadata; Step 22 has not started.

The frozen moderation candidate on 87863f2d passed all 6,201 automated tests with zero failures, skips or cancellations, standalone TypeScript, full lint and the production build (completed 2026-09-12T04:27:42Z). The migration guard passed and postbuild reported LAYOUT_REVIEW_POPULATION_SKIPPED. All 102 focused moderation/logging checks passed. The rebuilt local homepage rendered discovery normally without browser warnings/errors; eight local health/anonymous-denial checks and all 30 Supabase readiness checks passed. An initial local probe incorrectly expected GET on the upload-only photo route to return 401; its correct 405 response led to correcting the probe to the supported dancer-profile GET route, with no application change. Only the two source/test files and these two security documents belong to this release; exact push/deployment verification follows.
