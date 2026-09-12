# Consolidated architecture and stability closeout

Reviewed on `72d32f5bd04dbc0c09a9cb1f62a6e635158c343f`.

This parent includes the separately verified Security 29 and consolidated
Supabase releases described below. Their final receipts were read and their
exact Vercel success independently confirmed before this release was integrated.

On September 12, 2026, the owner chose to consolidate the remaining architecture
reviews. Steps 0–14 retain their individual releases. Step 15 delivers the
confirmed notification and monitoring corrections and this combined review of topics
16–23. There is no additional release loop for documentation-only topics.

The final record distinguishes deployed corrections, inherited controls,
remaining concrete findings and checks that were not performed. Completing this
review does not establish that every possible application defect is absent.

## Remaining topic coverage

| Original topic | Consolidated result and practical limit |
| --- | --- |
| 16 — Dependencies and runtime | Reviewed locked installation, lifecycle controls and native executable verification; fresh advisory/signature results are recorded with this release. |
| 17 — Release gates and rollback | Reviewed the canonical gate, repository workflow and hosting controls; application rollback must be compatible with current database permissions and external effects. |
| 18 — Health and diagnosis | Liveness, Supabase health and read-only readiness are separate signals; none certifies message delivery, a business journey or recovery. |
| 19 — Migrations and recovery | Reconciled frozen SQL provenance and forward cutovers, inspected available backups, and recorded a recovery procedure and missing rehearsal evidence. |
| 20 — Critical journeys | Reviewed executable regression coverage and bounded public browser checks; hosted private-account/provider exercises remain unperformed. |
| 21 — Resource use | Reconciled the independently delivered response, query and request bounds; no production stress test or whole-process capacity guarantee. |
| 22 — Maintenance | Recorded the release, provider, recovery and unresolved-worker responsibilities below without adding a watcher, schedule or paid service. |
| 23 — Final audit | Audited prior release receipts and ancestry; this release receives its own full validation, push, exact Vercel status and health receipt. |

## Installation and release controls

The lockfile supplies the dependency graph. The project pins npm 11.19.1,
requires Node 24.18.1 or newer within major 24, and recommends 24.21.0 locally.
Strict lifecycle allow-listing disables the upstream `ffmpeg-static` downloader
and `unrs-resolver` install hooks. The application installer validates download
origins, archive and executable sizes and SHA-256 values, extracts named members,
rejects executable overrides and checks temporary cleanup targets. Runtime checks
reverify and exercise the actual executable using synthetic pixels.

The canonical gate runs advisory and registry-signature checks, runtime and
generated-asset checks, all automated tests, route types, standalone TypeScript,
full zero-warning lint and the normal production build. Test processes receive a
restricted synthetic environment; the final build retains configuration and
lifecycle checks. A separate configured artifact scan checks the output against
private values. Ordinary builds leave maintenance population disabled.

Fresh dependency and runtime observations for this integrated release are
recorded in the final local validation section below. Earlier Step 14 results
remain dated evidence in that release's report.

The reviewed GitHub workflow runs for relevant pull requests or manual dispatch,
pins actions by commit, uses read-only repository permissions and does not persist
checkout credentials. Documentation-only pull requests are excluded. Manual
dispatch includes Linux and Windows; normal pull requests use Linux. The timeout
is a ceiling, not measured spending or permission to increase the project budget.

Read-only GitHub and refreshed Vercel settings were captured on September 12
at 18:25:24 UTC. GitHub `main` was unprotected, required status contexts were
empty and no repository rulesets were returned. The workflow is not triggered
by an ordinary direct push. These observations must not be represented as
enforced branch protection.

Vercel's current production settings pointed to Security 29's deployment and
showed `npx --yes npm@11.19.1 ci` and
`npx --yes npm@11.19.1 run verify:release` as its install/build commands. The
project uses Next.js and Node `24.x`; that setting does not certify an exact
hosted patch version. No additional deployment checks were configured, rolling
releases were disabled, and deployment/Git sources inherited unrestricted team
policies. No setting was changed. The external
`consolidated-release-controls.json` preserves the dated observations.

