# Step 29 — Resource abuse and bounded responses

This release addresses four concrete resource findings. Its external delivery
receipt must confirm the full automated suite, all eight canonical release gates,
configured artifact inspection, exact commit deployment and public health before
Step 30 starts. It contains no new SQL or production data repair.

## Corrections

**MEDIUM — Incoming bodies could remain below their size ceiling while stalling
the request.** Bounded readers now apply a total 30-second JSON transfer deadline
and a 120-second multipart transfer deadline. A slow drip of bytes does not reset
the deadline. Caller cancellation interrupts a pending read, and body cancellation
hooks are best effort so an unresponsive hook cannot prevent a 408 timeout or
413 size rejection. Successful reads clear timers and listeners. Declared
oversized bodies still fail before accessing the stream. These deadlines cover
body transfer, not earlier authorization, parsing CPU or the complete route.
Accumulation uses a bounded growing buffer instead of retaining one object for
every tiny or empty chunk; bytes crossing the configured ceiling are rejected
before copying them into that buffer.

**MEDIUM — Supabase responses had a time budget but no byte ceiling.** The common
transport previously buffered the complete response. It now limits decoded JSON
responses to 16 MiB and Storage responses to 96 MiB, retaining headroom above the
existing 75 MiB video allowance. Streaming counts enforce the ceiling even when
Content-Length is absent or false, or the response was compressed. Oversized
responses cancel the reader and request and produce the existing generic
uncertain-result error. Mutations are not replayed. Caller cancellation also
settles before headers from a non-cooperative transport; late responses are
disposed of. Successful status, content type, range/count headers and no-body
responses retain their meaning.

These are per-response limits, not a process-wide memory cap: stream internals,
copies, parsed JSON and simultaneous requests still consume memory. A rejected
write response does not prove that the database write failed. Callers must
reconcile the existing operation state before retrying.

**MEDIUM — Directory queries transferred complete shift histories and galleries
for bounded parent cards.** Public directory queries now retrieve separate
eligible live and scheduled windows of 50 rows each, retaining the current live
priority. Each window filters publication, checkout, venue visibility and its
time condition before selection, with stable start/ID ordering. Infinite
PostgreSQL expiry/end values are excluded before taking the window. The card
builder rechecks time after fetching, with other candidates available if an
earlier one expires during transit. The dedicated tonight query has the same
50-row shift ceiling and venue filtering. Gallery queries select at most 50
approved photos per card, ordered by pin, primary flag, sort order and ID.

The existing 200-per-city and 800-all-cities parent limits remain. Optional
relations retain a profile without an eligible date or gallery. A window whose
entire eligible set expires during transit remains hidden; this does not promise
an arbitrary beyond-window fallback. Photo collections beyond 50 are truncated,
matching the existing individual profile media ceiling. Related social/score
queries and database query-plan cost are not claimed to have a universal graph
or CPU bound. The transport byte ceiling remains a separate failure boundary.

**MEDIUM — Anonymous QR requests could repeatedly start image encoding.** Valid
public-link QR requests now consume the existing service-only atomic limiter
before encoding. All URL variants share 60 requests per client address per
minute. The subject is the same normalized client address, avoiding a global
profile bucket that one visitor could exhaust for everyone. Invalid links are
rejected before database or encoder work. Denials return 429 with Retry-After and
private no-store caching; counter uncertainty returns the existing generic 503
without encoding. Successful images retain the 360-pixel format and public cache
policy. Trusted forwarding-header requirements and shared-network/distributed
client limitations from Step 11 still apply. Cached hits do not encode images;
there is no claim that application counters prevent edge or database overload.

## Validation design

Tests exercise the actual transport and installed Supabase SDK with synthetic
streams and RPC responses, including byte boundaries, multibyte text, false and
compressed lengths, stalled bodies, late headers, HEAD counts and single-attempt
write uncertainty. Directory tests execute the public service through the
installed SDK with a small query evaluator; a separate native PostgreSQL
timestamp projection verifies infinite-value ordering using the emitted filter
values. Hosted relationship syntax requires a bounded read-only check of the
actual emitted query. Neither the evaluator nor the timestamp projection proves
hosted query-plan performance or complete business-schema behavior.

