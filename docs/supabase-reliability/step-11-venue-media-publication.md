# Step 11: preserve venue images after uncertain publication

## Inspected issue and bounded plan

Venue cover and logo uploads remove their newly uploaded public images and private originals when any subsequent database or mapping operation throws. The QR helper does the same when its database write returns an error. A write can commit before its response is lost, leaving a live venue pointing to deleted media. These paths also trust missing or mismatched write receipts and can overwrite a concurrently replaced image.

Change only these three upload/publication helpers: retain new objects after a database publication attempt, require an exact venue/path receipt before retiring the previously read image, and compare the previous path and its raw timestamp in the update. Preserve moderation, image validation, venue authorization, page-review behavior and server-only administration. Validate the optional QR label before uploading. No schema migration, bucket/policy change or production media mutation is required.

Run the actual helpers against an isolated PostgreSQL venue schema with synthetic storage, including committed writes with lost replies, rejected writes, malformed receipts, stale replacements, timestamp drift, null initial images, mapping failures and moderation denial. Verify current production schema/security with read-only metadata, then run the complete suite, lint, production build, standalone TypeScript and readiness checks. Commit/push only this correction and verify exact Vercel success and production health before the next change.

## Boundaries and recovery

Retained uploads can require later reconciliation; do not delete them merely because an acknowledgment is missing. Database and object storage are still separate systems. Shared-path retirement, responsive upload rollback, venue deletion and administrative review coordination remain separate audit work. This change does not claim durable storage retirement or automatic orphan recovery. Rollback is an application revert; no production rows/files need reverting. Prefer a forward correction because restoring the old cleanup restores its data-loss risk.

## Implementation and regression evidence

The actual cover/logo/QR helpers now compare the previous path and its unrounded database timestamp, reject an unconfirmed venue/path response, and retain final public images and archived originals after database errors. Profile URL mapping runs before old-image cleanup and the success log. Optional QR labels are validated before upload. The cover/logo route still requires an authenticated administrator; the QR helper retains its venue-access check and currently has no active route caller.

All 65 new actual-helper/PostgreSQL tests pass; forty fail against `8a7222d50e6a1e8d6e07d7f2a259aaf984174eeb`. The isolated fixture retains all thirty venue columns, eight constraints, four indexes and two production trigger definitions captured read-only at 12:16:28 UTC on September 10, 2026. Only related identity, default-deal and notification tables are synthetic dependency projections. Storage/provider failures are injected; no production upload, replacement, deletion or moderation call is used as a test. Tests include submillisecond stale-version rejection and unchanged unrelated records. This is not a claim of a hosted multi-connection concurrency test.
