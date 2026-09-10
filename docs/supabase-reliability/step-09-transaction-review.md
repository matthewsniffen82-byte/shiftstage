# Step 9: transaction review and handoff

This report closes the bounded transaction corrections and records the remaining cross-cutting work for subsequent audit steps. It does not declare the whole Supabase audit complete, external payments exactly once, or deferred hosted tests passed.

## Delivered boundaries

| Workflow | Current verified boundary |
| --- | --- |
| Auth/profile provisioning | Existing account-locked, idempotent provisioning preserves existing accounts and profiles; verified server identity is required. See Step 7. |
| Fresh dancer check-in | Registration, first activation, affiliation and eligible Working Now session use one checked transaction. Pending setup and cooldown rules are retained. See `step-09-dancer-tap-transaction.md` and `step-09-dancer-tap-caller.md`. |
| Redemption engagement | First-event timestamps and their event insert commit together; intentional repeated engagement stays distinct. See `step-09-redemption-caller.md` and the initial transaction report. |
| NFC support | The support request and message use a stable request UUID and one verified transaction; optional delivery is separate. See the NFC support reports. |
| Counter-notice submission | Notice and case transition commit together; changed retries conflict and exact retries preserve the original. Forwarding email remains an external operation. See the counter-notice reports. |
| Social/content/profile decisions | Version-aware transactions coordinate the saved fields, review queue/history, profile summary and required audit. Raw timestamp precision is preserved and optional notification failures cannot undo completed decisions. See the social/content/profile reports. |
| Media import | Unsafe destructive replacement is blocked. Final note/audit are atomic after reading actual publication status; ambiguous responses preserve uploaded work. See the import reports. |
| Gallery/primary selection | Previously delivered publication/replacement/primary-selection functions protect metadata. Storage byte lifecycle is reviewed in Step 11. |
| Webhook ledger | The atomic claim returns an exact attempt receipt; completion is fenced to that attempt. An expired worker cannot finish a newer worker's attempt. See the webhook reports. |
| Payout dispatch | Only a fresh requested batch can claim dispatch. The worker checks its receipt and preserves reservations on uncertainty. Processing rows require reconciliation, not automatic retransmission. See the payout reports. |
| Club invoice creation | Revenue is locked before validation, items are unique per revenue event, and invoice/items/assignment/totals/currency commit together. See `step-09-invoice-claims.md`. |

The execution ledger records each separate tested commit, deployment and production verification. Applied SQL remains frozen. The invoice release is `87904f0b5609430ae6f630144f5e22f43fee2d3c`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/A4ypK9h7rJVqHX8ritX1ALBPZBpy) succeeded and health/readiness/authorization checks passed at 10:34:45–48 UTC on 2026-09-10. Migration `20260910102400` preserved all existing records, permissions, 36 earlier constraints, fourteen earlier indexes, two triggers, five policies, 124 other functions and 107 prior migration entries.

## Existing functions retained

The current core-function capture at 08:11 UTC and cashier refresh at 10:30 UTC were read-only. Functions below already group their database writes into a single PostgreSQL transaction; introducing another wrapper solely for style would not improve that boundary.

| Function | Inspection and evidence |
| --- | --- |
| `apply_club_invoice_payment` | Locks the invoice; invoice payment, revenue settlement and agent availability are one transaction. MD5 `8a2ba72df6bea9b786b9681b6661d279` remains unchanged. Twelve additional native tests cover partial/full payments, failures at each update stage, rollback, old smaller payments, denied states and unrelated invoice preservation. |
| `request_dancer_payout` | Locks the dancer, settings, active batches and selected earnings; batch/items/reservation/audit share one transaction. Its unique-violation fallback requires an ownership review in Step 13, described below. |
| `create_dancer_payout_batch` | Locks selected available earnings; batch, item membership and reservations commit together. Existing unique active-payout and item protections remain. Account eligibility/reconciliation are separate boundaries. |
| `complete_dancer_payout_batch`, `release_dancer_payout_batch` | Native payout/verified-provider regression suites exercise captured functions and reservation/ledger transitions. Failures cannot justify releasing ambiguous external transfers. |
| `release_pending_dancer_earnings` | Bounded, ordered `FOR UPDATE SKIP LOCKED` selection and status update are one statement. It does not send money. |
| `issue_and_confirm_deal_redemption_from_nfc` | MD5 `935442d2de3b4fe4c2f1fb24a39bb9ca`. Issuance and nested confirmation share a transaction and a deal/customer-or-session advisory lock. |
| `confirm_deal_redemption_from_nfc` | MD5 `fffe4ecf407c242bb997dc75b4e3a9cc`. Locks tag/redemption, checks venue/fee/eligibility, and records redemption, revenue, commissions and tap together. Browser roles cannot execute it. Invalid/expired decisions raise, so the nested issuance rolls back. Existing source/route tests and the separate local integration SQL are not claimed as an executed hosted financial test. |
| Affiliation approval/revocation and deferred enrollment | Existing multi-table operations execute within their database functions. Revocation ends related sessions and changes affiliation references without deactivating the profile. Broader lifecycle semantics and lock order remain scheduled below. |

## Explicit remaining work

PostgreSQL atomicity does not itself prove correct isolation, ownership, idempotency or external delivery. Carry these findings forward:

- Step 11: storage upload/reference/removal ordering, including TV removal that can delete bytes before its metadata transition; abandoned uploads and uncertain cleanup.
- Step 13: the manual payout function's unique-violation fallback looks up a request key without repeating its dancer predicate. Verify and narrow that privileged receipt boundary before relying on it. Also inspect the paid-reversal recovery flag/audit writes, cashier allocation snapshots, and other privileged function validation.
- Steps 13/19: fresh and deferred dancer enrollment use differing lock orders. The fresh wrapper has a bounded timeout and rollback, but hosted contention/recovery remains unverified.
- Steps 16/17: timestamp semantics, optional review summaries, account/Auth-provider coordination, historical review retirement and DMCA administrative state transitions.
- Steps 19/20: durable external email/provider reconciliation, NATS acknowledgments and safe diagnostic context. No exactly-once email or payment guarantee is made.
- Step 21: expand executed native tests for the remaining cashier/affiliation/earnings branches. PGlite queues are serialized and referenced-table projections do not establish full production policy coverage or independent hosted-connection concurrency.

The user's deferred historical migration replay, disposable hosted project and account/email recovery tests remain deferred. No production business operation was used as a test.

## This closing release

Only settlement regression tests and audit records change. The twelve focused tests pass against the actual captured payment function and full invoice/revenue target schema, with an explicit synthetic agent-table projection. Full tests, lint, build, standalone TypeScript, live readiness, exact commit/push and successful deployment/health are required before Step 10 begins.

Full validation passed all 5,245 automated tests without failures, skips or cancellations, lint, production build, standalone TypeScript, the migration guard and thirty readiness checks. Read-only verification retained the invoice function, payment dependency, unique constraint, ledger and permissions. No SQL was reapplied. Exact push and deployed health are the remaining release gates.
