# Controlled Supabase hardening execution ledger

This task follows the user's strict sequence: inspect one step, implement that step only, run the complete suite/TypeScript/lint/production build and relevant database checks, commit, push `origin/main`, verify that exact SHA's Vercel success and deployed health, then start the next step. A pending verification is not completion. Database changes require migrations and separate safe application; Vercel does not apply SQL.

No production database reset, account deletion, unsafe cascade change, RLS disabling, credential exposure, or destructive restore is permitted. Preserve unrelated work and recheck concurrent `main` and migration-ledger changes before every release.

The user subsequently deferred disposable test-project setup and explicitly requested the next test. Step 3 may proceed within safe local/read-only bounds, while historical replay stays deferred. This does not waive production-data protections or the per-step release checks.

| Step | Scope | State | Release evidence |
| --- | --- | --- | --- |
| 1 | Architecture inventory and reliability report | Complete | `e3f1927758dae24110799975a84266b8c6196a1a` pushed; Vercel success; post-deployment health 200/ok at 09:44 UTC; 1,950 tests, lint, TypeScript, build and 20 readiness checks passed |
| 2 | Migration system and consistency | Guard released; isolated historical replay/reconciliation deferred by user | `760808e43daf11342a2e026d0e8ee68ffa701e9c` pushed; exact Vercel success; post-deployment health 200/ok at 10:32 UTC; 1,960 tests, lint, TypeScript, build and 20 readiness checks passed; no production SQL or ledger mutations |
| 3 | Keys, foreign keys and relationships | Released and verified | `3ba3644dea928219915a2497b6baef63e181513e` pushed; exact Vercel success; both post-deployment health endpoints 200/ok at 18:33 UTC. 2,973 tests, lint, TypeScript, build and 30 readiness checks passed. No migration or production write. |
| 4 | Duplicate and race prevention | Upcoming-date guard and media failure safety released; atomic gallery foundation in progress | Date guard `01c1f0f6275403caa72669e6b2a3c6edf16a8cb2` applied and verified. Media safety `685a53394f05c06579cfd18705651f8b1a43dc99` pushed and exact Vercel success; both health routes 200/ok at 20:22 UTC and 30 readiness checks passed. Gallery races remain within this step. |
| 5 | RLS and cross-role access | Pending | |
| 6 | Authentication and password recovery | Pending; test mailbox provided, isolated test environment deferred | |
| 7 | User/profile provisioning | Pending | |
| 8 | Query/error handling | Pending | |
| 9 | Transactions/atomicity | Pending | |
| 10 | Indexes/query performance | Pending | |
| 11 | Storage security/reliability | Pending | |
| 12 | Realtime lifecycle | Pending; no active subscriptions in baseline | |
| 13 | Privileged functions/RPC/webhooks | Pending | |
| 14 | Triggers/functions | Pending | |
| 15 | Data validation | Pending | |
| 16 | Timestamps/timezones | Pending | |
| 17 | Account/record lifecycle | Pending | |
| 18 | Environment configuration | Pending | |
| 19 | Failure resilience | Pending | |
| 20 | Observability | Pending | |
| 21 | Database regression tests | Pending | |
| 22 | Backup/recovery readiness | Pending | |
| 23 | Full end-to-end regression | Pending | |
| 24 | Final report/classification | Pending | |

Subsequent step commits record the prior step's full SHA, checks and deployment result, avoiding a self-referential commit hash in its own content. The final response must include the final step's deployment evidence as well. No later step may be marked complete based only on a plan or old audit.

## Step 1 validation

Validated against source baseline `6ef753e2a654d52a8621eed508d30072311b4a40` on 2026-09-09. `npm test` passed 1,950/1,950 with no failures, skips or cancellations. `npm run lint`, `node node_modules/typescript/bin/tsc --noEmit --incremental false`, and `npm run build` exited successfully. The build's postbuild hook reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. The read-only readiness probe passed all 20 checks. Production `/api/health` and `/api/health/supabase` returned HTTP 200 with `ok: true`. The five audit files were reviewed for credentials and data content; only metadata, source references and documentation are included.

