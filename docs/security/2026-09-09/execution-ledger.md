# Sequential security delivery ledger

The mission is in progress. A step may be marked delivered only after its own validation, commit, push, exact-commit Vercel success and health verification. No later numbered step may start earlier.

The initial source baseline is `bb14ecd162af1594c1b031d8aeb38442bbe114d6`. Step 1 is documentation only; vulnerabilities found by that audit remain open until their individual remediation steps.

## Step 1 validation

- Reproducible locked installation: npm ci completed; four package advisories recorded in the baseline.
- Full automated suite, including existing security tests: 1,936 passed, zero failed, zero skipped.
- TypeScript: npm run typecheck completed successfully; this script also runs the entire suite.
- Lint: npm run lint completed successfully with zero lint findings.
- Production build: npm run build completed successfully; postbuild reported LAYOUT_REVIEW_POPULATION_SKIPPED.
- Safe live baseline: root and both health endpoints returned 200; Supabase metadata and anonymous rejection/empty-result probes are described in the threat model.
- Production data mutations during audit: none.
- New automated application tests: none in the documentation-only baseline. Existing tests establish starting behavior, with their limits explicitly documented.

Step 1 delivered as `50d4eb543dbfc93dbed6f0663c51aa2332542cb4`, pushed to origin/main with matching local HEAD. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/A8nLZchDawqDwFrvZQEGRgRGkrhj) reached success. At 2026-09-09 09:08 UTC, root and both health endpoints returned 200; account and admin approval APIs rejected anonymous requests with 401. Working tree was clean.

## Step status

| Step | Area | State |
| --- | --- | --- |
| 1 | Complete audit / threat model | Delivered and healthy: 50d4eb543dbfc93dbed6f0663c51aa2332542cb4 |
| 2 | Secrets and environment | Delivered and healthy: f7dc39d362a2b4c2f70ed401d134593ea3d9c640 |
| 3 | Supabase RLS | Delivered and healthy: 0829c12ed79f6525105a5b313ab374709670a4ad and 9b74c805bc87cae8891269e6d03c005d7e8842ab |
| 4 | Storage permissions | Delivered and healthy: b3b46b5d7485dc3bad5ef179a996f26730113d21 |
| 5 | Authentication / recovery | Delivered and healthy: 7bc16ed2204df7a07678001c522544cec2425a10 |
| 6 | Role authorization | Delivered and healthy: 5db6de15bbd5e5d9746f2c21a901286ecd980c92 and 39614027ff633836641227d30cb8256cd238859e |
| 7 | Admin access / auditing | Delivered and healthy: d22462c5bd27675def76675af3f64e5e9a307fd8 and 61d926e9a1db7d1033e8d2f9fdd5fb3255d0ca5f |
| 8 | Input validation | Delivered and healthy: 70cfac08932c4373a780f3714588d564da9c4cb4 |
| 9 | XSS / HTML injection | Delivered and healthy: 96745f706e42030be530664bc704234ca298a10a |
| 10 | CSRF / state changes | Delivered and healthy: 15b6fbffece8d2ed437346d0567afb266b554756 |
| 11 | Rate limits | Delivered and healthy: a89818f8c7294f311575adb70c29eb11e9476b19 |
| 12 | Bot resistance | Delivered and healthy: 68a04ea1c502eaef5a7aab78068399b052c453bf |
| 13 | File upload handling | Implemented; final release validation and deployment verification pending |
| 14 | API authorization / exposure | Not started |
| 15 | Security headers | Not started |
| 16 | CORS | Not started |
| 17 | Cookies / sessions | Not started |
| 18 | Redirects / URLs | Not started |
| 19 | Database functions / grants | Not started |
| 20 | Webhooks | Not started |
| 21 | Errors / disclosure | Not started |
| 22 | Security logging | Not started |
| 23 | Dependencies | Not started |
| 24 | CI / supply chain | Not started |
| 25 | Production build / source maps | Not started |
| 26 | Sensitive data minimization | Not started |
| 27 | Profile / location safety | Not started |
| 28 | Scraping resilience | Not started |
| 29 | Resource abuse / DoS | Not started |
| 30 | Security regression coverage | Not started |
| 31 | Defensive validation | Not started |
| 32 | Final report | Not started |

