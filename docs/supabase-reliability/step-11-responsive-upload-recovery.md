# Step 11: safe responsive-upload failure handling

## Inspected issue and plan

`uploadResponsiveImage` uploads a master and its variants without overwriting. If any returned upload fails, it currently deletes every requested path and the archived original. An existing object's collision is a failure, not permission to remove it; `archiveOriginalMedia` deliberately accepts an already-existing original. This cleanup can therefore delete previously published media or its recovery source. A rejected promise also returns before other parallel uploads settle, while error-free but missing receipts are incorrectly accepted.

Preserve files after an uncertain/partial responsive upload instead of deleting paths without ownership and retirement evidence. Wait for the bounded set of in-flight uploads to settle, then require a matching path receipt for every successful upload before returning a publishable image. Require the same receipt for a newly archived original; preserve the existing no-overwrite/already-exists behavior. Keep image dimensions, variants, watermarking, MIME types, cache policy, routes and storage access unchanged. No database migration or production media mutation is planned.

Test actual image preparation, archival and upload functions with synthetic image buffers and controlled storage responses: collisions, partial success, lost responses, thrown errors, malformed receipts, delayed variants, existing-original reuse and normal unwatermarked/watermarked uploads. Compare against the previous implementation, run full tests/lint/build/standalone TypeScript/readiness, verify production metadata/security/preservation read-only, commit/push this correction and confirm exact Vercel success and health before continuing.

## Recovery limits

A failed request may leave a bounded number of retained objects. They need proven reconciliation; a missing reference or an error message alone is not authorization to delete them. This correction prevents destructive rollback but does not establish a durable upload-attempt journal, automatic orphan collection or cross-system transactions. Those storage retirement/recovery controls remain open. Reverting code requires no data migration; avoid reintroducing the unsafe cleanup.

## Regression evidence

All 49 focused checks pass, including 34 new actual-function tests; 21 fail against `52a63c8e9bccc5fe6606bce7d10416779fbd72a4`. Real synthetic JPEG buffers run through Sharp, responsive sizing, watermarking, archival and path generation. Controlled storage responses reproduce public-object collisions at all four positions, a repeated prepared upload, lost responses, malformed path/bucket receipts, existing originals and delayed variants. A failed request never deletes these files or returns a publishable result. Legacy successful path-only receipts remain accepted, matching the installed storage SDK contract; when a full bucket/path is present it must match too.

No production image bytes were downloaded or mutated for testing. There are no table, RPC, trigger, bucket, policy, MIME, upload-size or permission changes in this release. Existing-original reuse remains a no-overwrite result, not evidence that this request created the original. It does not authorize subsequent rollback deletion.
