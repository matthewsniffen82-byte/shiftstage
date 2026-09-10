# Step 11: storage reliability and ownership

Step 10 closed with `58e6a5c04ffa6f3038ee7586aa6317dc87128181`; the [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/3YRQpucBQf3KLbwL4F7yQyvJcf2K) succeeded. The committed index migration preserved all rows/access, 45 constraints, seven retained indexes, 72 internal/user triggers, 126 functions and 109 earlier ledger entries. Read-only checks at 11:35:13 UTC confirmed 269 valid/ready indexes with all other definitions unchanged. Matching main references and health/readiness passed at 11:36:27–29 UTC on 2026-09-10.

## Current read-only inventory

At 11:37:50 UTC, all ten buckets and fourteen storage policies match the initial inspected configuration. Storage buckets/objects retain RLS. Ordinary users have no direct upload/overwrite/delete policy; server-mediated uploads and active-admin policies remain. The native storage-role suite exercises owner, unrelated user, anonymous and active/inactive administrator access. No production file, signed URL or private row was retrieved for this inventory.

| Bucket | Visibility | Maximum upload | Allowed content | Objects / observed bytes |
| --- | --- | --- | --- | --- |
| dancer-photos | Public | 10 MiB | JPEG, PNG, WebP | 250 / 48,216,746 |
| dancr-image-moderation-review | Private | 10 MiB | JPEG, PNG, WebP | 28 / 20,693,960 |
| dancr-image-moderation-temp | Private | 10 MiB | JPEG, PNG, WebP | 4 / 1,029,058 |
| dancr-media-originals | Private | 10 MiB | JPEG, PNG, WebP | 84 / 19,128,156 |
| mydancr-tv-videos | Private | 75 MiB | MP4, WebM, MOV | 56 / 473,095,629 |
| venue-cover-images | Public | 10 MiB | JPEG, PNG, WebP | 6 / 3,369,616 |
| venue-logo-images | Public | 10 MiB | JPEG, PNG, WebP | 6 / 454,379 |
| venue-ownership-proofs | Private | 10 MiB | PDF, JPEG, PNG, WebP | 0 |
| venue-qr-codes | Public | 10 MiB | JPEG, PNG, WebP | 0 |
| verification-documents | Private | 10 MiB | PDF, JPEG, PNG, WebP | 18 / 42,164,537 |

These are metadata counts, not a backup or proof of file decodability. Video originals use the private video's `__originals` prefix; video posters use the public photo bucket. Verification-document uploads are retired (410), but existing private files are preserved. Venue ownership proofs also remain private. Public media URLs can outlive application visibility and CDN caches; do not claim public-bucket RLS alone revokes an already-known URL.

At the initial 11:37:50 UTC inspection there were 72 gallery rows, sixteen nonempty avatars and 34 video records (25 approved, eight hidden, one rejected). The committed gallery reference-history migration `20260910092022` was then absent in production. It subsequently passed guarded application and privacy/preservation verification, as recorded below; repository tests alone were not treated as production evidence.

## Initial failure boundaries at 11:37 UTC

- Video owner removal currently deletes video/poster/original bytes before acknowledging the database hide. Storage errors are partly ignored. Correct this first with a confirmed, version-scoped hide before any removal, explicit removal errors and recovery by the same owned record ID.
- Photo deletion acknowledges its database removal first, but shared avatar/gallery paths and linked moderation cleanup still need coordinated retirement. An absent reference at one moment is insufficient proof against a concurrent publisher. Preserve the existing read-only gallery inventory; never bulk-delete its observations.
- Gallery publication already uses atomic metadata commits and protects uncertain publication outcomes. Durable gallery reference history still needs a guarded application of its exact existing migration. Further attempt/retirement coordination is required before safe public/original orphan cleanup.
- Inspect venue branding/QR replacement, avatar recentering, responsive-upload rollback and moderation temp cleanup for ambiguous writes and discarded storage acknowledgments. Keep retired proof/document entry points closed.
- Native storage policies and bucket readiness checks already cover browser writes, cross-owner/private reads, active-admin boundaries, MIME types and byte limits. Recheck these during each release; no bucket privacy flip or policy weakening is planned.