## Evidence and constraints

Only sanitized evidence belongs in Git. Local validation logs and read-only metadata snapshots are retained outside the worktree under the task's delivery directory. Never copy environment values, tokens, private account records or verification documents into this ledger.

The production policy/function/grant catalog was freshly captured during Step 3. Auth settings, GitHub branch protection and disposable authenticated staging accounts still need their scheduled reviews. Step 3 uses isolated PostgreSQL policy tests with synthetic rows and separate read-only production role-context checks; these do not certify Supabase Auth token issuance or full historical migration replay.

## Step 2 delivery

Delivered as `f7dc39d362a2b4c2f70ed401d134593ea3d9c640`, pushed to origin/main with matching clean local HEAD. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/3SFq9S6wvsh8pSeKtjjQ5Siyzm9D) reached success. At 2026-09-09 10:49 UTC, root and both health endpoints returned 200; account and admin approvals returned 401 without authentication. The final full suite passed 1,972 tests; lint, TypeScript, migration history check and production build passed. No credentials were rotated.

## Step 3 delivery

The fix was delivered as `0829c12ed79f6525105a5b313ab374709670a4ad`, pushed to origin/main with matching clean local HEAD. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/C8aCdAFs8xGw6MuABUExeujYFhK6) reached success. The new migration `20260909110000` was applied in a bounded transaction together with only its own migration-ledger entry. Preflight verified the original ownership predicates. The stored SQL matched the committed file.

At 11:10 UTC, the fresh catalog showed exactly ten new restrictive policies and no changes to previous policies, grants, RLS settings or helper functions. Customer, dancer and venue read-only role-context probes passed again. At 11:11 UTC, root and both health endpoints returned 200; unauthenticated account/admin requests returned 401. No production user records were modified.

The normalized SQL SHA-256 is `eebe3fff9cd1428358246c9bd8ad1bed1894356f8cc58df3e8810d4b6c05963e`. This follow-up freezes that verified file in the history guard after successful application, as required by the migration workflow; it does not replay SQL or repair any historical ledger entry. Complete release checks and exact-commit Vercel health must pass for this follow-up before Step 4 begins.

The follow-up was integrated with the independently published image-performance release and passed all 2,069 tests, lint, TypeScript and the production build. The migration gate verified 129 frozen files; postbuild skipped demo population. Its Vercel status and health are recorded after deployment.

Step 3's delivery-record follow-up was pushed as `9b74c805bc87cae8891269e6d03c005d7e8842ab`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/7V2qdEZjnnpXU2KjKTQMBkE8q3cv) succeeded. At 11:21 UTC, root and both health routes returned 200; anonymous account/admin requests returned 401. Local HEAD matched origin/main and the worktree was clean before Step 4.

## Step 4 delivery

Delivered as `b3b46b5d7485dc3bad5ef179a996f26730113d21`, pushed to origin/main with matching clean local HEAD. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/9K2NfVkYmqhwTVkR2JsuCCFTrZBg) succeeded. At 2026-09-09 11:38 UTC, root and both health routes returned 200; anonymous account/admin requests returned 401. All 30 live readiness checks passed after deployment. Full validation passed 2,098 tests, lint, TypeScript and production build. Storage configuration and data remained unchanged.

## Step 5 validation

The callback audit and two confirmed findings are recorded in `step-05-authentication.md`. Sixteen runtime regressions were added; the pre-fix reproduction failed 15 assertions, while the fixed focused suite passed all 192 tests. After incorporating the separately published video-performance commit, the complete suite passed all 2,118 tests. Lint, TypeScript and production build passed, including the 129-file migration-history guard. Postbuild skipped demo population. No production accounts or credentials were changed. Exact-commit deployment and safe callback verification must succeed before Step 6.

