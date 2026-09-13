# Architecture and stability audit — September 12, 2026

## Scope and operating sequence

Initial review baseline: `bdf4111e1becd1f511a2cd99c2c0dd0e83178365`.
One initial architecture review was completed before implementation. Its findings
are fixed below as one master list; subsequent work uses focused checks, followed
by one final full verification. Existing untracked attachments are outside scope.

## Current system map

- Next.js 15.5.24 App Router, React 19, strict TypeScript; npm lockfile and Node 24
  runtime/native FFmpeg checks. 119 API routes, 31 page entries, 52 client entries,
  422 JavaScript/TypeScript files in app/src/public, 542 test files at baseline.
- `/` renders the checked-in `outputs/index.html` shell through a server route.
  Generated styles and an external versioned script serve that shell. Canonical
  venue/discovery links return to it. React handles standalone dancer profiles,
  transportation, authentication tools and customer/dancer/venue/admin/agent
  dashboards. No server actions or application realtime subscriptions were found.
  Both TV routes redirect into the shell; the retained React TV clients have no
  runtime consumers.
- Browser credentials use one application session key and the API transport;
  refresh responses are guarded against stale session writes. Middleware handles
  expiring API credentials and private-document CSP/cache headers. API handlers
  verify identity and authoritative account roles. Supabase's browser client is a
  reused signed-upload client without a second persisted auth session.
- Anonymous, authenticated-request and privileged Supabase factories are separate.
  Privileged factories are server-only. Fetch bounds cover time and response bytes;
  uncertain writes are not blindly replayed. Business services live in
  `src/lib/dancr`; SQL functions own sensitive multi-record transitions.
- Discovery batches metrics and separates live NFC presence from upcoming dates.
  Media uses private staging/review, bounded processing, approved publication,
  responsive images, signed playback, limited active/adjacent video loading and
  explicit resource cleanup. Dashboards use progressive, cancellable panel loads.
- Existing integrations: Supabase Auth/DB/Storage, OpenAI moderation, FFmpeg/sharp,
  Stripe, optional NATS settlement, Resend, OneSignal and maps/ride deep links.
  Public engagement is best effort. Existing daily Vercel cron routes cover image
  moderation, video moderation, DMCA restoration, expired shifts and finance.
- Public cache lifetimes are short; authenticated responses are private/no-store.
  No new cache, global state system, queue, worker or infrastructure is warranted.
- Vercel installs locked packages and runs the production build. Full release
  validation remains an explicit script/PR workflow; direct main pushes are not a
  substitute for running checks. Builds do not apply SQL. Maintenance scripts
  require explicit flags. The baseline has 174 migration files; historic collisions
  are frozen and must not be blindly replayed.
- Tests combine runtime/VM/browser-behavior checks, source boundary contracts and
  disposable PGlite database fixtures. Source assertions alone are not proof of
  hosted behavior. Earlier audit reports were treated as dated evidence.

Read-only production metadata captured at 23:23 UTC showed 83 public base tables,
all with RLS enabled, 147 public functions and 132 migration ledger entries. The
notification DELETE policy permits users to clear their own rows. No production
user records or credentials were exported. The import inventory found no static
module cycles; this is not a proof about every dynamic runtime path.

## Initial master findings

| ID | Severity | Area / root cause | Operational impact | Disposition |
| --- | --- | --- | --- | --- |
| A1 | HIGH | Shuttle request identity and contact details exist only in per-recipient notification rows; clear-all deletes these rows. Replay compares mutable venue names and the current manager set. | Clearing an inbox erases the only lead record; retries can resurrect notifications or reject an unchanged guest request after club edits. | FIXED: durable request identity and atomic handoff receipts. |
| A2 | MEDIUM | Public profile/discovery enrichment shares fatal error propagation with core profile data. | A metrics or profile-video dependency failure makes otherwise usable discovery/profile content unavailable. | FIXED: explicit secondary-content degradation, preserving core visibility failures. |
| A3 | MEDIUM | `DancerShiftManager` catches save errors without returning an outcome; callers always reset date/editor state. It relies on rendering disabled buttons for submission exclusion. | A failed save loses entered work; concurrent handler invocations can overlap; a failed reload misreports a committed save. | FIXED: retained edits, immediate submission exclusion and separate refresh outcome. |
| A4 | INFORMATIONAL (initial MEDIUM candidate withdrawn) | The retained React TV client lacks hidden-page suspension. Reachability verification found no runtime consumers; `/tv` and `/tv/[id]` redirect to the shell. | No current production impact from this component. The initial finding incorrectly described it as routed. | No change to unused code. Active shell playback/resource behavior verified separately. |
| A5 | LOW | NATS reads the full response before applying a 5,000-character slice. | Unexpected large responses can consume unnecessary server memory; body failures lose typed dispatch context, although the caller already fails conservatively. | FIXED: bounded streaming reads and typed, sanitized ambiguous outcomes. |
| A6 | INFORMATIONAL | Large shell/dashboard modules and parallel shell/React presentation paths. | Changes require boundary-specific regressions; no demonstrated need for a framework rewrite or new state layer. | OPTIONAL FUTURE IMPROVEMENT; extract only when future feature work provides a concrete reason. |
| A7 | INFORMATIONAL | Historical migration files are not a clean-install recipe; older README release instructions disagree with current Vercel build configuration. | Operators must use the documented migration reconciliation procedure and current configuration. | FIXED documentation; historical SQL preserved. |

