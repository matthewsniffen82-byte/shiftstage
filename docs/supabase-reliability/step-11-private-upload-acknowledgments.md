# Step 11 — confirm private moderation uploads

## Inspected issue and controlled plan

Initial temporary uploads and copies into the private review bucket previously checked only the SDK's `error` field. A missing or mismatched success receipt could therefore create a moderation record for an unconfirmed file. On the review path, it could move the database pointer and delete the original temporary copy without confirmation of the replacement.

Use the existing shared upload-receipt validator for those two helpers. Require the exact object path and, when returned, matching bucket-qualified `fullPath`. Keep `upsert: false`, private buckets, the existing versioned gallery write and source-retention order. Never delete an uncertain upload to compensate for a missing response. No migration, bucket/policy change or production upload is required.

## Validation and recovery

Exercise the actual initial-upload and review/retry flows with the actual shared validator. Simulate explicit failures before and after storage commits, lost replies, malformed or foreign receipts and successful legacy/current SDK receipts. Assert that no unconfirmed review copy causes a pointer change or removal of its source. Existing gallery conflicts and publication failure tests must still pass. Run the complete release checks and verify the exact pushed deployment and read-only preservation.

A missing acknowledgment may retain a private object even if the upload committed. Do not sweep it or reinterpret it as an approved image. This correction adds no storage retry. The existing worker can schedule a bounded moderation retry after its generic error classification; copies still use `upsert: false`. Its distinction between provider failures, uncertain storage outcomes and exhausted avatar retries needs the dedicated failure-recovery/lifecycle review. Existing bounded reconciliation only covers confirmed, sufficiently old gallery approvals with retained published/original files. General upload-attempt provenance and avatar metadata coordination remain separately tracked limitations.

This correction validates storage publication acknowledgments. Existing private-source cleanup is best effort, and avatar/profile/moderation writes are not made atomic here. Rollback reverts the application commit; it requires no schema or data restoration.