Step 5 was delivered as `7bc16ed2204df7a07678001c522544cec2425a10`, pushed with matching clean local HEAD and origin/main. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/KoKP57anVhakDNDLVBVafg1pYKou) succeeded. At 2026-09-09 11:56 UTC, root and both health endpoints returned 200; anonymous account/admin requests returned 401. The live callback script preserved a synthetic existing session while routing invalid recovery to the expired-link screen; no-store/no-referrer and the deployed guard were verified. All 30 live readiness checks passed.

## Step 6 validation

The role/ownership audit, three confirmed finding groups and repair scope are documented in `step-06-authorization.md`. New coverage includes 28 account-lifecycle, 151 professional-role and one PostgreSQL cleanup test. The original account-state implementation failed 22 of the initial 26 lifecycle checks. The fixed complete suite passed 2,301 tests after integrating the independent feed-performance release. Lint, TypeScript and production build passed; the migration gate retained 129 frozen files and recognized the new timestamped cleanup. Postbuild skipped demo population.

Read-only production preflight found two obsolete active-account markers before the fixed cutoff and one current paused-account marker. No data has been repaired at this validation point. The fixed application must be successfully deployed before the committed cleanup runs; its postconditions and migration record must then be verified before Step 7.

Step 6's fix was pushed as `5db6de15bbd5e5d9746f2c21a901286ecd980c92`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/6HUuHmEYh2PX3Zm2NXpf6fWN2ySb) succeeded. At 2026-09-09 12:27 UTC, root and both health endpoints returned 200; anonymous account, admin, dancer profile/video, agent and venue requests returned 401. The deployed invalid-recovery callback regression passed and all 30 live readiness checks passed.

After that verification, migration `20260909120820` ran in its bounded transaction and registered only its own committed SQL. Exactly two active accounts had their obsolete self-service permission keys removed. Transaction postconditions confirmed other metadata, roles and account states were preserved. A subsequent read-only query found zero active markers, one intact paused-account marker and zero deleted accounts with Auth identities. The migration ledger contains one matching version and its SQL checksum matches the committed file.

Normalized SQL SHA-256: `5ba86612d91b10e9d117e49518b6bfef4a0d5d6cf1185854703febffcaf4f6e2`. This same-step follow-up freezes the verified file as the 130th history-baseline entry; it replays no SQL. The independently published Supabase query-performance commit was integrated without changing its ownership-scoped queries. Full release checks and exact-commit deployment verification are required for this follow-up before Step 7 begins.

The follow-up passed all 2,307 automated tests, lint, TypeScript and the production build. The migration gate verified 130 frozen files, and postbuild skipped demo population. Its exact-commit deployment result is recorded after publication.

Step 6's follow-up was pushed as `39614027ff633836641227d30cb8256cd238859e`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/Bq4ovGw5LMBuCbF2g2BQwYjJruQf) succeeded. At 12:34 UTC, all production health, anonymous authorization, callback and 30 Supabase readiness checks passed. Local HEAD matched origin/main and the worktree was clean before Step 7 began.

## Step 7 validation

The administrative review and three confirmed findings are documented in `step-07-admin.md`. The focused admin/audit suite passed 360 checks; the final suspension suite passed seven runtime tests, including the actual account self-service flow against synthetic PostgreSQL data. Pre-fix tests reproduced audit tampering and profile-suspension bypass, and 14 admin denial responses were incorrectly classified as 500. No production data was changed during these tests. Full release checks and exact-commit application/database deployment verification are pending.

After integrating the independent request-cancellation performance release, all 2,676 automated tests passed. Lint, TypeScript and the production build passed. The migration guard retained 130 frozen files and recognized the two new migrations; postbuild skipped demo population. The exact deployment transaction passed an isolated PostgreSQL dry run with the current live function body and synthetic records, including record preservation, browser audit-write denial, private suspension state and retained server capabilities. Exact-commit publication and production migration application remain pending.

Step 7's fix was pushed as `d22462c5bd27675def76675af3f64e5e9a307fd8`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/HB8GteybQTULq6j23g7t6F97FgUA) succeeded. After its health check, both committed migrations ran in one bounded transaction at 12:57 UTC. Locked before/after fingerprints confirmed existing profile and audit records were unchanged. Read-only postflight confirmed browser audit writes were revoked, admin reads and server inserts retained, the new flag was private, the publication function was service-only with its pinned search path, and both tables retained RLS. Both ledger SQL checksums matched the committed files.