No critical issue or demonstrated widespread corruption was found. Existing
atomic redemption, payout/webhook claims, publication transactions, schedule
uniqueness, auth role checks, worker ownership, conservative retries and resource
cleanup are retained. Notification acceptance is not proof of mailbox/device
delivery. No production load test, money movement or real guest pickup is needed
to validate these fixes.

## Audit coverage

All requested areas were reviewed in the initial pass: module boundaries and
duplication; client/server responsibilities; discovery/profile/venue/dashboard
fetching; database query bounds, nulls and writes; Supabase factories and listener
lifecycle; local state/effects; async races; API and optional-panel errors;
loading/empty/missing-entity states; retry/timeout policy; integrations; media;
auth/session transport and recovery; routing/deep links; forms; shuttle/referral
handoff and cashier attribution; notifications; analytics; caches; resources;
safe error metadata; migrations; build/environment/serverless behavior; and locked
dependency/runtime controls. Findings above distinguish confirmed defects from
maintainability observations. Final evidence and delivery receipts follow below.

## Executive summary

The initial architecture already had coherent server/client boundaries, bounded
provider calls, private account APIs, atomic financial transitions and substantial
regression coverage. The confirmed weaknesses were concentrated in shuttle lead
durability, optional public-content failures, schedule form recovery and provider
response consumption. These were corrected without changing frameworks, adding
dependencies or introducing services, queues, workers or a new state system.

The final static inventory still has 422 application source files, 52 client
entries, 119 API routes and 31 page entries. Its import graph reports no static
cycles. This is boundary evidence, not a guarantee about every possible runtime
path. Concurrent user tasks were integrated without committing their pending
changes; this audit moved to a separate checkout to avoid shared-file conflicts.

## FIXED — database and Supabase

- Added `club_shuttle_requests`, a private durable receipt keyed by the request
  UUID. Immutable normalized guest details, recipient messages and club/deal
  references survive inbox deletion and changes to club names or managers.
- Added `handoff_club_shuttle_request(uuid)`. A row lock serializes handoff;
  notification creation and `handed_off_at` commit together. A conflicting
  notification rolls back the handoff while retaining the already committed lead.
  A replay reports the existing handoff and does not recreate cleared messages.
- Request creation uses a unique-key insert with conflict ignored, then reads and
  validates the winning receipt before handoff. Reusing an ID with changed guest
  details or a different club/deal returns a conflict. No speculative index or
  foreign-key change was introduced; the primary key supports receipt lookups.
- Applied `20260912232600_preserve_club_shuttle_requests.sql` and
  `20260913000500_narrow_shuttle_service_grants.sql` to production. The second is
  a forward correction for Supabase's table default privileges; browser access
  was already denied. Service access now permits SELECT, INSERT and UPDATE of
  `handed_off_at`, with general UPDATE/DELETE denied.
- Production metadata, function body and constraint checks verified the new
  schema. The original deployment wrapper recorded one regex incorrectly in its
  migration-source receipt; a guarded metadata-only repair restored the exact
  committed source. The executed table/function SQL was unaffected. No historical
  migration file or other task's ledger entry was rewritten.
- No Realtime or auth listener changes were necessary: the application has no
  active Supabase Realtime subscriptions or competing SDK auth listeners.

