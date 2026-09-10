# Step 11 — acknowledge venue image deletion

## Inspected issue and plan

The active admin cover/logo deletion helpers read the previous image, then clear the row using only the venue ID. A concurrent replacement can therefore be cleared by a stale request. They also begin removing files before validating the returned row or mapping the response. The previously delivered upload correction already protects its separate replacement writes.

Scope this correction to the two admin deletion helpers: compare the observed storage path and full database media timestamp, require one returned row for the same venue with the intended path cleared, and map that row before cleanup or success logging. Preserve the existing inactive-venue draft transition and retired owner editing routes. No migration is needed.

## Validation and production boundary

Extend the existing actual-module/native venue fixture tests with acknowledged and already-empty deletion, stale path, one-microsecond timestamp changes, a concurrent upload into an empty slot, unrelated edits, legacy null timestamps, failed reads/writes, lost acknowledgments, malformed/mismatched receipts and mapping failures. Storage transport is simulated; tests never delete production media. Run the complete suite, lint, build, standalone TypeScript, migration guard and thirty readiness checks before the exact commit/push/deployment gate.

All 107 focused cases pass, including 42 deletion cases. Twenty-four of the deletion cases fail against the preceding deletion implementation. The read-only production comparison at 14:21:33 UTC matches all thirty venue columns, eight constraints, four indexes, two triggers and enabled RLS.

## Recovery and limits

A lost acknowledgment can leave metadata cleared while retaining the old files. Refresh the venue before deciding whether another action is needed; retained files are not proof of an orphan and must not be swept automatically. Roll back the application commit if necessary; no schema or data rollback is required by this code change.

This corrects stale metadata clearing and premature physical cleanup. It does not add venue reference history or a permanent shared-file retirement guard, provide a durable retry record for old venue images, or make Storage and PostgreSQL one transaction. Existing post-acknowledgment cleanup remains best effort. Those limits remain open in the storage/lifecycle audit; gallery retirement rules must not be applied to the different venue path layout.

The admin route still performs `resetManagedVenuePageReview` after the media helper. Its separate review/audit writes belong in the privileged-operation and lifecycle review; this correction does not claim they are atomic with image removal.
