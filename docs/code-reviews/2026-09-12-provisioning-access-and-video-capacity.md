# Independent release review: provisioning, access checks and video capacity

Reviewed on 2026-09-12 UTC from `D:\Codex\MyDancr-clean-2026-09-11`. This continues the previous scoped review in [error boundaries and function access](2026-09-12-error-boundaries-and-function-access.md).

## Verdict and exact scope

**Approved within the scope and evidence limits below.** One low-severity gap in the migration checksum baseline was confirmed and corrected during the review. The correction is independently verified on its committed, successfully deployed source. No additional actionable runtime defect was confirmed in these five releases.

| Commit | Reviewed change | Independently checked deployment |
| --- | --- | --- |
| `34b6f50dadd61a5b38f7b3831499d34c8a21040b` | Require atomic account provisioning; remove legacy table writes | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5RqEiNACJtqxuqzeUeyrgWuaF7Bn) |
| `f1cb4ff3b554c431b1195facdde7b7a2c3f218d5` | Freeze 17 applied migrations and close privileged HTTP caller review | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/9m7RMvbn17cqVAMbPNvVFo5wuAnA) |
| `3e8106d781e578a982e2cbdcdaf210c19f988cd7` | Sanitize stored payout and NATS diagnostics | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/CdSZ6de1eW7vrqkmWw23GRCBoNwm) |
| `5e04e6359671af0cbccbe8e1604aed71c306e00b` | Refresh the database access fixture and add an offline drift checker | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DTTKfvKxd1HgzKhH34K2U5VRjbJy) |
| `ef752f858c5284bdd69f0089187aaeca4e4dbdd5` | Attach and enforce the profile video capacity trigger | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DLFDgDX2BgtBGzR4RuvWxz17fjcU) |

The verdict covers these five commits and the narrow checksum correction identified below. Later security logging, browser session, TV playback and NFC changes retain their own release scope. Including them in the final branch validation does not constitute an independent code-review approval of those changes or all of `main`.

## Confirmed finding: installed migration missing from the frozen baseline

**Low severity, release verification.** At 05:55:56 UTC, production contained migration `20260912052200_enforce_profile_video_slot_limit.sql`, but its source was absent from the 159-entry checksum baseline. In an external copy, adding a synthetic SQL statement to that already installed migration still passed `verifyMigrationHistory`: the checker treated it as one new file. There was no observed source drift or video-capacity failure; the missing checksum allowed future edits to escape the historical-source guard.

The original 142 entries and manifest metadata remain unchanged. All 17 hashes added by `f1cb4ff3` independently match the normalized committed sources and actual production ledger statements. The video source also matches its installed ledger statement:

- SHA-256: `be8cc1c64cbde3c49ca9ee2e315d838224fe3f635e68f10f3ccd37c7096aceda`.
- Ledger/source MD5: `189cc62ce11abf2e71b61fae66cbd43b`.

**Resolved.** The video checksum was added in `c5d3ddc91178c81df1c884050d401682b81603eb` ([exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/AoyhjPbTF8sU5hFLrKeLqYccrJjR)); its committed baseline exactly matches the independently tested candidate. Closing release `ad0208a57a9c54bbca32fc650a25a07ce89618fb` ([exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DmTMHVUUmpPFZKJcSaWdpoGWZy6Y)) also freezes the subsequently installed NFC migration and adds three regression cases. At **06:38:46 UTC**, an independent run against that clean committed source preserved all prior 159 entries and manifest metadata, passed all 161 files with zero unfrozen files, and rejected separate synthetic edits to each newly frozen migration specifically as changed historical SQL. This approval covers those checksum protections; it does not review the NFC migration's business behavior. Evidence: `candidate-baseline-proof.json`, `first-baseline-delivery.json` and `baseline-closure-proof.json`.

## Source and regression review

- **Account provisioning:** the helper makes one atomic RPC and requires a literal successful acknowledgement. Missing-function errors and uncertain failures propagate without a sequence of legacy account/profile writes or automatic retry. Existing names, approval state, aliases and customer cities remain protected by the database provisioner. An independent controlled client using exact historical source observed `rpc` followed by `legacy-table-write` before the change, but only `rpc` with the original error preserved afterward. This does not make external authentication and application provisioning one transaction.
- **Privileged callers:** actual route tests bind the administrator actor to authenticated identity despite forged body/header values. Uncertain RPC outcomes do not cause repeated mutations. Retired public claims and manual issuance stay retired; administrative authorization and the supported revocation path remain intact. The literal caller inventory is not a proof of every possible dynamically assembled call or every function's business semantics.
- **Stored diagnostics:** payout errors now retain only six authored messages or a fixed fallback. NATS receipts retain canonical success text, bounded content types and HTTP status. Raw provider bodies, transport exceptions and arbitrary database messages cannot become the new diagnostic strings through the reviewed paths. Dispatch claims, idempotency, counters, successful invoice completion and definite-failure versus reconciliation classification remain intact. The change protects future writes and does not rewrite all historical records.
- **Access drift:** the fixture adds the two gallery-history/storage-retirement tables without changing the previous relation entries, policies, views or helpers. An independent comparison against fresh production metadata fails the old fixture on public relations and passes all 19 checks with the new fixture. The checker compares RLS, CRUD grants, policy/view definitions, selected helper definitions and storage security. Column privileges, role membership and other function semantics require their separate checks; the capture timestamp is not a freshness guarantee.
- **Video capacity:** the invoker trigger runs after insertion or a relevant update, counts occupied `profile_and_feed` records, and rejects counts above 50 while allowing existing occupied-slot edits and released-slot reuse. A per-dancer transaction advisory lock precedes a separate count query. Transfers acquire the destination lock. Repeatable-read additions are rejected explicitly; the production default is read committed. Ignored inserts do not consume a slot, and a failing statement rolls back. Existing unrelated video triggers remain attached. The guarded deployment checks captured schema/function prerequisites and the expected replacement before recording the installed statement; the review did not execute that deployment against production.

