# Step 30 — Video worker ownership regression coverage

This candidate follows the independently closed Step 29 release
`8e01369bda91831d0f3952062082b21f67899a0d` and is now rebased to the independently
closed architecture release `d401d4d88ba212f8689e42fc80e8432ef2685b3d`. Its focused
regressions, relevant read-only production checks and all isolated release gates
have passed. Configured integration, commit, exact deployment and independent
health verification remain required.

## Confirmed source gap and correction

Video retry workers previously selected a moderation attempt and then updated
by video ID and `moderating` status alone. Two workers could consume the same
selection. An older provider result could also write while a newer attempt was
still moderating, causing the newer result to lose its final status update.
Human or caption changes were not fully represented in the worker's ownership.

The candidate compares the selected row timestamp, attempt number, start time,
former worker identifier and moderation inputs in one database update. The existing
timestamp trigger runs only for link changes, so the source path, type, caption,
submitter and dimensions are also compared explicitly. Each accepted attempt receives
a fresh random identifier in the already private `moderation_details` JSON.
Provider work begins only after the returned claim identifies the expected
video, owner, source, attempt, start and worker. A missing or malformed receipt
does not justify retrying the write or deleting its records or media.

Every final approval, rejection and provider-failure transition repeats the
claim's exact conditions. A read before watermark processing avoids starting
that expensive work for an already obsolete job. The final write checks again
if ownership changes during processing. A superseded result returns a conflict;
it does not replace the newer database state.

The retry function also rechecks eligibility instead of trusting a stale cron
selection. Unclaimed queued work is eligible immediately; an existing attempt
must be at least five minutes old and below the existing three-attempt automatic
ceiling. Explicit administrator retries retain their separate permission to
restart a failed review. Inline, queued and demo paths use the same worker
boundary; demo processing is counted as an attempt and receives a start time.
The demo mode configuration and policy decisions are unchanged.

There is no new SQL, privilege expansion or production repair in this draft.
Browser update access to the video table remains denied. The identifier is an
operation marker, not a client credential or a replacement for authorization.

## Focused validation

The first native/SDK comparison completed at 2026-09-12T19:00:52.853Z. The prior
Step 29 implementation passed 9 and failed 41 of the 50 new cases. The candidate
passed all 100 checks: these 50 cases and 50 related existing regressions. Neither
phase skipped or cancelled tests. Both processes exited naturally within the
explicit 40-second test window, and all nine recorded input hashes were unchanged.
This is focused validation on the isolated parent, not full release completion.

Fresh production metadata captured at 2026-09-12T19:06:08.253383Z identified the
recent copyright-restoration invalidation trigger missing from the original
video fixture. No application or production change was needed. The fixture now
executes the exact committed ownership-table, function and video-trigger source
from migration `20260912140704`, with synthetic ownership records included in
preservation assertions. The comparison rerun completed at 19:07:47.913Z on the
final architecture parent: the baseline again failed 41 of 50 new cases, and the
candidate again passed all 100 with no skips or cancellations. All ten input
hashes remained unchanged; the first fixture mismatch and earlier run are retained.

The independent comparison at 19:08:01.284Z confirms all twelve relevant column
identities and all four complete video-table trigger definitions/function hashes
match the native fixture. Browser roles cannot update any video column or select
private moderation details; service access remains intact. Aggregate checks found
no invalid existing worker state or conflicting worker keys across 34 records.
At 19:08:02.604Z both installed-SDK claim queries, converted to server GET with
outer limit zero, returned HTTP 200 and empty arrays. These check syntax and
column availability without invoking a real worker or retrieving private rows.

The complete isolated release gate passed at 2026-09-12T19:16:45.983Z with
**9,086 tests**, zero failures/skips/cancellations and all eight canonical checks:
dependency and signature audits, generated assets, complete suite, route types,
standalone TypeScript, zero-warning lint, production build and its artifact
inspection. Postbuild skipped population. This candidate contains seven task
files and fifty new regression cases; configured build inspection, source/user
file preservation and exact commit/deployment closure still precede Step 31.

The native fixture executes the actual service's statements against the existing
video-table snapshot and its four real write triggers, with the exact private
copyright ownership table and synthetic identity projections. It preserves
PostgreSQL timestamp precision through JSON. Interleaved
application workers exercise competing claims, older results, changed records,
lost ownership during media processing, claim acknowledgement failures, current
decisions, deferred and inline work, explicit admin retries and demo publication.
The installed Supabase SDK separately checks the actual encoded JSON-field and
version predicates through a synthetic HTTP transport.

These tests do not call a real provider, invoke a production cron, create an Auth
session or modify real-user media. They establish statement and caller behavior,
not every historical schema, hosted execution plan or a multi-connection load
test. The existing full regression suite and fresh bounded hosted checks remain
required before release.

## Remaining boundaries

This is database ownership for video workers. Storage and PostgreSQL do not share
a transaction. Media processing already in progress can still finish after a
worker becomes obsolete; retained objects are not deleted as compensation for
an uncertain database result. This change does not provide cross-service
exactly-once processing or revoke historical cached media links.

Requests already executing an older deployment cannot acquire these new checks
retroactively. Whole-job cancellation, FFmpeg completion settlement, cumulative
provider/download budgets, stale image recovery and atomic avatar publication
remain separate reviewed limitations. Image jobs are not automatically reclaimed
by this change, and abandoning work through a timeout race is not treated as
proof that it stopped. The avatar publication/administrative/deletion paths
remain assigned to the next defensive review.
