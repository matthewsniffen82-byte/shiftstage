# Step 8 — upload and media boundaries

Reviewed against `de1f3762e491ba5aae5d28354476933312df31d0` on 2026-09-12.
The 14 selected media source files match their earlier inspected identities.
The [evidence manifest](step-08-media-evidence.json) records the current parent,
source hashes and the earlier focused run without redating that run.

The reviewed request, decoding, publication and recovery paths retain the
earlier corrections. No additional defect was reproduced in the request, decoding or publication paths reviewed in this step.
This review does not treat the older reports' initial findings as current bugs.

## Request and decoding path

- Six active multipart image routes authenticate before consuming the body.
  The administrator venue route checks active administration first. Shared
  streaming limits cap the whole body at 25 MiB plus 64 KiB of multipart
  overhead. Signature detection and strict Sharp decoding normalize supported
  inputs to JPEG, PNG or WebP, at most 6,000 pixels per output dimension and
  10 MiB. Input pixel limits remain; subsequent branding/responsive operations
  receive the validated master. Generated filenames use UUIDs.
- Dancer video initialization authenticates the dancer, applies the media
  request limit, then reads at most 4,096 bytes of metadata. Consent and rights
  require literal true. The helper checks the existing 75 MiB, one-to-thirty
  second, 240-pixel minimum and 7,680-pixel maximum vertical/square policy.
  It signs one generated owner/dancer/video path. Explicit retry identity must
  match the original owner, dimensions, format, size and distribution scope.
- Final inspection checks the stored byte count, actual container and MIME
  agreement before making a temporary file or invoking FFmpeg. Actual duration,
  format and dimensions are checked after parsing. Moderation, posters and
  watermarking retain container gates. The untrusted input permits local file
  access and only MOV/ISO-BMFF or Matroska/WebM demuxers, with the existing pixel
  ceiling and decoder deadlines. Private originals and moderation remain.
- Security's already delivered native installation uses verified FFmpeg 8.1.2
  and requires supported Node 24.18.1 or later within major 24. This review uses
  portable Node 24.21.0. Advisory/supply-chain reassessment remains Step 16.

## Publication and recovery path

- Upload reservation and private/processed upload responses require matching
  identities. A missing response is not proof that storage or metadata writes
  failed. New reservations and potentially published media are retained after
  uncertainty; the same explicit upload identity supports recovery.
- Gallery metadata publication uses its existing atomic RPC. The current
  retirement/history guards and receipt checks protect subsequent cleanup.
  Avatar and venue replacements retain their conditional reference/version
  checks. A rejected stale update does not restore an older reference.
- Video removal first acknowledges the owned, version-scoped hidden state,
  then checks each storage removal response. Partial cleanup retains the hidden
  row and paths for an explicit retry. It does not republish partially deleted
  content or infer an uncertain removal succeeded.
- The fifty-video profile capacity is now enforced by the additive trigger
  delivered in Supabase Step 14, not only by the application's separate count.
  Occupied statuses, restoration, transfer, feed/profile transitions, ignored
  conflict inserts and supported isolation behavior are covered by its native
  regression and guarded-deployment suites. No migration is replayed here.
- Gallery inventory remains read-only and bounded. Unreferenced or retained
  historical objects are not automatically deleted. Permanent retirement and
  explicit cleanup receipts remain the relevant recovery boundary.

The independent [sessions, media and data-integrity review](../code-reviews/2026-09-12-sessions-media-and-data-integrity.md)
also corroborates the already delivered runtime, session, playback, NFC and
hierarchy changes within its stated scope. Its 52 real-media cases and 470
unique focused cases are that review's dated results; they are not added to this
step's test count. The incident task's later TV retry release is separate from
the upload/publication review here.

## Focused and release evidence

The 24 selected helper, synthetic failure, native codec and PostgreSQL suites
passed all 667 tests on the earlier external b0f3ac29 snapshot using Node 24.21.0,
with no failures, skips, cancellations or todo. That dated result is retained in
the evidence manifest; it is not a fresh production-data measurement.

After reconciling the current parent, the complete canonical release gate ran
on an isolated copy. All 1,500 tracked and task-file identities then matched the
shared checkout (text line endings normalized; binary files hashed exactly).
The normal production-configured build, public-artifact scan and standalone
TypeScript check were also run in the shared checkout. Current complete-suite
and read-only readiness results are recorded below. Source proof and detailed
stage logs are retained in the external architecture evidence directory.

## Remaining limits

Object storage and PostgreSQL are separate systems; not every media, account,
moderator and DMCA lifecycle writer participates in a single transaction.
Shared venue retirement, derivative overwrites, failed-attempt provenance and
public cache removal retain the documented limits. Step 10 reviews partial
writes; Steps 13/15 review workers and external outcomes; Step 19 reviews
recovery procedures. No cleaner is authorized by this review.

The Supabase transport bounds headers and body by time, but currently buffers
the complete response without a byte ceiling. The inspector's 75 MiB check runs
after the SDK download; other processing readers rely on bucket caps. This is
a concrete resource-boundary observation, not a reproduced production exploit.
Steps 9/21 must assess response-size and aggregate concurrency budgets without
breaking supported media or claiming a timeout alone caps memory.

Public media URLs and CDN caches can outlive database visibility. Bucket/RLS
checks do not prove immediate revocation or storage-byte recovery.
The inspected TV helper signs playback URLs for one hour; those previously
issued capabilities are also not instantly revoked by a later metadata change.
No production signed URL or private original was fetched for this review.
Native fixtures and simulated storage acknowledgments do not establish hosted
cross-connection behavior. No real-user file, upload/delete, moderation provider
request or private document is used as a test. Full authenticated journeys
remain Step 20 scope; the local preview remains stopped.

Final release validation:

On `de1f3762e491ba5aae5d28354476933312df31d0` plus this step, all **7,123 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 30
read-only readiness checks passed.

Published as `19ca1b4292af071a3d6395bb1f044acd4d367d03`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DCCd34YEFm8Y9Zoo3sRagCvvvGNR).
Post-release health passed at 2026-09-12T10:22:34.512Z. Local and remote main
matched; the unrelated user attachment was preserved. The full receipt remains
`step8-delivery.json` in the external architecture evidence directory.