The original migration's normalized LF SHA-256 is
`bddbacc0b51e99c95b06ff1854fe7988d1f0a034e79a3097b43a271014014229`.
The grants migration's SHA-256 is
`85a95f16f6d00a3f250d4793af93a2e9be72b2ef124ea7628bb00913eb04a3a4`.
The read-only cutover verification found no pre-existing or unreceipted shuttle
notifications requiring backfill, and no malformed or pending request records.

## FIXED — frontend stability

- Public discovery/profile metrics now carry `metricsUnavailable` on a secondary
  failure. The UI displays an unavailable value rather than a false zero. Degraded
  API responses use private/no-store so a brief failure is not stored as a normal
  public result. Core visibility and approved-photo failures still fail closed.
- Standalone profiles retain their core content when optional videos, deals or
  action-venue enrichment fail; they show a partial-content notice with reload.
- Schedule date/editor state clears only after a confirmed save. A synchronous
  guard excludes overlapping save/end actions before React rerenders controls.
  Inputs and edit/delete controls stay disabled during saves and recover on
  failure. A reload failure following a successful write explicitly asks for a
  refresh while preserving the successful write outcome.
- Live browser checks confirmed canonical navigation, missing schedule states,
  profile gallery opening/closing and anonymous follow prompts. Active TV playback
  uses one playing video and one adjacent preload; scrolling hands playback off,
  and returning to discovery removes all TV video elements.

## FIXED — backend and integrations

- NATS invoice responses are consumed within a 64 KiB/4,096-chunk ceiling. The
  existing 15-second deadline also governs body consumption; aborted/oversized
  bodies are canceled and readers/listeners released.
- Incomplete bodies become `NatsAmbiguousDispatchError` with safe HTTP metadata.
  Existing commission workers preserve `reconciliation_required` and never repeat
  a provider dispatch merely because confirmation was lost. No automatic invoice
  retry or new settlement behavior was added.
- Logging identifies optional profile/metrics, shuttle handoff and delivery
  failures without guest contact details, credentials or raw provider responses.
- Existing bounded Supabase requests, auth refresh handling, worker leases,
  webhook receipts, moderation controls and private cache policies were retained.

## FIXED / VERIFIED STABLE — pickup and referral integrity

The implemented pickup flow is a club lead handoff, not dispatch or proof of
arrival. The authoritative sequence is saved request → atomic manager inbox
handoff → optional external alert. External failures cannot erase the lead. Only
the first confirmed handoff is eligible to alert, so ordinary retries do not send
again. The concurrent performance task moved those optional alerts into Next's
`after()` lifecycle; its integration preserves this receipt boundary.

Guest name/location/party size/phone/email and consent are validated consistently;
party size remains 1–100. A failed inbox handoff returns a recoverable response
instructing the client to reuse its request ID. Existing cashier NFC, referral
attribution, redemption and payable-state transactions remain authoritative.
No customer-confirmed/arrived/verified state or transportation workflow was
invented. Provider acceptance is not proof of actual delivery or pickup.

## Testing and production evidence

Targeted checks after each logical fix:

| Fix | Checks | Result |
| --- | --- | --- |
| Durable shuttle lead, atomic handoff, replay and deletion | 58 request/PostgreSQL/notification checks | Passed |
| Secondary public-content failures, visibility, profile actions and caching | 149 focused checks | Passed |
| Schedule failure recovery, overlap, dates and end-working state | 40 focused checks | Passed |
| NATS bounds, stalled bodies, uncertainty and commission flows | 85 focused checks | Passed |
| Supabase default grants and corrected shuttle privileges | 28 shuttle checks | Passed |

These groups overlap; they are not a unique-test total. Focused ESLint and diff
checks passed; migration checks preserved all quarantined historical collisions.
PostgreSQL fixtures exercised permissions, transactional rollback, replay and
cleared inboxes. They are not a production concurrency load test.

- Read-only production Supabase readiness: **62/62 passed**; all public base tables
  had RLS enabled, important projections/RPCs existed, private columns were denied
  anonymously and storage policy checks passed.
- Safe production HTTP regression: **15 documents and four protected APIs passed**.
  Deep links, account redirects, private no-store headers/CSP and anonymous API
  denials were checked without signing in or changing account state.
- Public API shape checks: **10 passed**, covering discovery, dancers, Working Now,
  venues, profile photos/schedules, bounded TV, the anonymous following gate,
  missing profiles, invalid city input and the deployed health revision.
