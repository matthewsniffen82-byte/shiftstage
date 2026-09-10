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

## Inspected failure boundaries and remaining work

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

Responsive-upload rollback, durable retirement and the other listed recovery boundaries remain open. The audit step is not complete merely because individual corrections have deployed.