The audit commit was rebased over the concurrent performance-report commit `d93ecffe5808efa849fc09cc0f0cb428cd0b8c1e`. The application, test, dependency and build-configuration trees were unchanged; the four added performance scripts passed targeted lint. Local HEAD and `origin/main` matched the pushed audit SHA before deployment. [Exact audit deployment](https://vercel.com/ai-movie-jobs/shiftstage/CCZpXzS6YwoMHzRvGEtGU6vAcyCz) reached success, and both health routes passed afterward. Subsequent work on `main` was fast-forwarded before Step 2.

## Concurrent security remediation

The dependency advisories recorded as DB-09 in the Step 1 snapshot were subsequently addressed by the separate security commit `43d851ba7ff1143c2e8639ee198578da6d0a4588`. Step 2 includes that commit, with Next.js 15.5.24 and sharp 0.35.4. A clean `npm ci` installed 359 packages and reported zero vulnerabilities. The original audit snapshot is preserved as historical evidence; this note records the subsequent resolution rather than attributing the dependency patch to the migration guard.

## Step 2 safeguard validation and remaining gate

Validated on source baseline `df0b3126769d511c65dfa4112331da7520273a70`, including the subsequent venue dashboard update. All 1,960 tests passed with no failures, skips or cancellations, including nine migration-history regression tests. Full lint, explicit TypeScript checking and the production build passed. The production build ran the new migration gate, confirmed all 128 historical files intact, disclosed four known collisions and reported `replayReady: false`. Its postbuild hook skipped layout-review population. All 20 Supabase read-only readiness checks passed. The final diff contains no changes to historical migration SQL, no database credential changes, and no schema/data mutations.

The guard was released independently as `760808e43daf11342a2e026d0e8ee68ffa701e9c`; its exact Vercel deployment succeeded and both health endpoints returned 200/ok afterward. Step 2 is not complete: deterministic historical replay, effect-by-effect ledger reconciliation and upgrade testing still need an isolated Supabase environment. The user provided a test mailbox, then deferred test-project setup and requested Step 3. Do not mark historical migrations applied, reset production, or substitute unrelated projects. The user's deferral permits the bounded Step 3 work above; it does not turn missing verification into a pass.

## Step 3 relationship review and removal recovery validation

The earlier local candidate was preserved, then adapted to current main. Full validation includes the browser-security update on `a777507f28d3c02d67c0bfc8f2f9e4c751259f19`. The final parent is `1878d946e3fa9f5d5472ce3383a9540778adbf7a`, which only adds performance reports and measurement-script changes. Application, test, dependency and build-configuration trees are unchanged; both changed measurement scripts additionally passed ESLint and Node syntax checks. Concurrent commit `cc1bf3d5` had already implemented archival and direct live/draft offer removal; that behavior is preserved and is not attributed to this step. This step confirms already-completed removals under the same venue so response loss or catalog failure does not turn a successful archive into a permanent retry error. It never hard-deletes, rewrites a completed removal timestamp, or accepts an unconfirmed zero-row write.

Fresh read-only production checks on 2026-09-09 covered all 195 FK references and three reverse-provisioning counts. Every FK orphan count was zero. All 79 application tables have primary keys; all FKs are validated; all 77 SET NULL references permit null. Profile-role, shift-affiliation and video/shift ownership mismatch counts were zero. One active dancer account has no profile; one inactive historical liquor CHECK exception remains. These findings require provisioning/lifecycle and validation review, not automatic data repair. The aggregate results contain no private records. No production data, schema, migration ledger, account or policy was changed.

Eight new in-memory PostgreSQL tests exercise the six actual retention foreign keys with synthetic data, along with six existing admin removal tests. All 14 targeted tests and all 2,973 full-suite tests passed with zero failures, skips or cancellations. Full lint, explicit TypeScript (`--noEmit --incremental false`) and the production build exited successfully; postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 30 current Supabase readiness checks passed again. Both production health endpoints returned 200/ok at 18:24 UTC before release. Clean dependency installation reported zero vulnerabilities. The PGlite fixture does not substitute for full Supabase historical replay or multi-connection concurrency testing. Exact deployment evidence remains required before the next step begins.

Git write access was restored before final delivery, and concurrent main was synchronized. This commit records pre-release validation; the following step must record its exact pushed SHA, Vercel success and post-deployment health before proceeding. Do not silently mark the full audit complete.

Step 3 was pushed as `3ba3644dea928219915a2497b6baef63e181513e` with local HEAD and origin/main matching. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/Nan3s9ih6nK2Z8uH88uXmZTLbzxU) succeeded. Both production health endpoints returned HTTP 200 with `ok: true` at 18:33:08–09 UTC afterward. Step 4 began only after this verification.

## Step 4 upcoming-date guard: validation

