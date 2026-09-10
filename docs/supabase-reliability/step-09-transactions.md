# Step 9: transactional boundaries

Step 8's final direct acknowledgment correction was pushed as `819aef7b117d7007567643e3f3f82b5811b4fdd9`. Its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/5aDLvLiHZ3o7WiJereqaeXyieQaE) succeeded, and both health routes, authorized-route denials and thirty readiness checks passed at 04:03:27–29 UTC on 2026-09-10. The initial admin probe used unsupported POST and correctly returned 405; using the implemented PATCH method confirmed 401 before mutations. No production email or case action occurred.

## Initial workflow map

This is the initial 04:05 UTC inspection. The completed corrections, retained native functions and explicit remaining boundaries are recorded in [the transaction review](step-09-transaction-review.md) and the execution ledger.

| Workflow | Inspected boundary and remaining concern |
| --- | --- |
| Signup/profile repair | Existing account-lock provisioning RPC, identity verified by the server; application/Auth-provider coordination remains an external boundary. |
| Dressing-room tap, affiliation, Working Now and cashier confirmation | Existing database RPCs coordinate state; inspect their transaction/failure tests and exact deployed definitions before deciding changes. |
| Media publication and primary selection | Atomic gallery publication/selection functions delivered in Step 4; removal, pending moderation queues and storage-object cleanup remain separate. |
| Redemption engagement | Currently timestamp update, then event insert. A failed insert leaves a timestamp without its event; update failure can still create the event. First controlled correction below. |
| NFC support | Request, support message and activity writes are separate; deleting the request after an uncertain message result is unsafe. |
| Counter-notice submission | Notice insert, case transition and compensating deletion are separate. Forwarding acknowledgments are now checked, but submission must be atomic and external dispatch remains a separate recoverable boundary. |
| Profile/social approval | Profile/social fields, pending-review queue, review summaries/history and notifications are separate. Preserve version checks and completed decisions when evaluating an atomic boundary. |
| Account lifecycle | App user, owned venue and Auth-provider state plus compensation. Database transaction alone cannot undo a provider action; Step 17 must retain suspension semantics. |
| Administrator video import | Preparation/annotation/audit and replacement/cleanup can partially complete; preserve uploaded media while making database decisions explicit. |
| Finance | Existing invoice/payout uniqueness and claim/reconciliation functions need current definition/failure review; confirmed external provider/email work must not be blindly replayed. |

These are audit findings, not claims that every transaction is already fixed. Review and release each narrowly. Do not turn unrelated optional notifications into mandatory rollback dependencies.

## First controlled release: unused redemption event RPC

Add `record_deal_lifecycle_event_safely` as an unused service-only, security-invoker function. Existing application callers remain unchanged until this additive migration is applied and independently verified. The next controlled release can then switch the caller without a schema rollout race.

The function accepts only the three existing non-paying engagement types (`saved`, `shared`, `scanner_opened`), locks the uniquely identified redemption, preserves an existing first-event timestamp and inserts its event in the same transaction. Use one database timestamp after the row lock for both new fields. Missing valid tokens return null; query/constraint failures roll back the entire operation. Repeated deliberate events remain separate analytics events, while first timestamps remain unchanged. Do not add automatic retries or claim exactly-once delivery without a request idempotency contract.

Keep token/session validation consistent with the public route, revoke execution from PUBLIC/anon/authenticated and grant only service_role. Use an empty search path and bounded lock timeout. No function argument may award revenue, alter attribution, confirm a deal or change redemption status. No table, index, trigger, constraint or RLS policy is changed.

The read-only 04:05:48 UTC catalog found 36 redemptions, 35 events, two revenue entries and one commission entry; the unique token index is valid in the inspected definition, both target tables retain RLS, and the only target trigger logs newly issued redemptions after INSERT. The new function name is absent and the live ledger has 97 entries, ending at `20260910014900`.

## Validation and deployment safety

Test the actual migration in local PostgreSQL via PGlite against the inspected target columns/constraints and issuance trigger, with synthetic referenced rows. Cover all three events, preserved timestamps, repeated events, missing tokens, invalid event/session inputs, foreign-key failure, trigger-injected failure after the parent update, full rollback, no financial/attribution changes and denied browser execution. These tests do not substitute for deferred hosted multi-connection testing or historical Supabase replay.

Run the complete suite, lint, build, standalone TypeScript and readiness before the exact-file commit/push. Apply only the committed additive migration to the explicitly selected production project, with a short lock timeout, explicit transaction, duplicate-ledger/name guard and before/after fingerprints of existing data/catalog/access/ledger. Record the exact source and function fingerprints and verify service-only execution. Never invoke the new write RPC against a production redemption as a test. Vercel deployment and production health must pass before changing its caller.

Recovery is additive: if deployment fails, the transaction rolls back and existing callers still work. If verification finds a problem, keep the unused function uncalled, investigate and add a forward correction; do not drop tables, alter existing rows, reset migrations or erase ledger history. After callers switch, roll back application usage first if needed; retaining an unused function is safe.

## First release validation

All 33 new PostgreSQL cases pass against the captured 36 target columns, sixteen constraints and the existing issuance trigger (unrelated referenced tables use synthetic key-only fixtures). The local deployment wrapper also passes transaction, duplicate-ledger and schema-drift rejection tests. PGlite serializes queued calls; those cases are not independent hosted-connection tests. The new function's expected definition MD5 is `bbb2365ebeaa93a9e072cbffe50026d9`; normalized migration SHA-256 is `83696ad4b3ee6491af025bfb0c43605a8a398488d8a43c43a7cd640121afc9fd`.

Final validation passed all 4,174 tests, full lint, production build, standalone TypeScript, the migration guard and thirty live readiness checks. Postbuild skipped layout-review population. The application still uses its existing caller. Exact commit/push, guarded application of the committed SQL, matching function/ledger/permission verification, exact Vercel success and deployed health remain required before caller integration.