The release operator should preserve these gates and check the actual pushed
commit's hosting result. A reviewed forward fix or revert requires the same
validation. Old application code can expect permissions or contracts that newer
database releases intentionally removed. An old successful deployment is not a
safe rollback merely because its original build passed. Code rollback does not
reverse database rows, Storage changes, payments or messages.

## Operational checks and test evidence

The public liveness endpoint reports service availability and time. The Supabase
health endpoint probes a bounded profile query and Auth health, uses private
no-store responses and returns generic failure information. The release readiness
script checks current API projections, private-column denials, Storage policy,
schema and function presence. These are read-only checks with specific limits;
presence does not prove every database effect or real-user flow.

The liveness response does not expose a source revision. Exact-commit Vercel
status and production-alias health are therefore recorded as separate evidence.
Optional revision metadata was not required for this essential-fix closeout.
Configuration indicators are not provider reachability or delivery evidence;
Step 14 now displays unavailable monitoring results truthfully.

This final release aligns the open copyright-case count with all five existing
active queue states. An individually reviewed terminal case stays outside that
count. Missing or malformed counts produce the existing warning and unavailable
home/more workspace badges; confirmed zero remains distinguishable. This does
not convert every existing numeric detail into a nullable value. Twelve actual
module/helper tests with synthetic queries passed at 18:40:33 UTC; eight failed
against the previous code. The exact count remains independent of the panel's
100-record display limit. No case lifecycle, privilege or SQL change is part
of this architecture correction.

Regression coverage includes account/session ordering, logout and recovery
feedback, preference and authorization decisions, public visibility, moderation
and publication receipts, rate-limit admission, provider uncertainty and database
permissions. Synthetic service tests, actual installed SDK adapters, React
rendering checks and isolated PostgreSQL fixtures each have distinct boundaries.

Examples of executable evidence:

| Coverage | What it exercises | Limit |
| --- | --- | --- |
| [Session response ordering](../../tests/customer-session-response-order.test.mjs) | A late response cannot replace refreshed credentials or undo logout/account replacement in shared storage. | Synthetic storage/network and extracted homepage functions; no hosted multi-device session. |
| [Public visibility](../../tests/public-visibility-fail-closed.test.mjs) | Missing, malformed, contradictory or unpublished profile state stays private across reviewed service paths. | Synthetic query results; no production fault injection. |
| [Role isolation](../../tests/rls-runtime-isolation.test.mjs) | Anonymous, ordinary account and administrator access decisions execute against an isolated database fixture. | Captured fixture boundaries; no complete hosted Auth/Storage environment. |
| [Notification response handling](../../tests/notification-response-cleanup.test.mjs) | Actual delivery code consumes bounded creation receipts and releases unused or interrupted native stream bodies. | Synthetic provider responses; no message was sent or received. |

The final local validation section records this release's complete test count.
The separately delivered Security 29 receipt records 8,898 passing tests and
all eight canonical gates. On September 12 at 18:09:10 UTC, that task opened
the production homepage and read its warning/error output: 14 dancer cards,
17 clubs, seven working now and two upcoming, with no warnings or errors.
That check covered opening the homepage only; it was not a complete journey
or a viewport comparison. Four public response projections also passed at
18:08:27 UTC. Samples ranged from 7,918 to 319,345 bytes; these observations
are not maximum response-size guarantees. Direct owner fields were restricted,
while public media URL paths can still contain opaque identifiers.

Step 7's earlier 23-request document/header inspection used HTTP requests and
HTML parsing, not an interactive browser. The separate TV task's earlier viewport
and playback work remains dated evidence from that task. Neither is presented as
a new hosted private-account journey in this closeout.

No disposable hosted identity, explicit test inbox or isolated recovery project
was designated. Hosted multi-device recovery, email confirmation/delivery,
production uploads, external settlement and a restore rehearsal were not run.
The local preview remained stopped after its automatically rejected restart.
No real messages, payments, account changes or media publications were performed
to obtain architecture review evidence.

## Resource and worker findings