- Browser checks: discovery/Working Now/upcoming grouping, dancer overlay and
  standalone profile, venue details, active deal, profile gallery, anonymous
  follow prompt, shuttle unavailable state, TV playback/scroll/navigation cleanup.
  Sampled media played without media errors; deferred gallery items had no source
  until needed. The sampled demo club correctly disabled shuttle submission.
- Authenticated write/session refresh, provider failures and financial/referral
  edge cases use automated fixtures; no real invoice, guest lead, email/SMS,
  account-state change or production load test was performed for this audit.

The **single complete release gate passed** on integrated commit
`8972775eb8782b632674c9e641e7ebee6f92d396`, using Node 24.21.0 and pinned npm
11.19.1 in the isolated audit checkout:

| Final check | Result |
| --- | --- |
| Dependency audit | 0 vulnerabilities |
| Registry verification | 306 package signatures and 53 attestations verified |
| Runtime/native dependencies and generated assets | Passed |
| Entire automated suite | 9,431 passed; 0 failed, canceled or skipped |
| Route type generation and standalone TypeScript | Passed |
| Whole-project ESLint, zero warnings allowed | Passed |
| Production build and public-build security check | Passed |
| Postbuild maintenance | Population changes skipped as intended |

The gate ran once and required no implementation correction. Final delivery
changes only this report and README guidance; application code matches the
validated revision. Test subprocesses used
synthetic settings; the build received public Supabase configuration without
service-role/provider secrets or mutation flags. Detailed logs and machine-readable
receipts are retained outside Git in
`D:/Codex/MyDancr-architecture-audit-2026-09-12/`, including `final-release.json`,
`final-supabase-readiness.json`, `public-api-shapes.json`,
`browser-verification.json` and `production-http/results.json`.

## One final full review

The final pass revisited architecture/server boundaries, query shapes and bounds,
Supabase factories and schema assumptions, state/effects, async form behavior,
errors/loading/retry/timeout handling, integrations, media lifecycle, auth/routing,
shuttle/referral transitions, notifications/analytics, caches, cleanup and build
configuration. It did not restart the initial audit after each fix.

The focused production database verification uncovered inherited service grants
on the new receipt table, and the source comparison uncovered this task's ledger
recording error. Both were corrected and only that boundary was rechecked. No
broad architecture change or further full audit was needed. The React TV finding
was withdrawn after reachability checks, rather than fixing non-executing code.

## MANUAL ACTION REQUIRED

None for the fixes delivered by this audit: both SQL migrations are applied and no
new environment variable, Vercel setting or provider setup is required. New or
recovery environments must apply the two reviewed pending migrations using the
existing reconciliation procedure; Vercel builds never apply SQL automatically.

## Remaining risks and validation limits

- Optional external alerts remain best effort. A provider outage or process loss
  can prevent an alert after a successful inbox handoff; the saved lead/inbox is
  retained. A durable delivery queue was not justified or introduced.
- Browser evidence covers the connected desktop engine, not physical iPhone or
  Android hardware. Authenticated browser sessions and actual provider delivery
  were not exercised with production accounts.
- Historical migration collisions require reconciliation for clean restores;
  this audit does not certify backup restoration or recovered Storage bytes.
- Revocation of previously published media URLs after account pause/disable is
  still pending in the separate Supabase task, which the user paused. Its
  unfinished shared-checkout changes were excluded from this audit's isolated
  release. This audit does not certify that previously published media URLs are
  revoked immediately after an account becomes private.

## OPTIONAL FUTURE IMPROVEMENT

Extract small portions of the large shell/dashboard modules when concrete future
feature work warrants it, and retire unused React TV presentation code if no
longer needed. Neither calls for a framework migration, new global state layer or
background infrastructure. A controlled recovery drill and physical-device media
smoke tests can extend operational evidence without changing the architecture.

## Delivery receipts

| Commit | Logical fix | Exact Vercel result |
| --- | --- | --- |
| `65c9ef5543b55594cf2e9600f216a7594fd06d71` | Durable shuttle leads | success |
| `f9d0456a22a058bfe0384389d832df46cfd41c15` | Public secondary-content recovery | success |
| `1aada6efd488d2466b2dbad8e0151c1065973aa1` | Schedule form recovery | success |
| `7c0a9850f6cc806a49fb1af7fb3482006d8592d3` | Bounded NATS responses | success |
| `1ac65d817bff2f803fac72b70392198fa23a86a2` | Shuttle service privileges | success |
