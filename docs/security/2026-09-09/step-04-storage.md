# Step 4 — storage access and media permissions

## Current configuration

Fresh production metadata was captured at 2026-09-09 11:24 UTC using a read-only transaction. All ten buckets, fourteen storage object policies, storage table grants and the foldername helper matched the previously audited configuration. Storage RLS remains enabled. No bucket visibility, policy, object or production account was changed during this step.

| Bucket | Intended access | Provider size limit | Allowed types |
| --- | --- | --- | --- |
| dancer-photos | Public processed artwork | 10 MiB | JPEG, PNG, WebP |
| venue-cover-images | Public processed artwork | 10 MiB | JPEG, PNG, WebP |
| venue-logo-images | Public processed artwork | 10 MiB | JPEG, PNG, WebP |
| venue-qr-codes | Public generated artwork | 10 MiB | JPEG, PNG, WebP |
| dancr-image-moderation-temp | Private, server/admin processing | 10 MiB | JPEG, PNG, WebP |
| dancr-image-moderation-review | Private, server/admin review | 10 MiB | JPEG, PNG, WebP |
| dancr-media-originals | Private, server-only original archive | 10 MiB | JPEG, PNG, WebP |
| mydancr-tv-videos | Private; authorized owner or limited signed delivery | 75 MiB | MP4, WebM, QuickTime |
| venue-ownership-proofs | Private; claimant relationship or admin | 10 MiB | JPEG, PNG, WebP, PDF |
| verification-documents | Private legacy files; owner/admin read | 10 MiB | JPEG, PNG, WebP, PDF |

Provider content-type restrictions are not a substitute for inspecting file bytes. The existing validation/moderation/re-encoding controls remain in place and receive their detailed Step 13 review. Identity-document upload routes remain retired with HTTP 410.

## Finding and change

**LOW — deployment verification omitted storage configuration.** The existing readiness command checked Auth and database boundaries but could still report success after a private bucket became public or its file limits were removed. No such live misconfiguration was found.

The existing read-only readiness command now checks all ten bucket contracts using the server credential. It rejects public sensitive buckets, missing/duplicate/unreviewed buckets, invalid or unbounded sizes and content-type expansion outside the audited allowlists. Narrower limits, fewer permitted types and private visibility on artwork buckets are accepted as stronger settings. It never changes provider settings. Output contains known check names and booleans, not object paths or private provider responses.

These are explicit release checks, not a continuous monitor or a substitute for provider access controls. No watcher, new service, paid feature or additional runtime dependency was introduced.

## Permission and path review

- Ordinary anonymous/authenticated users have no object INSERT, UPDATE or DELETE policy. Uploading into an owned prefix does not grant direct write permission. Existing active-admin and service operations remain protected by their established boundaries.
- Pending images go to private moderation buckets. The server generates user/profile-scoped UUID filenames; decoded and approved images are published through server-managed responsive-image processing. Browser filenames do not determine storage keys.
- Venue proofs use the validated venue ID, authenticated user ID and a random identifier. Claimant reads require a matching ownership-claim row, not merely a filename prefix. Branding and QR writes remain behind server authorization.
- Video upload paths contain the authenticated user ID, owned dancer ID and a validated/generated UUID with a MIME-derived extension. Retry lookup filters submitted_by; path validation runs before an existing upload is inspected or signed. Completed uploads are not reissued as writable. Signed upload URLs do not enable upsert.
- Private video originals use the __originals prefix, outside the ordinary owner-read prefix. Image originals remain in the private original bucket. Private review thumbnails and proof URLs are issued after owner/admin lookup and expire.
- Photo/video deletion selects the owned database record before using its stored path with the server client. Browser requests do not supply an arbitrary bucket/path for deletion.

## Executed checks and limits

Nineteen new PostgreSQL storage tests execute the captured policies with synthetic objects in all ten buckets. Anonymous, owner and unrelated-user attempts to upload, overwrite, rename and delete objects are rejected. Private metadata reads are denied across users; legitimate owner/admin/public-artwork reads still work. Tests also cover private originals, bucket-visibility changes and inactive-admin access. These test storage policy semantics, not the complete hosted Storage HTTP implementation.

Ten additional readiness tests cover configuration changes and sanitized output. The focused suite, including existing upload/security tests, passed 34 tests. The updated live readiness command passed all 30 checks.

At 11:29 UTC, HEAD-only requests tested public and unauthenticated private URLs. Existing objects in all five nonempty private buckets (including legacy verification files) returned HTTP 400 through both paths. No file contents were downloaded. The ownership-proof bucket was empty; its private setting and missing-object denial were verified, but an existing-file HTTP test was not claimed. Existing public photo, cover and logo objects returned 200. The QR bucket was empty. Temporary object-path metadata was discarded; evidence retains bucket IDs, existence flags and statuses only.

The full suite passed all 2,098 tests with zero failures/skips. Lint, TypeScript, the migration history gate and production build passed; postbuild skipped demo population. Exact-commit Vercel success and deployed health are required before Step 5. Authenticated Storage HTTP tests with designated disposable accounts remain a staging limitation; role-context PostgreSQL tests and direct anonymous HTTP checks cover different boundaries and are not interchangeable.

## Public-media limitation retained for the privacy review

Public bucket downloads bypass row-level read policies. Previously shared public photo/artwork URLs therefore are not revoked just because a profile disappears from discovery. The storage SELECT policy protects metadata queries, not those public downloads. This is the existing public-media delivery model; this step does not assert confidentiality or revocation for artwork already published publicly. Step 27 must assess the product's visibility promises and required unpublishing behavior before changing that model. Private originals, moderation material, proofs and identity files are never served through the public artwork buckets.

Primary provider references: [bucket visibility](https://supabase.com/docs/guides/storage/buckets/fundamentals), [storage access control](https://supabase.com/docs/guides/storage/security/access-control), and [signed upload behavior](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl). The live configuration and application code were checked independently rather than inferred from these documents.
