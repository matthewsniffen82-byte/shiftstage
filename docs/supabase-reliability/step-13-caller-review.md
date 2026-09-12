# Step 13 — privileged caller review and remaining-step handoff

This closes the controlled privileged-interface review after its release gates pass. It preserves the separately scheduled trigger, validation, lifecycle, failure, and hosted-regression work below. It does not certify every business operation or deferred hosted test.

## Release reconciliation

The predecessor `db9dbf0bd908d68843ce9f389c576a2ed18c02b6` has a successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/76VDnskiJEviDTd5uYFHb5xmVHAt), freshly confirmed on 2026-09-12. Both production health routes returned HTTP 200/ok at 04:15:34–35 UTC; all thirty read-only readiness checks passed. Its recorded 6,166-test/full-check validation remains prior release evidence, not a new full run by this task.

Fresh read-only catalog capture at 04:16:27 UTC contains 131 public functions, 99 definers, 41 trigger-returning functions, one event-trigger function, and 117 migration records. Every one of the 31 recorded fourteen-digit migrations from September 9–10 has exactly one source file and an identical normalized SQL MD5. Historical migration gaps/collisions remain deferred; this comparison neither repairs nor certifies historical replay.

The function-security gate passed at 04:15:48 UTC, with four anonymous and seven authenticated interfaces. The independently running review task confirmed the gate again at 04:17:06 UTC and checked the installed dancer-tap functions and migration. Registration remains `dd876469ac66d123922e9da3fd4e33b3`; deferred completion remains `f382dae05f592ee9b34cdad4e6c4afe7`; migration `20260910172000` remains SQL MD5 `5c4fe70307f6dcf3027be2a513881400`. Both functions retain postgres ownership, service-only execution, and `public, pg_temp` search paths. The migration was not reapplied.

Current aggregate counts include 452 storage objects, sixteen dancer profiles, twenty tags, and four enrollment rows. These fresh counts cannot retrospectively prove that every application row stayed unchanged since September 10. No old private before/after capture was copied into the authoritative D: checkout. The concurrent, separately authorized demo-scheduling release changed one marked upcoming shift to canceled; it changed no function, schema, grant, or migration. Preservation for this review is measured from its new read-only baseline, without asserting a historical row comparison that was not available.

## Applied-migration source protection

The current guard passes while treating seventeen already-deployed migrations as new files: 159 source migrations exist, but only 142 are frozen. For an unlisted file, the guard checks the timestamp/name and nonempty content without comparing its deployed SQL. An edit to one of these applied functions can therefore pass the build-facing history check even though the database remains on the original definition.

Extend `supabase/migration-history-baseline.json` with only those seventeen verified source hashes, from `20260910054000` through `20260910172000`. The [verification record](step-13-applied-migrations.json) retains each exact filename, normalized SHA-256, and matching live-ledger SQL MD5. Preserve all existing 142 entries and their metadata. This is not regeneration to hide a failed check: the preceding guard passed, and each addition was independently matched to exactly one live ledger record before inclusion. All eighteen current function bodies defined in this cohort match their latest migration bodies. Fresh schema metadata at 04:43:52 UTC verifies both new tables and private RLS boundaries, five trigger attachments, the invoice unique constraint, retained uniqueness indexes, the history index, and both intended index removals. Historical SQL files and remote ledger rows remain unchanged; `replayReady` remains false.

The eighteen-case `applied-migration-history.test.mjs` regression uses a private temporary copy of the 159-file historical cohort. For each of the seventeen additions, it changes that file alone and confirms that the preceding 142-entry manifest admits the change while the extended manifest rejects it as changed historical SQL. All seventeen file cases and the parent test pass. Later new migrations remain outside this fixed regression cohort and require their own release verification.

## Interface and caller findings

The metadata-only [caller map](step-13-caller-map.json) records all 131 signatures, body fingerprints, current effective execution rights, and literal application references. Seventy function names have literal application references; this includes dormant helper exports and is not a reachability proof. Nineteen non-trigger functions have no literal RPC reference: they include nested NFC/financial functions, policy/display predicates, and deliberately unavailable legacy helpers. No literal RPC name in the inspected `app`/`src` TypeScript tree is absent from the live function inventory. Dynamic construction, external/manual tools, and indirect SQL dependencies require their own review; the map does not authorize deletion.