Security 29 shipped as `8e01369bda91831d0f3952062082b21f67899a0d`, with
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/EjPuUPu6bnEf373GrwrgqvAPmytf)
and its final receipt at September 12 18:09:12 UTC. Its source and receipt were
reviewed for this closeout. Supabase response reads cap decoded JSON at 16 MiB
and Storage responses at 96 MiB, with cancellation and bounded accumulation.
Request-body transfer deadlines are 30 seconds for JSON and 120 seconds for
multipart data. Public directory queries bound each optional shift window and
approved-photo collection at 50 rows; existing parent limits remain separate.
Finite eligibility filters, stable ordering and live-presence priority preserve
the reviewed semantics within those windows. Exhausting a window can hide
presence; the bounds do not establish complete discovery over arbitrary data.
Public share QR encoding uses a 60-request-per-client-address-per-minute budget,
including URL variants, with private no-store failure responses.

At 17:40:41 UTC, two actual server-caller queries with outer limit zero returned
HTTP 200 and zero rows. That evidence checks hosted syntax and columns, not row
selection, query plans, concurrency or Auth issuance. The earlier failed direct
anonymous attempt and corrected fixture failures remain in the original receipt.
Security 29 added no SQL and preserved the 171 frozen migration records.

Request deadlines and response/query limits reduce bounded work; they do not
prove an aggregate memory limit across concurrent requests, an optimal database
query plan, a final API payload ceiling or sustainable peak production traffic.
No synthetic failure was injected into production and no load test targeted users.

Whole moderation-job deadlines, stale image-worker recovery and ownership checks
before avatar/TV publication remain open at the reviewed Security 29 boundary.
Request-body deadlines and response byte caps do not fix these worker findings.
Earlier architecture Step 13 did deliver provider time limits, sibling-frame
settlement and audio cleanup. It did not establish a whole-job timeout or stale
publication fence. The Security task retains the separate worker follow-up;
planned corrections are not counted as delivered in this report.

## Migration and recovery record

The migration guard verifies immutable historical SQL hashes and unique forward
timestamps while quarantining historical duplicate groups. Its `replayReady:false`
result is intentional: source provenance is not clean replay or evidence that
every historical effect ran. Ledger gaps do not authorize a batch replay.

The Supabase consolidated closeout shipped as
`72d32f5bd04dbc0c09a9cb1f62a6e635158c343f`, with
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/H6N5bq4abCic1uPLMc72vpWkoco5),
8,993 passing tests, all eight gates, configured artifact inspection, postbuild
TypeScript, 58 readiness and ten deployed health/access checks. Its final receipt
closed at September 12 18:45:20 UTC. The source, caller differences and final
receipt were reviewed for this architecture closeout.

Its guarded migration `20260912181237` applied once after the compatible code
deployed. The committed source SHA-256 is
`f89fd03c2ef250ac87d94f8f0a0b13402ab5dfba2721b62dfb800d80c216a9cc`.
It removes browser/PUBLIC direct lifecycle writes on copyright cases,
counter-notices and strikes, the selected legacy service writes and explicit
column grants, and non-owner execution of the retired venue-claim reviewer.
Service claimant inserts and read/history access remain. Retained service
truncate/reference/trigger privileges and the unused JavaScript helper are not
claimed to be removed. Current native case, restoration and forwarding
transactions remain authoritative.

Independent verification at 18:45:08 UTC preserved all 85 full-record table
fingerprints, unrelated metadata, six foundation functions, three ownership
attachments and all 129 prior ledger entries; the ledger advanced to 130.
The migration guard now protects 172 source files. This is the dated cutover
preservation boundary, not a claim that later ordinary application traffic cannot
change counters. The earlier checked-caller release `6f1a9048` preserved all
85 row counts and 84 fingerprints; its separate changed TV request-counter
fingerprint remains qualified in that original receipt. The later successful
check does not rewrite that earlier evidence.