The fresh focused run passed **412 tests with zero failures, skips or cancellations** across provisioning, caller identity, applied history, payout dispatch, NATS privacy, access matrices/checkers, function security and video behavior/deployment fixtures. These test files are recorded in `focused.log`.

Additional independent negative controls ran the exact release harnesses against historical source in external directories. The 56-case NATS harness produced **46 expected failures and 10 passes** on predecessor `f1cb4ff3`; `3e8106d7` passed all 56. The payout dispatcher harness produced **six expected failures and 55 passes** on that predecessor; `3e8106d7` passed all 61 against the native PostgreSQL fixture. These reruns corroborate the fixes and are not additional unique focused cases. No provider request left the synthetic harnesses.

## Fresh production evidence

Metadata captured at **05:54:54 UTC**, the separate function-security gate at **05:55:00 UTC**, and the ledger/aggregate check at **05:55:56 UTC** were read-only. They established:

- **131 public functions, 99 security definers and 118 migration entries**. The function gate passes with four intentional anonymous and seven authenticated interfaces.
- `provision_app_account_safely(uuid,text,text,text,text)` has definition MD5 `4976257073739281a44a64f8a33324f7`, PostgreSQL ownership, definer mode, empty search path and a three-second lock timeout. Browser roles cannot execute it; the service role can.
- `enforce_mydancr_tv_profile_video_limit()` has definition MD5 `7712668d238dcb107394fde5db83ff9f`, PostgreSQL ownership, invoker mode and `pg_catalog, public, pg_temp` search path. Anonymous, authenticated and service roles have no direct execution grant.
- The enabled video trigger is `AFTER INSERT OR UPDATE OF dancer_id, distribution_scope, status`, for each row. Both existing video-link and review-decision triggers remain. There are **60 application/Auth attachments** and four storage attachments; those different schema totals do not indicate drift.
- All **82 explicit public column grants** are SELECT. Browser roles have no login, superuser, database creation or RLS bypass privilege; browser/service roles have no outgoing membership. The service role's intentional RLS bypass remains.
- Aggregate-only video counts show **34 videos, zero profiles above the limit and a maximum occupied count of four**. No application row contents or private identifiers were retrieved. No role-specific transaction-isolation overrides were found.
- The current access fixture independently passes **all 19 comparisons** against the fresh catalog export.

The PostgreSQL concurrency reasoning is an inference from the separate lock/count statements, volatile function behavior and documented snapshot/trigger semantics. It is supported by native PostgreSQL-engine fixtures, not a new independent hosted two-session concurrency experiment. See PostgreSQL 17 [function data visibility](https://www.postgresql.org/docs/17/spi-visibility.html), [trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html) and [transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html). The embedded engine uses PostgreSQL 18; the documented check-expression normalization does not prove all PostgreSQL 17 behavior identical.

Historical release preservation receipts remain historical evidence. This review does not reconstruct earlier application/storage data fingerprints, exercise live financial providers, issue production business RPCs, replay migrations or claim a complete hosted JWT/storage authorization audit. No production data mutation was used as a test fixture.

## Report delivery validation

The report changes only this Markdown document, with application source frozen at `ad0208a57a9c54bbca32fc650a25a07ce89618fb`. Independent final validation completed as follows:

- **6,604 automated tests**, zero failures, skips or cancellations (06:39:18–06:42:55 UTC).
- Full uncached ESLint, zero warnings (06:39:36 UTC).
- Production build, including the history guard and generated assets (06:43:18–06:44:03 UTC). Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`.
- Standalone TypeScript after the build, with incremental output disabled (06:44:29 UTC).
- All **30 read-only readiness checks** and the current function-security gate passed. The latter reports **132 public functions and 99 security definers**, including the subsequent NFC addition, with four anonymous/seven authenticated interfaces and no application functions invoked.

The additional read-only ledger check at **06:39:50 UTC** independently matches both newly frozen files to their installed statements. The video MD5 remains `189cc62ce11abf2e71b61fae66cbd43b`; the NFC source/ledger MD5 is `be42c9234a262d649d2cdca5592dbc20`. Aggregate video counts remain 34 total, zero over-limit profiles and maximum occupancy four. This verifies the installed sources and current access gate without extending the NFC business-logic review scope.

The migration guard passes **161 frozen files**, with no unfrozen files. Historical version collisions remain quarantined (`replayReady: false`); no migration replay or remote ledger repair occurred. The local preview remained stopped. The build leaves no generated-file content changes, and no unrelated file is staged.

Final receipts are `delivery-tests-result.json`, `delivery-lint-result.json`, `delivery-build-result.json` and `delivery-typescript-result.json` with their logs, plus `post-closure-database-proof.json` and `readiness.json`. This document records validation completed before its own commit. Its commit SHA, exact deployment success and post-deployment health are recorded in the final task response and external delivery receipt.

Evidence is stored outside the repository at `D:\Codex\MyDancr-validation-2026-09-11\code-rabbit-next`: `focused.log`, `catalog.json`, `access.json`, `function-security.json`, `access-check.json`, `ledger.json`, `source-ledger-proof.json`, `video-history-gap.json`, `independent-negative-controls.json`, `nats-negative-controls.json` and `payout-negative-controls.json`, plus the synthetic predecessor/current logs. The gap reproducer and synthetic fixtures modify only external copies. Final validation and deployment receipts are recorded there separately; this document does not claim its own future deployment before it occurs.