| Boundary | Current behavior and evidence |
| --- | --- |
| Intentional browser interfaces | The seven exact definitions and effective access are pinned by the release checker. Existing native database/browser tests cover active administrator settlement/void authorization and ordinary-role denial. Role helpers are scoped to the authenticated identity; display/validation predicates expose no private record-returning interface. |
| Payout, paid recovery, cashier allocation, dancer tap | Step 13's separately deployed corrections protect payout retry ownership, atomic recovery flags/audit, allocation snapshots, and common per-dancer lock order. Existing focused native and caller tests remain the regression evidence; this closure does not replace them. |
| Sticker administration | Creation, rotation, and status HTTP handlers derive `adminUserId` from verified request context after active database-admin authorization. The three service-only functions independently check the active admin. Capacity validation remains Step 15; it is not fixed by correct actor identity. |
| Sales-agent and referral administration | Routes derive the administrative actor from verified context, retain a distinct user/venue target, and use service-only operations. Functions reject missing/inactive/non-admin actors and retain mandatory audit writes in their transaction. Sponsorship, contract dates, and lifecycle invariants remain Steps 14–17. |
| Pilot reporting and claim-code revocation | Verified administrative identity is passed separately from the submitted target. Pilot upsert and revocation functions validate active admin; revocation retains used-code rejection and repeat-safe audit behavior. |
| Retired venue claims/manual issuance | Public claim GET/POST return 410; administrative claim POST authenticates then returns 410 without reading the body or creating a privileged client. Manual code issuance returns 410; code revocation and historical read access remain supported. `reviewVenueOwnershipClaim`, `createVenueOwnershipClaim`, and `issueVenueClaimCode` have no application callers outside their own definitions. The dormant claim/venue lock-order risk is not a reachable public claim workflow and must be reviewed before any reactivation. |
| Team/signup redemption | Verified user identity and resolved code/invitation IDs are sent to service-only database operations. Token digests, matching email/account checks, locked consumption, and the one-active-team unique index remain. Recovery after uncertain redemption is a lifecycle boundary; the architecture task is reviewing provisioning compatibility independently. |
| Rate limits, metrics, support | Public callers construct allowed parameters and actor context on the server; raw service-role access is not returned to the browser. Rate-limit failures fail closed unless the specifically recognized historical missing-function compatibility path applies. Existing boundary/native tests cover the delivered support and metric operations. |
| Webhooks and workers | The discovered public provider webhook is Stripe; it retains a bounded body and verified signature before privileged work, and existing replay/attempt tests cover payment receipt ownership. This does not certify inactive providers. NATS export claims, completion/failure and reconciliation remain service-only. External delivery uncertainty and stale worker completion remain explicit Step 19 work. |

## Executed regression scope

`tests/privileged-caller-identity.test.mjs` executes the actual eleven administrative route actions with the existing request-context fixture, actual active database-admin guard, and bounded JSON parser. Downstream business helpers are synthetic spies; no production RPC, notification, sticker, payout, or account is invoked.

The external draft passed all 26 new cases, and the existing administrator/retired-claim boundary suite passed all 364 cases. The new cases verify:

- Forged body/header/query actor fields cannot replace the verified administrator; the service transport is created only after authorization.
- A timeout from each selected business helper yields an unavailable response and does not replay the operation in that request.
- Public retired claim routes remain closed, and even a verified administrator cannot use the retired review or manual issuance paths.

An external mutation rehearsal changed the sticker handler's actor to a body-supplied value. The corresponding test failed with the forged value; the unmodified draft passed all 26 cases. This establishes that the new identity assertion detects the intended regression. It does not claim that these helper spies execute PostgreSQL transaction behavior; the existing native function suites provide that separate coverage.

## Required later work

| Step | Explicit remaining responsibility |
| --- | --- |
| 14 | Inspect all current trigger attachments, Auth provisioning/email triggers, managed RLS event-trigger formatting/failure behavior, and multi-table failure propagation. Direct trigger-function execution remains denied to API roles. |
| 15 | Serialize the 25-active-sticker capacity check across provision/enable/disabled rotation; inspect null/domain/constraint validation and the retained historical CHECK exception. Do not change existing tags or history as a test. |
| 16 | Preserve timestamp precision, transaction-versus-wall-clock semantics, date/timezone boundaries, and scheduled contract/shift behavior. |
| 17 | DMCA cross-case serialization and later manual suspension/hide decisions; account/Auth coordination; avatar/profile/moderation transitions; venue derivative retirement and ownership; safe retirement of dormant claim helpers. |
| 18 | Environment targeting and scripts/manual writers, including retired helpers and migration replay safeguards. Never reactivate old routes or replay historical SQL to satisfy the audit. |
| 19–20 | NATS/provider/email completion, attempt identity and uncertain acknowledgments, durable reconciliation, retained upload recovery and safe diagnostics. A processing status check alone is not proof that a callback belongs to the latest attempt. |
| 21–23 | Full database/cross-account regression, independent-connection concurrency, designated mail/accounts, reproducible migration replay, isolated restore and storage-byte recovery. Existing user deferrals remain explicit pending designated resources. |
| 24 | Final classification must disclose all unverified/deferred evidence and unresolved findings; neither a successful Vercel deployment nor a read-only permission gate makes those tests pass. |

This release extends the migration build guard's protected-source manifest and adds tests/audit records. It changes no SQL file, application runtime behavior, production definition, grant, table, storage object, or remote migration record. Rollback is an ordinary source revert, which would remove the added edit protection; no database rollback is needed. Full automated tests, standalone TypeScript, lint, production build, exact commit/push/Vercel success, and post-deployment read-only checks remain the release gates before Step 14 starts.

PostgreSQL documents that definer execution uses the owner's privileges and that safe search paths must exclude untrusted schemas; the [official function documentation](https://www.postgresql.org/docs/17/sql-createfunction.html) and [Supabase function guidance](https://supabase.com/docs/guides/database/functions) inform the access review. The current allowlist must not be widened automatically to suppress a failed check.

Final combined validation on `34b6f50dadd61a5b38f7b3831499d34c8a21040b` passed all 6,269 tests with zero failures, skips or cancellations, full lint, production build, standalone TypeScript after the build, thirty read-only readiness checks and the live function-security gate. The build skipped population. The migration guard protects all 159 current source files, retains the four historical collision groups and reports `replayReady: false`. Generated files had only newline changes and were restored after checking their normalized content against HEAD. The preceding architecture release removes the legacy provisioning fallback; its successful deployment is preserved. No SQL file, application runtime, database record, function or grant is changed by this release. Exact commit/push, Vercel and post-deployment preservation/health remain the final gates.
