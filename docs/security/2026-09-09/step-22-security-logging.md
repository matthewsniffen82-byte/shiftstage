# Step 22 — Security logging

## Findings and correction

The runtime review covers logging calls under `app` and `src`, the shared error metadata boundary, authentication/rate-limit/admin events, media and finance workers, and the audit writers. Operator maintenance and browser-diagnostic scripts were inventoried separately. The review used source and synthetic faults; it did not download private production log streams or execute business operations.

| Severity | Evidence | Correction |
| --- | --- | --- |
| LOW | The shared diagnostic token grammar accepted URLs and POSIX paths in dependency-controlled name/code/type/request-ID fields. Arbitrary status coercion and throwing property getters could also interrupt logging. | Retain bounded alphanumeric/dot/underscore/hyphen identifiers and 100–599 numeric or three-digit HTTP statuses. Ignore unsupported shapes and getter failures without serializing them. |
| LOW | Video retries and optional saved-venue/support delivery failures logged dependency codes using raw conversion or truncation. | Route those log fields through the shared metadata boundary. Retry classification, delays, terminal errors, optional-count fallback, completed support messages and duplicate suppression remain unchanged. |
| LOW | Successful image-moderation diagnostics emitted response identifiers, category objects/scores, header strings and an unvalidated diagnostic flag. | Keep validated request IDs, Boolean flags, result/category counts, recognized image media types and safe numeric content lengths. The actual moderation result, approval thresholds, provider requests, signed-object validation and return value remain unchanged. Remove the unused response logging helper. |
| LOW | Public discovery diagnostics repeated user-supplied city/slug searches; one photo-removal branch repeated gallery IDs; the profile reload debug log repeated account review/publication state. | Preserve events and useful counts while omitting those redundant values. Public results, profile state, identifiers returned to their owner and deletion behavior are unchanged. |

Nine source files implement these changes. No SQL, production record rewrite, retention purge, provider activation or new dispatch is included. Structured operation references in administrative, finance, moderation, legal and venue audit events remain available for investigation; this change does not erase the attribution of authorized operations.

## Event and audit continuity

- Authentication failures retain validated operation/role context plus sanitized metadata. Passwords, tokens, contact values, recovery secrets and raw bodies are not added. Existing reset neutral-response and rate limits remain.
- Runtime checks verify `security.rate_limit_exceeded` contains only namespace/retry time, with no subject, address or hash. Admin denials contain only account-present/active flags; successful active-admin access emits no denial event.
- Existing webhook claims/receipts, payout uncertainty, financial audit events and media retry/review state remain. Step 21's fixed stored provider diagnostics are preserved.
- Central `admin_actions` and financial audit permissions retain the earlier browser-write revocations. The newly delivered architecture access matrix includes all 81 current public tables, along with existing policy/column/storage tests. This release runs the combined suite again; it does not substitute source assertions for those executed access cases.
- Current content/profile/social/import transactions couple their required review/audit writes with the mutation. Other multi-system operations retain their existing checked audit writer, explicit failure logs or reconciliation state. A log line is not a durable transaction receipt. This step does not claim exactly-once external delivery or that every historical audit row exists.
- Required administrator-authored reasons and legal/financial attribution remain intentional audit data. The broader data-minimization review is Step 26; records are not deleted speculatively.

## Regression evidence

The new boundary suite executes actual modules with synthetic providers, transport, timers and database results. Of 97 cases, 55 fail against the prior source and 42 already pass; the candidate passes all 97. It covers identifier/header injection, message/body/stack omission, malformed status/getter/header-reader/proxy shapes, video success-after-retry and exhausted/terminal paths, optional activity failure, support notification failure/duplicate suppression, image probe and full successful image-moderation logging, profile/search debug boundaries, rate-limit decisions and admin denial/success events.

The whole-application TypeScript program with external source overrides and lint of the draft sources/tests pass. Final integrated full tests, standalone TypeScript, full lint, production build, task-only commit/push, matching `main`, exact Vercel success and deployed read-only checks remain mandatory before delivery.

The final checkout incorporates architecture access-matrix release `5e04e635` and Supabase trigger release `ef752f858c5284bdd69f0089187aaeca4e4dbdd5`; both exact Vercel successes were independently confirmed. The latter preserved twenty reviewed table fingerprints and changed no runtime source. The first integrated run passed 6,514 of 6,515 tests; the sole failure was the existing NFC support VM fixture omitting the newly imported metadata helper. Adding the real helper to that fixture preserves its assertion that an optional notification failure cannot undo a completed support request. All 141 affected tests pass after the fixture update. The release now includes nine source files, two test files and three security documents; a complete validation rerun is required.

## Operational limits

The application emits security events to its existing server log stream; no new external logging service is connected. No callable Vercel configuration/log-drain tool is available in this task. Log-reader membership, retention, drains, alert routing and historical incident completeness are therefore not certified by this source change. Retain these as explicit operational verification items in the final report rather than inventing provider settings.

Operator-invoked maintenance reports and browser performance captures can include selected record identifiers, file paths and diagnostics as part of their requested private output. They are not public API responses or the production security-event contract. Do not commit raw captures or environment values. No maintenance mutation or private log export was run in this step. The production postbuild population gate remains disabled for validation and reports `LAYOUT_REVIEW_POPULATION_SKIPPED`.

The local preview remains stopped after the architecture task's automatic approval review rejected its restart. Production build, isolated tests and deployed read-only verification provide this release's checks; no restart workaround is attempted.

## Final integrated validation

All 6,515 automated tests passed with zero failures, skips or cancellations after the NFC fixture correction. Standalone TypeScript, full lint, production build and migration-history guard passed; postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. The eleven source/test files match their recorded validation hashes. The 220 initial focused checks and 141 post-fixture checks passed. This fourteen-file release retains the independently delivered architecture/Supabase changes. Exact commit/push and deployed verification follow before Step 23 begins.
