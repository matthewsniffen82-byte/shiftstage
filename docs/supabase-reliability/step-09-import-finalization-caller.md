# Step 9: connect import finalization receipts

The additive foundation `bf17fc9ae2a7dec2ae9204a0fbe5003433961c8e` is applied and verified. Its exact Vercel deployment succeeded; production health, protected-route denials and thirty readiness checks passed at 07:55:49–52 UTC on September 10, 2026. The frozen function fingerprint is `726e7836f338223473e3b71a36ee8d4d`.

## Inspected issue and plan

Replace the finalization endpoint's separate note and audit writes with one checked RPC. Retain active-admin, constant-time import key, bounded-body and explicit batch-recovery authorization. Reload the actual stored video after publication/moderation before deciding whether it still needs administrator review; reload again after that review. Never use an earlier helper result or original status as the final success status.

Pass all twelve raw version fields without losing timestamp precision. Verify receipt identity, batch, status, audit ID, recorded timestamp, replay flag and every returned version field. Do not expose private moderation notes or storage paths in the response. No automatic RPC retry, compensation, file deletion or fallback writes. An uncertain response should explain that publication may already have happened and require checking the batch. Identical explicit retries reuse the installed SQL receipt.

Use actual endpoint/helper tests backed by local PostgreSQL, including lost responses, stale versions, bad receipts, authorization, read failures and post-publication audit failures. Preserve the preparation regression suite. Run complete tests, lint, build, standalone TypeScript and live read-only checks, then commit/push and verify the exact deployment. No production import, upload, moderation, email or deletion will be used for testing; do not reapply the migration.

External publication/file processing still precedes the final bookkeeping transaction. This change does not make those provider operations atomic or solve simultaneous batch preparation; those limitations remain documented in the preparation and foundation reports.

## Validation before delivery

All 163 focused checks pass, including 61 new native endpoint/helper cases. The query declares its dynamic selection's result as unknown field values and validates every required field at runtime. Read-only dependency verification at 08:01:44–46 UTC confirmed the frozen SQL/ledger, service-only function access, target RLS and unchanged aggregate counts (34 videos, 168 audit actions, 29 accounts). No migration or production business operation was invoked.

All 4,884 automated tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks passed. The initial build caught a dynamic-selection type error; the query result type was corrected, then the full suite, lint, build and standalone TypeScript passed again. Exact push, Vercel success and deployed health remain required.