The query shape follows PostgREST's documented [embedded filters, aliases and
limits](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html#embedded-filters).
That documentation is a syntax reference, not evidence about the hosted plan.

Incoming-body tests cover stalled and slow streams, caller abort, pre-aborted
requests, non-settling cancellation hooks, exact UTF-8 byte preservation and
timer/listener disposal. Existing JSON and native multipart parsing cases remain.

QR tests combine the actual route and limiter with the existing counter SQL in
an isolated native PostgreSQL database. Separate route instances and changing
URLs cannot mint a new client budget. Existing native PNG decoding tests retain
the exact public-link check. These fixtures do not consume production counters,
send provider requests, invoke cron jobs or change real-user state.

## Reviewed boundaries and remaining findings

The candidate is based on architecture commit
`d999a16218f8db7aacc3663206f36fc8e662b934`, whose exact deployment succeeded
after 8,841 tests and all release gates. The 57 new regression cases produced
15 passes and 42 failures against that unchanged parent. The corrected candidate
passed all 208 focused new and related cases. A short lint deadline expired
during cold dependency loading; that failure remains recorded. An independent
changed-file lint completed with no warnings and unchanged source hashes.

The first hosted syntax check mistakenly used an anonymous database connection
and stopped on HTTP 401 / PostgreSQL 42501 before the second query. Both actual
public HTTP routes use the existing server client and project safe response
fields. The corrected zero-row check used that verified caller and received
HTTP 200 with empty arrays for both query shapes. It changed no database grants,
returned no private rows and made no application writes. This validates hosted
relationship syntax for the server path, not direct anonymous database access.
The original failed receipt is retained alongside the passing check.

The first full suite completed with 8,879 passes and 19 failures among 8,898
tests. Two VM fixture loaders did not provide native timers used by the bounded
body reader; a parent-only All-cities fixture applied optional child filters to
parent rows. Those three fixtures now provide timers and model their existing
parent scope correctly. Their original behavioral assertions remain unchanged.
All 42 affected tests and their zero-warning lint then passed with no application
source change. The failed full-run receipt remains recorded, and a fresh complete
release gate is required before publication.

That fresh complete gate passed at 2026-09-12T18:00:05.252Z: all 8,898 tests,
zero failures/skips/cancellations and all eight release stages, including
standalone TypeScript, full zero-warning lint, production build and public
artifact inspection. Postbuild skipped population. Configured integration,
exact commit deployment, public health and preservation checks remain the
external delivery receipt's closure conditions.

The existing bounded JSON/multipart readers, media upload/preview counters,
25 MiB raw and 10 MiB prepared image limits, 64-megapixel input limit, 75 MiB
video limit, decoder container restrictions, provider request deadlines and
video frame concurrency of three remain. This release does not lower accepted
media dimensions or alter moderation decisions to obtain a passing test.

Whole moderation jobs still accumulate download, decoding, retry, provider and
publication time beyond individual operation budgets. The video cron declares
60 seconds for up to two jobs; the image cron can select five. These are not
proven whole-job completion budgets. A stale image claim can remain moderating;
avatar moderation records lack a complete publication ownership fence, and TV
claim/final-result updates use status without a complete worker version fence.
Automatically reclaiming those jobs or abandoning them through Promise.race
alone could permit late publication. This release adds neither unsafe recovery
nor a claim that those lifecycle findings are fixed. They remain explicit for
the defensive review and final report, alongside provider, staging and
administrative limitations from earlier steps.

The Step 28 public ownership helpers also required alignment of the stricter
read-only function registry in the intervening Supabase caller release. The
initial gate rejected the new interfaces. The correction pins their exact
fingerprints, postgres owner, STABLE/SECURITY DEFINER properties, one UUID
argument, boolean result, empty search path and complete explicit non-grantable
postgres/anon/authenticated/service ACL. Unknown interfaces and inherited-owner
access remain rejected. Fifty-four native registry cases passed in that
release's complete 8,816-test/eight-gate run.

Caller commit `6f1a9048139a5c01125f3b11046feb0c21b1e3bf` reached
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/HfCwDwp9PpciSJv7T8JKSyioRnWz)
and closed at 2026-09-12T17:02:34.610Z with configured artifact inspection,
postbuild TypeScript, 58 readiness and 10 health checks. Its final read-only
registry check passed with 141 public functions, 108 definers, six anonymous
interfaces and nine authenticated interfaces. No application function was
invoked by that check, and no SQL was applied by the caller release.

Its preservation result is bounded: 84 table fingerprints, all 85 table row
counts, metadata/effect definitions and 129 migration-ledger entries matched.
The 556-row request-rate counter table had a changed fingerprint, reconciled as
unattributed TV request activity whose windows began before caller adoption.
The original failed all-record equality check and independent stable recapture
were retained. No counter was reset or repaired, and this record does not claim
that all 85 fingerprints were unchanged. The registry alignment expands no
database privilege and replays neither Step 28 migration.
