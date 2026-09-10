# Step 9: claim revenue before creating an invoice

The payout caller was pushed as `3d3127c862f33caa4b66e113076202c9e9c13525`. Its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/AXYnWxEjmawy4cnc5gUzTyu3cH8w) succeeded. Matching main references, both health routes, protected-route denials, unsigned webhook rejection and thirty readiness checks passed at 10:19:00–03 UTC on 2026-09-10. Only then did this implementation begin.

## Inspected issue and plan

The deployed `create_club_invoice_draft` validates uninvoiced revenue, computes a sequence and inserts invoice/items before assigning the revenue. Its initial reads do not lock the revenue. The item constraint is unique only within one invoice, so two different invoices can refer to the same revenue. Concurrent updates can also change amounts or ownership between validation and insertion. Application selection is an advisory snapshot, not a reservation.

Read-only inspection at 10:19:31 UTC found one invoice, two items and two revenue rows. There were zero duplicate item revenues, mismatched revenue links or mismatched amounts. The three target tables retain RLS. Captured definitions include 55 columns, 36 constraints, indexes, two triggers and the draft/payment functions; no private rows are copied into tests.

Add one uniqueness constraint on an item's revenue event, preserving the existing within-invoice uniqueness and history. Inspection found no supported re-invoicing path that intentionally duplicates an event; voiding an invoice does not free its original revenue for automatic rebilling. Do not delete duplicates or rewrite existing items if the production preflight changes.

Replace only the draft function in a forward migration, retaining its signature, UUID result and service-only execution. Lock the venue before sequence allocation and selected revenue rows in stable ID order before eligibility and amount checks. Check the inserted item count/total and assigned revenue count so suppressed writes cannot return success. Keep invoice creation, items and assignment in one transaction. Retain invoice payment, agent allocations and dancer earnings unchanged.

The monthly job already groups revenue by currency, but the inspected function always used the invoice table's USD default. The replacement preserves the selected group's currency and rejects mixed currencies. Validate the final invoice period, sequence, currency, amount and exact item membership before returning its UUID.

## Verification and recovery

Use isolated PostgreSQL with all captured target columns, constraints, indexes and both triggers; referenced identities and agent records are explicit synthetic projections. Test duplicate protection, stale/suppressed writes, failure rollback, existing invoice preservation, sequence allocation, invalid input and browser denial. Queued PGlite calls are serialized and do not replace the deferred hosted multi-connection test.

Before publishing, run the complete suite, lint, production build, standalone TypeScript, readiness and migration guard. Rehearse exact migration application, duplicate-ledger rejection and drift rejection locally. Apply only committed SQL with bounded locks, exact old-function/schema guards, duplicate preflight and before/after data/access/dependency fingerprints. Preserve the existing migration ledger and confirm the new source, function and constraint after application. Verify exact Vercel success and deployed health without creating, publishing or paying a production invoice.

No data cleanup, storage operation, email or provider call is part of this release. If duplicates or unexpected drift are found, stop this migration and investigate rather than repairing records automatically. Transaction failure rolls back the entire migration. After delivery prefer a forward correction; do not remove the uniqueness protection or replay historical migrations as an automatic rollback.

## Release validation

All 47 new native tests pass; eighteen fail against the old implementation. Coverage includes direct duplicate inserts, preserved voided history, currency grouping, overlapping queued snapshots, suppressed writes, altered totals and transaction rollback. The deployment rehearsal passes normal application with existing invoice records, repeat rejection, schema drift rejection, duplicate rejection and rollback after an injected postflight failure. The exact payment function remains unchanged.

Full validation passed all 5,233 automated tests without failures, skips or cancellations, full lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. Postbuild skipped population. Migration `20260910102400` has normalized SHA-256 `e53908b529b19f4c2221b19918c33a640bb4c5b75686021a62b676f8922eb07c`; expected function MD5 is `3e0197ccd3d715c4322bd340eba69367`. Exact commit/push, committed-source rehearsal, guarded production application, preservation verification and Vercel/health gates remain required.