At 12:57:52 UTC, root and both health endpoints returned 200, all sampled protected routes returned 401 anonymously, both corrected admin POST routes returned 401, the recovery callback regression passed, and all 30 Supabase readiness checks passed. No production account or moderation state was altered to test the controls.

Verified normalized migration SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `20260909124500_protect_admin_audit_history.sql` | `5c7813569f9101aafb39e030aca16a048377a681322616cc0920f45932d7bc86` |
| `20260909124600_preserve_admin_profile_suspensions.sql` | `7d672c1e87c5734f597e129e6256050ae2b5be526cdf0d00a30e6fb6fa64ea46` |

This same-step follow-up freezes the two verified migrations, bringing the immutable history to 132 files. It does not rerun SQL. Its full checks, push and exact deployment verification must complete before Step 8.

Follow-up validation passed all 2,676 tests, lint, TypeScript and production build. The history gate verified 132 frozen files; postbuild skipped demo population.

The follow-up was pushed as `61d926e9a1db7d1033e8d2f9fdd5fb3255d0ca5f`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/61RrjyGTzLrF7aP7qX9bti6yUbqn) succeeded. At 13:04:02 UTC, production health, anonymous authorization denials, callback regression and all 30 readiness checks passed. Local HEAD matched origin/main with a clean worktree before Step 8 began.

## Step 8 implementation

The input review identified one MEDIUM photo-deletion collection validation gap. A narrow guard rejects excessive or malformed collections before profile work and preserves existing ownership and moderation checks. Forty-one new regression cases and the existing profile-save and professional-role checks pass. No production records or database configuration were changed. See `step-08-input-validation.md` for the review and testing limits.

Final validation passed all 2,724 tests, lint, TypeScript and production build after incorporating the independent stylesheet release `eb75d8436d5c9c662358cd4ea906fd367da688fc`. The migration gate verified 132 frozen files and postbuild skipped demo population. Push, exact-commit Vercel success and healthy production verification remain required before Step 9.

Step 8 was pushed as `70cfac08932c4373a780f3714588d564da9c4cb4`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/6suCjq33K8jLahEfDpjNp65bAShv) succeeded. At 13:24:48 UTC, root and both health endpoints returned 200, sampled protected APIs and both admin POSTs returned 401 anonymously, callback regression passed, and all 30 Supabase readiness checks passed. Local HEAD matched origin/main and the worktree was clean before Step 9.

## Step 9 implementation

The XSS review corrected one MEDIUM raw HTML/attribute interpolation issue and two LOW CSS-attribute/URL-rendering gaps, with existing CSP and server validation retained. Forty-three new runtime tests cover the actual rendering functions. See `step-09-output-encoding.md` for evidence and limits. No production records or database configuration changed. Complete validation and exact-commit deployment verification are required before Step 10.

Final combined validation passed all 2,767 tests, lint, TypeScript and production build after incorporating the independent static-CSS release `ac451c674a64af33753cf2d1c178b1bea285ca94`. Stale generated types for its removed CSS route were regenerated/cleared locally before TypeScript passed. The migration gate verified 132 frozen files; postbuild skipped demo population. Only this step's source, generated home-shell hash, regression tests and audit notes are included in its commit. Publication and verification follow next.

Step 9 was pushed as `96745f706e42030be530664bc704234ca298a10a`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/6kFhLg3YJ9NJLrrMCmH27Dh4eFPC) succeeded. At 13:49:47 UTC, the live shell matched `3d62964bca78c14423fba7b1e172640bfe058af1ddf64befc526fbba3e9a4f38`; deployed encoding, unsafe-URL rejection, CSP and stylesheet checks passed. At 13:49:51 UTC, health, protected-route denials, callback regression and all 30 readiness checks passed. Local HEAD matched origin/main with a clean worktree before Step 10.

## Step 10 implementation