Physical deletion cannot be a PostgreSQL transaction with object storage. Do not compensate a storage failure by republishing a partly deleted video. A hidden row retains the exact paths for an explicit retry or operational reconciliation. Broader DMCA/account retention and competing administrative lifecycle transitions remain in Step 17; do not claim external storage and all lifecycle writers are globally atomic.

## First controlled plan: video removal

Retain the existing authenticated dancer route and final owner filter. Validate the selected ID/owner/path/version, update only that exact version to hidden, and require a complete matching database receipt with `venue_featured=false`. Only then remove the three derived storage objects. Reject failed or malformed removal responses; keep the hidden metadata and paths for a retry. Do not report success for an unconfirmed database or storage operation. Return the existing `{id,status}` shape after confirmation.

Run actual-caller failure tests for missing/foreign records, metadata/version drift, rejected/ambiguous database writes, suppressed or malformed receipts, storage errors, retry after partial cleanup, and all supported video extensions. No production deletion is a test. Run the full suite, lint, production build, standalone TypeScript, migration guard and read-only readiness; commit/push only this correction and verify exact deployment/health before continuing storage work.

## Video-removal verification

The actual caller now passes 51 native-backed checks; 38 fail against its prior implementation. Together with 31 existing storage ownership/configuration checks, all 82 focused checks pass. The fixture reconstructs the complete inspected video table, constraints, indexes and triggers, with explicit projections for related identities. A fresh read-only comparison at 11:47:01 UTC confirms all 38 columns, nineteen constraints, eight valid/ready indexes and two trigger definitions match production. No schema change is part of this correction.

The native trigger only advances `updated_at` for its listed link/feature fields. The test initially assumed every caption edit did so; it now verifies that an unrelated concurrent caption is preserved and a changed recorded timestamp blocks deletion. ID, owner, dancer, path, MIME and status also remain explicit final-write conditions. This is not a claim that the timestamp versions every possible field.

The installed storage SDK returns `FileObject[]` for removal. The [Supabase storage deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts) returns matching removed objects, including an empty array when none match. The caller accepts that idempotent acknowledgment but rejects malformed responses and foreign names. A successful provider receipt is not a guarantee of immediate CDN cache eviction or proof of a full backup.

On a rejected or lost database acknowledgment, no storage call runs. A failed or lost storage acknowledgment leaves hidden metadata intact, stops later cleanup calls, reports failure and permits the same owned ID to be retried. The current route's authentication and response shape are retained. Full release validation and exact deployment gates remain required.

Full validation passed all 5,393 tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks. Postbuild skipped population. No migration, production media deletion, test upload, email or provider mutation was performed. Exact commit/push, matching main references and Vercel/health verification remain the release gates. A code rollback requires no database reversal; retain any hidden rows and inspect partial storage cleanup before considering restoration.

## Verified subsequent releases

- Video removal `8739f5d96963d447cc365894441234595b330d30` deployed successfully; health/readiness passed at 11:52:22–25 UTC.
- Gallery-history rollout `8a7222d50e6a1e8d6e07d7f2a259aaf984174eeb` applied exact migration `20260910092022` and recorded 88 baseline references. Privacy, preservation, API boundaries and deployment/health passed by 12:05:43 UTC. See `step-11-gallery-history-rollout.md`. This history does not authorize orphan deletion.
- Venue image publication `52a63c8e9bccc5fe6606bce7d10416779fbd72a4` prevents deletion after uncertain database acknowledgment and rejects stale media replacements. All 5,458 tests passed; exact deployment and health/readiness passed at 12:27:23–27 UTC. Read-only checks preserved 22 venue records, 452 storage objects and 111 migration entries. See `step-11-venue-media-publication.md`.

Subsequent separately validated and deployed corrections are recorded in the execution ledger:

- Responsive upload retention and exact receipts: `2ca86776984219d599a982dfb5f3e32904c243dc` (`step-11-responsive-upload-recovery.md`).
- Permanent gallery retirement guards: `111ea6dab0c48d1744adad1f6e9a892cd68aad5f`, exact migration `20260910125000`; caller integration `9f6515ad1d6151007ed9c1b70e21fd0b789ccde3` (`step-11-gallery-retirement-foundation.md`, `step-11-gallery-retirement-callers.md`).
- Canonical avatar retirement paths: `19cda43a81b8e676a4646f9c069f431bdbbcc405`, exact migration `20260910134200` (`step-11-avatar-retirement-paths.md`).
- Active-admin recovery for one permanent retirement receipt: `83608deb0432fdd9a413d26d794fe96f3e5f7f6b` (`step-11-gallery-cleanup-recovery.md`).
- Stale venue deletion protection: `c659ec3c8c0574ff2a536b7ef3fac784980623d1` (`step-11-venue-media-deletion.md`).
- Private upload/copy acknowledgments: `4ff0ceb3999cfa2b7c516baddcb3e0da197e4567` (`step-11-private-upload-acknowledgments.md`).
- Retained avatar sources after technical failure: `e2ede1d11aa33c9a2fc8d7592e2b89a51d405661` (`step-11-avatar-recovery-source.md`).

## Closing checks and handoff

The read-only closing inventory still matches all ten original bucket configurations, fourteen policies and enabled storage RLS. There are 452 objects, 72 gallery rows, sixteen avatar references and 34 video records; the video states remain 25 approved, eight hidden and one rejected. No privacy flip or browser write privilege was introduced.

At 14:56:33 UTC, a transport-restricted dry run of the actual source reconciler inspected 33 records across two bounded pages using 191 GET requests. Fourteen were already clean; nineteen were retained (fourteen unconfirmed approvals and five unrecognized publication paths). No deletion, private file download or automatic apply occurred. This establishes current dry-run behavior, not eligibility for a bulk purge or an atomic guarantee against arbitrary manual writers.

The remaining processing-receipt correction is described in `step-11-processing-upload-receipts.md`; its exact commit, push, deployment and preservation/health gates must pass before beginning Step 12. It covers venue inputs/QRs and generated videos/posters, with 69 new cases including 42 failures against the preceding implementation.

Carry these concrete limits into the named remaining steps; do not count them as verified fixes:

| Remaining boundary | Required follow-up |
| --- | --- |
| Avatar/profile/moderation approval and deletion, shared moderation metadata, whole-account removal and DMCA video restoration are not one protected lifecycle transaction. | Steps 13/17: inspect final ownership/version checks, atomic metadata transitions, audit coupling and competing lifecycle writers. |
| Venue derivative cleanup has no permanent shared-reference retirement/history or durable failed-cleanup receipt; separate page-review/audit writes remain. | Steps 13/17: review metadata/administrative lifecycle and safe retirement scope before adding any cleaner. |
| Failed uploads without a confirmed publication/history record retain files; legacy/unattributed paths are not safe deletion candidates. | Steps 19/22: recovery provenance, bounded reconciliation and storage recovery procedures. No automatic orphan sweep. |
| Worker error classification and best-effort private-source/venue cleanup can leave retained files without a specific cleanup acknowledgment. | Steps 19/20: distinguish provider versus storage failures, preserve recovery records, add safe diagnostics where needed. |
| Public media URLs and caches can outlive application visibility; database backups alone do not prove storage-byte recovery. | Steps 17/22: retention, public visibility limitations and separate storage recovery documentation. |
| Dormant ownership-claim/proof helper and manual demo/backfill writers retain older assumptions. | Steps 18/19/21: keep retired routes closed and require a new review before activation; never execute historical writers as validation. |
| Hosted cross-connection concurrency and disposable authenticated Storage writes were deferred by the user. | Step 21/23: preserve the explicit test gap; native/simulated tests do not certify those hosted flows. |

The Step 11 controlled pass closes only after the processing-receipt release gates pass. Its successful closure does not classify all twenty-four audit steps complete or erase the listed lifecycle/recovery work.
