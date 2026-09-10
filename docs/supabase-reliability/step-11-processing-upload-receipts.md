# Step 11 — confirm venue and video processing uploads

## Inspected boundary and plan

The remaining active media-processing helpers checked storage errors but not returned upload identities: venue cover/logo moderation inputs, watermarked videos and their posters. The existing venue QR helper has the same gap, although no current application caller uses it. Add the existing exact path/bucket upload-receipt validator at each boundary before invoking moderation, publishing metadata, returning a poster path or logging successful video processing.

Preserve current formats, cache controls, private originals, sequential video/poster uploads and access checks. No schema, public/private bucket setting, retry expansion or publication-policy change is needed. An unconfirmed video upload must stop before uploading its poster. Uncertain processed media stays stored; do not delete a referenced video to compensate for a failed acknowledgment.

## Tests and delivery

Extend the actual-module/native venue tests with missing/foreign receipts and explicit upload failures, asserting unchanged venue rows and previous files. Exercise the real video-processing helpers and FFmpeg on a tiny synthetic video with simulated storage, covering video, associated poster and standalone poster stages. Check acknowledgment errors, lost replies, original preservation, stopped follow-on writes, successful current/legacy receipts and suppressed success logs. Do not upload or process real production media as a test.

Run focused and full suites, lint, build, standalone TypeScript, migration guard and readiness. Commit/push only this correction; verify exact Vercel success, production health, authorization boundaries and read-only preservation.

## Limits and rollback

Venue moderation inputs have no database pointer and retain their existing finally-block disposal; approved/new final media and previous venue references remain protected separately. Video processing still replaces derivatives at the existing generated path and cannot atomically coordinate object storage with every lifecycle writer. Public cache eviction, failed-attempt provenance, shared venue retirement and metadata lifecycle remain explicitly tracked elsewhere.

The retired venue ownership-claim helper and manually invoked demo/backfill writers are not re-enabled or executed. Their dormant cleanup/marker assumptions require review before future activation; retired-route tests must remain green. Application rollback needs no database migration reversal, but it cannot undo an already overwritten derivative; private originals remain the recovery source.