The accompanying contact-save and audit receipts distinguish saved values from
an uncertain audit entry. The administrator can retrieve an exact completed
case after an uncertain action without repeating its write or email. This
recovery lookup does not change the five-state active queue or its monitoring
count. The final Supabase evidence is retained in
`supabase-hardening/step-17/closeout-final-delivery.json` under the external
validation directory. Previously applied forward migrations and this cutover
remain frozen; none was replayed by this architecture review.

The production backup dashboard was inspected read-only on September 12 at
17:14 UTC. It listed eight physical database snapshots dated September 5–12,
newest September 12 10:08:02 UTC and oldest September 5 10:06:29 UTC. Point-in-time
recovery was disabled; the page offered an add-on to enable it. This dated list
does not prove a retention guarantee or a successful restore. No download,
restore or paid configuration change was performed.

Both the dashboard and Supabase's [backup documentation](https://supabase.com/docs/guides/platform/backups)
state that database backups exclude Storage objects. The
[restore-to-new-project procedure](https://supabase.com/docs/guides/platform/clone-project)
also requires separate Storage and service configuration. A restored Auth row
does not by itself prove working sign-in or email. The newest observed snapshot
predates some of the day's security cutovers, so restoring it would also require
careful application/database reconciliation.

For a designated recovery rehearsal, the recovery operator should:

1. Record the selected snapshot, compatible application revision, Storage
   inventory and post-snapshot changes that must be reconciled.
2. Verify an explicitly disposable destination and disable real-user workers,
   notification dispatch and financial actions there before restoring data.
3. Restore the appropriate database snapshot and separately restore Storage
   objects and required service configuration through the secret-management
   process. Keep private dumps and credentials out of Git and public reports.
4. Compare schema, grants, policies, functions, triggers and the migration ledger
   with the chosen application contract. Review forward changes individually.
5. Reconcile account restrictions, legal holds, deletions, publication ownership
   and external provider receipts with authoritative events after the snapshot.
   Hold uncertain results for review.
6. Exercise designated test-account journeys and provider sandboxes, verify
   Storage references, and measure actual recovery time and recovered-state age.
7. Prepare the compatibility evidence and cutover plan. Any production promotion
   or restore is a separate authorized incident action with post-cutover checks.

This procedure was documented, not executed. No measured recovery-time or
recovery-point objective is claimed.

## Delivery evidence and maintenance handoff

The prior-release audit checks ancestry, receipt consistency, successful exact
deployment status, matching refs and recorded health for Steps 0–14. The first
three releases use their original committed validation reports plus freshly read
exact deployment statuses; missing original receipt files are not fabricated.
Later receipts preserve the validation actually performed at their dates,
including any isolated-source scope. The audit does not rerun historical releases
or override limitations in those reports.

The external evidence directory is
`D:\Codex\MyDancr-validation-2026-09-11\arch-stability`. Prior evidence is indexed
by `consolidated-delivery-history-audit.json`; the final notification and combined
review use `step15-final-results.json` and `step15-delivery.json`. The latter
records the exact pushed commit, successful hosting status, matching refs and
post-release checks. The two unrelated user screenshots remain outside Git and
their hashes are preserved.

The project maintainer retains responsibility for upstream advisory review,
hosted runtime maintenance, provider outcome review and recovery preparation.
Alert delivery and any stronger branch controls need an actual operational
decision; no recipient, named owner, external service or recurring automation
was invented. Remaining worker issues above stay visible until a separately
verified implementation resolves them.

## Final local validation

On `72d32f5bd04dbc0c09a9cb1f62a6e635158c343f` plus this release, all **9,036 tests** passed
with no failures, skips, cancellations or todo. All eight canonical stages, the
configured private-value artifact scan, postbuild TypeScript and all 58
read-only readiness checks passed. Node 24.21.0 and FFmpeg `n8.1.2-50-g1a748fe2cd`
were verified. The fresh advisory audit found zero vulnerabilities; 369
registry signatures and 57 attestations were verified. These are dated registry
observations, not a guarantee that every possible vulnerability is absent.

The final delivery receipt separately records the pushed commit, exact successful
Vercel deployment and post-release health. No result is reported complete before
those checks succeed.
