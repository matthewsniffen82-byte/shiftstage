# Step 9: claim fresh payout dispatch atomically

## Inspected risk and controlled plan

The existing worker reads requested/processing batches, uses `mark_dancer_payout_processing` before sending and retries processing rows whose provider reference is the temporary dispatch key. That marker locks the payout but accepts already processing rows and can overwrite a known provider reference. A stale worker can therefore send again. If its local `dispatchStarted` flag is still false, the failure branch calls a release function that also accepts processing rows, potentially freeing another worker's reservation. Missing marker acknowledgments are currently treated as permission to send.

Read-only inspection at 09:27:10 UTC on 2026-09-10 captured 69 columns, 29 constraints, ten triggers, target indexes, RLS and five existing functions. The three inspected tables contained zero payout batches, one commission and one financial audit event. No payout or provider request was made. The audit table's ID is `GENERATED ALWAYS AS IDENTITY`; the local fixture preserves this property.

Add an unused service-only `claim_dancer_payout_dispatch(uuid)` function. Lock the payout row and grant permission only when its status is requested and no prior dispatch reference, processing/completion/failure timestamp or reconciliation flag is present. Retain the existing production/test, currency and retired-provider boundaries. Processing, paid, failed and canceled rows return `claimed: false` without mutation.

For a fresh request, call the existing processing marker inside the same transaction, keeping its financial audit. Verify the actual saved state and preserve all other batch fields before returning the exact payout identity, amount, currency, provider and stable dispatch key. A failed audit, skipped update or inconsistent result rolls back the claim. No earning, payout item, provider transfer or external notification is changed by this function.

The function is security invoker, service-only, with an empty search path, three-second lock timeout and UTC formatting. Existing functions, tables, indexes, constraints, triggers, RLS and migration history remain unchanged. The application caller stays unchanged until this additive foundation is deployed and verified. Its separate release will require the claim receipt, stop automatic redispatch and preserve reservations on uncertain results.

## Validation and recovery

Thirty-three native database cases pass. They reproduce the old marker overwrite and verify one fresh owner, unchanged reserved earnings/history, no automatic expiry into another send, lost-acknowledgment retry, invalid states, permission denial, deletion protection and full claim/audit rollback. The three target tables retain the captured columns, constraints, indexes and ten triggers. Referenced identity/settings/history/NATS tables are synthetic projections. The unrelated NATS eligibility helper intentionally throws if reached; dispatch must not invoke it. Queued PGlite calls are serialized, not independent hosted connections.

The committed-only deployment wrapper rehearses transaction, duplicate-ledger and schema-drift checks. It verifies the exact dependencies, identity definition and service-only fingerprint while comparing existing records, catalog, policies, access, functions and prior ledger entries before/after. Run the complete suite, lint, build, standalone TypeScript, readiness and migration guard before commit/push. Apply only the reviewed committed migration and verify exact Vercel success plus deployed health. Never exercise the write RPC or send a real payout as a test.

Migration SHA-256: `8b2b283ca3f37607915efddd003e3b1e59ab107266b57ef9f9804dceb440d8b5`. New function MD5: `821f2959d65d722b559158276baccef4`.

If delivery is uncertain, retain the processing reservation and reconcile the provider's records for the exact payout ID. Confirmed transfers can be completed through the existing provider reconciliation. Do not release or retry based merely on a missing response. A confirmed-not-sent case needs an operator-reviewed, audited release before the existing failed-payout retry creates a new batch. A still-requested payout that failed eligibility checks can be tried later without releasing its earnings. This foundation does not add a reconciliation UI or claim external exactly-once delivery.

Rollback before caller adoption is to leave the additive function unused and add a forward correction. After adoption, roll back the application first if required. Keep financial records and the migration ledger; never reset or delete them for recovery.
