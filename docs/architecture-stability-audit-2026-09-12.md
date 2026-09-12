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
  TV, transportation, authentication tools and customer/dancer/venue/admin/agent
  dashboards. No server actions or application realtime subscriptions were found.
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
| A1 | HIGH | Shuttle request identity and contact details exist only in per-recipient notification rows; clear-all deletes these rows. Replay compares mutable venue names and the current manager set. | Clearing an inbox erases the only lead record; retries can resurrect notifications or reject an unchanged guest request after club edits. | Confirmed; fix durable request identity and handoff receipts without a dispatch system. |
| A2 | MEDIUM | Public profile/discovery enrichment shares fatal error propagation with core profile data. | A metrics or profile-video dependency failure makes otherwise usable discovery/profile content unavailable. | Confirmed; degrade secondary content with an explicit unavailable indication, preserving core visibility failures. |
| A3 | MEDIUM | `DancerShiftManager` catches save errors without returning an outcome; callers always reset date/editor state. It relies on rendering disabled buttons for submission exclusion. | A failed save loses entered work; concurrent handler invocations can overlap; a failed reload misreports a committed save. | Confirmed; retain edits on failure and separate save outcome from refresh outcome. |
| A4 | MEDIUM | Routed TV resumes on visibility changes but never pauses on hidden/pagehide; an outstanding play promise can complete after selection changes. | Audio/playback can continue in a background tab or on an inactive video. | Confirmed; enforce the existing active-video rule across lifecycle changes. |
| A5 | LOW | NATS reads the full response before applying a 5,000-character slice. | Unexpected large responses can consume unnecessary server memory; body failures lose typed dispatch context, although the caller already fails conservatively. | Confirmed; bound response consumption and preserve ambiguous-outcome handling. |
| A6 | INFORMATIONAL | Large shell/dashboard modules and parallel shell/React presentation paths. | Changes require boundary-specific regressions; no demonstrated need for a framework rewrite or new state layer. | OPTIONAL FUTURE IMPROVEMENT; extract only when future feature work provides a concrete reason. |
| A7 | INFORMATIONAL | Historical migration files are not a clean-install recipe; older README release instructions disagree with current Vercel build configuration. | Operators must use the documented migration reconciliation procedure and current configuration. | Preserve historical SQL; correct the stale build sentence in this audit's documentation closeout. |

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
maintainability observations. Final evidence and delivery receipts follow after
implementation.