All 2,998 tests passed on source base `a91828a5e223f6161ecae5a1a9503f3d2af31365`, preserving the concurrent account recovery, profile styling and video cleanup changes, with no failures, skips or cancellations. Eight new PostgreSQL tests plus five existing boundary tests passed independently. Full ESLint, explicit TypeScript and the production build passed; postbuild skipped layout-review population. All 30 live Supabase readiness checks passed. The new migration adds one partial unique index without editing any historical SQL or changing data/RLS. Its normalized SHA-256 is `1bfb735c395dd0e853246d866f1295a693fef866be6a696eaa99b1b20daa2ea8`. A 19:01 UTC read-only recheck confirmed 53 shifts and zero duplicate dates or active sessions, including scheduled rows activated in place.

The complete bounded delivery transaction was tested against synthetic PostgreSQL rows: it locks the ledger/table, preserves a before/after row fingerprint, stores exactly this migration's SQL, confirms the valid unique index and RLS, and rejects a second application. No production migration was executed before this commit. The next controlled work must record production application, exact ledger checksum, Vercel success and post-deployment health; freeze the verified SQL in the history guard after application. The separately identified media slot/replace race remains in Step 4 and must be investigated before Step 5.

The upcoming-date guard was pushed as `01c1f0f6275403caa72669e6b2a3c6edf16a8cb2`, with local HEAD, origin/main and the remote main ref matching. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/CDJQGWiiQQnz5gCNqCwanZe25vie) succeeded. During deployment, only the committed `20260909183820` index migration and its own ledger entry were applied in the bounded transaction. Verification at 19:34:24 UTC confirmed exact committed SQL/hash, a valid/ready unique index, retained RLS, zero duplicate dates and all 53 shift rows unchanged. Both health endpoints returned 200/ok at 19:34:51–52 UTC and all 30 live readiness checks passed. The verified migration is now frozen in the history manifest. No historical ledger entry or user data was changed.

## Step 4 media publication safety: current controlled release

See `step-04-media-publication-safety.md`. The next release removes destructive compensation after uncertain publication, preserves completed moderation decisions, and uses a conditional avatar update to reject stale writers. It adds no database migration or production data repair. The full release checks and deployment remain required; gallery allocation/atomic publication remain separate work within Step 4.

The release passed all 3,030 tests and full lint on application base `6e66f848ec64f2894ec6d109c2853086adcb65ea`, including thirteen new fault/concurrency tests. Final parent `9a138ab0dd6d4977e10708ac7d5949e07c3e5fbf` adds only unrelated button CSS, its generated version and test assertions; its four affected tests and targeted lint passed again. Application, dependency and build-configuration trees are unchanged by that final synchronization. The production build passed with the updated CSS version verified in the output; standalone TypeScript passed after the build finished. All 30 current readiness checks passed. An earlier typecheck/build overlap was resolved by running them sequentially. No real photos, accounts or emails were used for testing. Exact deployment verification remains the final gate before the next controlled change.

Media safety was pushed as `685a53394f05c06579cfd18705651f8b1a43dc99`, with local HEAD and both remote main references matching. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/8bXqX5DyfzGB82ARQ2mN6tTqNuaN) succeeded. Both health endpoints returned HTTP 200/ok at 20:22:47–48 UTC on 2026-09-09. Empty unauthenticated POST requests to dancer photos/avatar and administrator image moderation/avatar recentering all returned 401 afterward. All 30 readiness checks passed. No database migration, account, storage object or production media record was changed by this release.

## Step 4 atomic gallery foundation: current controlled release

See `step-04-gallery-publication-foundation.md`. This release adds durable add/replace intent and a service-only atomic publisher, with no caller switch or production media publication. The next release must connect upload/retry/admin callers and preserve the selected replacement photo identity. Step 4 is not complete merely because the unused function exists. Historical replay remains deferred, and production application plus exact deployment verification remain required before beginning the caller change.

All 3,088 tests, full lint, production build, standalone TypeScript and thirty live readiness checks passed on `94eca43fdb3e4e8a6e8f79648b4e2cda03f11278`. This includes the independently published original-photo retention fix and styling changes. Eighteen new native PostgreSQL tests passed; a separate synthetic test verified the full delivery transaction, preservation assertions and repeated-application rejection. The build skipped layout-review population. Fresh read-only preflight found 72 photos, 16 profiles, 43 review records, all three RLS protections enabled, and no existing target migration/function/columns. The new migration's normalized SHA-256 is `819e7b9651aacb26fa480416b1ec67c23f331feddfceb53e64b7584065e63301`. No production write has been made before this commit; exact SQL application, commit deployment and postflight verification remain the final release gates.