The CSRF review found one LOW origin/content-type gap affecting three visitor-cookie POST endpoints. A shared guard rejects browser-origin mismatches and non-JSON forms before body/database work. Bearer-authenticated account and admin paths, worker authorization, webhooks and auth callbacks retain their existing boundaries. Thirty-eight new tests and the complete 2,805-test suite pass. See `step-10-csrf.md` for the review, machine-GET exception and testing limits. Final release checks and exact-commit deployment verification remain required before Step 11.

After incorporating the independent stylesheet-preload release `bd70d9fa57e3a2acab72709ac8679a09c7f1159a`, final validation passed 2,806 tests, lint, TypeScript and production build. The migration gate verified 132 frozen files and postbuild skipped demo population. Only the three route hooks, shared guard, regression test and two audit documents belong to this step. Push, exact-commit deployment and health verification follow next.

## Step 10 delivery

Step 10 was pushed as `15b6fbffece8d2ed437346d0567afb266b554756`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/FfxD1QCo8RYXYw87oTwNbB9vHF8h) succeeded. Final validation after integrating the independent stylesheet-preload change passed all 2,806 tests, lint, TypeScript and production build. At 14:07:37 UTC, twelve safe live CSRF probes returned the expected 400/403/415 responses without valid engagement targets. At 14:07:38 UTC, health, protected-route denials, callback regression and all 30 readiness checks passed. Local HEAD matched origin/main with a clean worktree before Step 11.

## Step 11 implementation

Three MEDIUM rate-limit gaps were corrected: untrusted address-header precedence, role-dependent email attempt budgets and non-atomic venue access-preview admission. Existing limits and stronger rolling checks remain. Fifty new request/PostgreSQL regression tests exercise these boundaries; see `step-11-rate-limits.md` for coverage and limitations. No database or provider configuration is changed. Final release checks and exact-commit deployment verification are required before Step 12.

## Step 11 delivery

Step 11 was pushed as `a89818f8c7294f311575adb70c29eb11e9476b19`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/DyySH5BS7TL2hXvMK4mALzTGKyxD) succeeded. All 2,856 tests, lint, TypeScript and production build passed. At 14:35:27 UTC, four empty-input production probes returned 400 without creating submissions or emails. At 14:35:33 UTC, health, protected-route denials, callback regression and all 30 readiness checks passed. Local HEAD matched origin/main with a clean worktree before Step 12.

## Step 12 implementation

Two MEDIUM automated-burst gaps were corrected in venue signup and copyright notices. Atomic reservations run after validation and existing rolling checks, before login creation, persistence or mail. Support's stronger existing atomic flow was verified and retained. Fourteen new runtime tests and all 2,873 application tests pass after integrating the independent moderation SDK loading update. See `step-12-bot-resistance.md` for findings and safe-test limits. Final release checks and exact-commit deployment verification are required before Step 13.

## Step 12 delivery

Step 12 was pushed as `68a04ea1c502eaef5a7aab78068399b052c453bf`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/Ar6UEirbzuFQ5mA2Rcf1fGeRuQHJ) succeeded. All 2,873 tests, lint, TypeScript and production build passed. At 14:58:44 UTC, four empty-input probes returned 400 without creating submissions or emails. At 14:58:50 UTC, health, protected-route denials, callback regression and all 30 readiness checks passed. Local HEAD matched origin/main with a clean worktree before Step 13.

## Step 13 implementation

The MEDIUM native-decoder validation-order gap is corrected with an early container/MIME gate and restricted local video inputs. Existing image normalization, ownership, bucket permissions and moderation remain. Thirty-seven new boundary/native tests and the existing watermark regression pass. See step-13-upload-decoding.md for findings and test limits. The independent browser resource cleanup and environment configuration releases were reviewed and incorporated. Final combined release checks and exact-commit deployment verification are required before Step 14.

Combined validation passed all 2,923 tests, lint, TypeScript and the production build. The migration guard retained 132 frozen files and postbuild skipped demo population. Only this step's media-boundary code, tests and audit notes are included in its release. Push, exact-commit Vercel success and production health verification follow next.
