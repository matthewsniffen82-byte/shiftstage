# Step 20 closing review: webhook security

This record consolidates the delivered webhook corrections and the inspected production boundary. Completion requires this closing release's full validation, push, exact Vercel success and deployed checks. It does not certify provider-dashboard configuration or promise that every financial event is globally ordered.

## Implemented controls

The only external webhook route remains /api/stripe/webhook. The removed identity-verification callback remains unavailable; cron endpoints retain their separate bearer authentication. The sixteen handled Stripe event types cover invoices, connected accounts, transfers and legacy subscriptions.

| Boundary | Retained or delivered behavior |
| --- | --- |
| Incoming delivery | The official Stripe SDK verifies exact raw bytes, with a five-minute tolerance, one-megabyte streamed/declared size cap and supported-event allowlist. Failures disclose no provider body, secret or raw database error. |
| Event ownership | The unique provider/event claim returns a transactional attempt receipt. Only a processed duplicate is acknowledged; active or uncertain work remains retryable. Completion requires the exact row, provider, event, attempt number, unrounded start time and processing state. |
| Invoices | Relevant signed callbacks read current provider state with a ten-second timeout and no automatic network retry. Identity and captured local version constrain updates; payment settlement uses the existing locked transaction. |
| Payout accounts | Current provider account identity is checked against the dancer and existing binding. All account writers use the captured version or insert without overwriting a competing owner/provider row. |
| Transfer completion | Confirmed same-reference paid results survive redelivery. An uncertain completion uses one bounded read before acknowledging; it never repeats a financial write inside the same delivery. |
| Transfer reversal | Full/partial amounts are validated. Partial reversals retain paid earnings for manual recovery, and early callbacks wait for the exact dispatch reference. Metadata alone does not authorize reversal writes. |
| Paid recovery | The independently delivered transaction checks the paid payout, reference, earning/item relationships and receipt, preserves existing review reasons, and commits flags/audit together. A retry does not duplicate its audit. |
| Dispatch | The independently delivered fresh claim prevents automatic retransmission of processing payouts. Uncertain dispatch retains its reservation for reconciliation. Existing provider idempotency is also retained. |
| Database and privacy | Relevant functions remain service-only with pinned search paths. The event ledger retains RLS and no browser writes; no verification documents, credentials or full financial payloads are logged. |

The application does not substitute browser cookies, CSRF or CORS checks for provider signatures. It does not send real payment requests or signed production callbacks during validation. [Stripe's delivery documentation](https://docs.stripe.com/webhooks) explains why signature freshness, event deduplication and reconciliation remain separate controls.

## Delivered security releases

Detailed findings and test limitations remain in [the Step 20 record](step-20-webhooks.md).

| Commit | Bounded correction |
| --- | --- |
| 9de701e920d7172b8e116e40ba2f2310283036f7 | Require confirmed event acknowledgment and distinguish unfinished deliveries. |
| 9a36b8e66ed3de20338caea2c40fcd65a8aa77af | Reconcile invoice callbacks against current provider state and local versions. |
| c46443fb409e64c9687099783b61715dd7bcaf77 | Confirm already-completed payout retries. |
| 299e626dcae018b9c8d13dd9d158850a69df31e7 | Scope legacy cancellation to its exact subscription and dancer. |
| dc83d703f6af6950e3df56286fee537be60b718d | Guard payout-account snapshots and concurrent writers. |
| acef1c77da273f8cbcefe41b8305011536870bc8 | Confirm completed reversal retries. |
| bbcae0942cb36bfe33ec4307cd7d64f8c69bf76a | Preserve earnings after partial reversals. |
| 96dd84c9fc4df615cf3806a2dd4fc559632aa084 | Retain early reversals while the dispatch reference is being saved. |

All eight commits were separately pushed and successfully deployed. The last release's exact deployment GEs3EK4JWuKbhgY9YijTXnf7QhCW succeeded; at 10:05–10:06 UTC on 2026-09-10, seventeen health/authorization checks, thirty readiness checks, four webhook rejections and fifteen header checks passed. Read-only checks retained functions, transfer schema, all ten inspected financial triggers and access controls. The worktree was clean and matched origin/main.

Independent reliability releases are preserved and credited separately: cb51c4fc/6a0afba2 introduced and adopted atomic webhook attempts; 98890646/3d3127c8 introduced and adopted fresh dispatch claims; f61aa2bb/6dd4cd5c introduced and adopted atomic paid recovery. Their records include exact committed SQL, native tests and deployment evidence. This closing release reapplies no migration.

## Explicit remaining risks and validation limits

| Severity/status | Remaining issue | Disposition |
| --- | --- | --- |
| LOW in the current inactive workflow | Legacy subscription-created/updated snapshots still use an unconditional dancer-scoped upsert. Delayed events can replace newer legacy billing state; the exact-ID cancellation correction alone does not solve all ordering. The checkout subscription read also retains the SDK's existing timeout/retry defaults. | Deferred until a legacy billing migration or reactivation is actually required. The public checkout/portal return free access and null URLs, normal access does not consult subscription state, and the current database has no subscriptions. Restoring paid signup or inventing replacement rules would change product behavior. Before reactivation, specify customer/owner binding and replacement semantics, then add current-provider/version checks and bounded retrieval. Administrator cleanup's legacy cancellation behavior remains intact. |
| LOW while direct payouts are disabled | Transfer-created still relies on its signed snapshot and a processing-batch metadata fallback. Reversed/created ordering can leave terminal retries failing; current provider amount/account/currency reconciliation and an atomic expected-reference condition remain incomplete. | Deferred before enabling direct payouts. Current database payouts are disabled with no payout batches/accounts. The existing guards retain paid/reserved money and manual recovery. Activation must first add explicit current-transfer reconciliation and exercise opposite delivery orders and reference replacement against a safe provider environment. No enabling or speculative replacement transaction is included here. |
| Unverified external configuration | Provider dashboard endpoint scope, live/test configuration, active signing-secret configuration, actual retry delivery and key restrictions were not accessible. | Local configuration inspection at 16:46:22 UTC found no available Stripe API key or webhook secret and sent no provider request. This does not describe Vercel's production environment. Confirm provider settings through an authorized read-only console review and test synthetic scenarios in a designated provider test environment before relying on integration activation. No secret is printed or rotated. |
| Operational limitation | External delivery is finite; a permanently uncertain dispatch or event cannot be made exactly once merely by a local lease. Hosted multi-connection and real provider-account exercises remain unverified. | Preserve the private ledger and financial reservations; reconcile the exact provider reference. Carry useful monitoring/logging work into Steps 22/29 and safe scenario coverage into Steps 30/31. Do not replay financial operations automatically or use production data for destructive tests. |
| Accounting/business limitation | Current invoice reopening does not introduce automatic negative revenue adjustments, refunds or recovery debits. | Preserve the existing accounting model. Any refund/reversal accounting change needs explicit business semantics and a separately reviewed transaction. This audit does not authorize a new debit or repayment workflow. |

Read-only production inspection at 16:46:34 UTC retained transfer columns, constraints, all ten captured triggers, permissions and policies. Database payouts remained disabled, with zero payout batches, payout accounts and subscriptions. Those observations justify treating the inactive billing/direct-payout issues above as preactivation work, not declaring their code free of defects.

## Closing regression coverage and next step

Thirteen new tests execute the real free-billing status, checkout and portal handlers with synthetic authenticated contexts and controlled database responses. They verify owner-scoped status, null payment URLs despite caller-supplied payment/redirect data, authentication denial and safe dependency failure. No provider or legacy-subscription dependency is allowed by the harness. Existing role tests cover the real request-context boundary; these handler fixtures do not claim independent authentication-provider testing.

The focused closing run also exercises the actual signed route, event claim, invoice/account reconciliation, completion/reversal, paid recovery and fresh dispatch using the existing synthetic-provider and native PostgreSQL suites. Full tests, lint, standalone TypeScript, production build, isolated browser checks and deployed health must pass before moving to Step 21.

After those delivery gates, Step 20's audit and applicable current-production corrections are complete with the above explicit deferrals. Step 21 will inspect user-facing errors and information disclosure. The overall 32-step mission remains incomplete.

## Final local validation
+Final closing validation on 08927cdf2648cd626005e3fa43e6ba6837e41f8c passed all 6,043 tests with zero failures, skips or cancellations, uncached lint, standalone TypeScript, the production build and eight isolated browser checks (17:48:38 UTC on 2026-09-10). The focused security run passed 501 checks. The migration guard passed across 158 files and preserved all 142 frozen files; postbuild skipped demo population. Independently delivered cashier allocation snapshot commit 08927cdf was reviewed and preserved, with exact successful Vercel deployment 7KoMHQAtYZDstEdfmMitwkHfGAkt. No SQL is applied by this release.

An earlier full-suite attempt stopped because the local disk filled. No test failure from that incomplete attempt is treated as a passing result. In-place NTFS compression of this worktree's cache and part of its dependencies recovered space without deleting files; the dependency compression pass was stopped before completion. The complete retry used two test workers and passed. The build emitted nonfatal ENOSPC warnings while saving optional webpack cache, then completed compilation and browser verification. The existing npm strict-allow-scripts configuration warning is deferred to Step 24. The closing release changes only security documentation and thirteen regression tests. Task-only commit/push, exact deployment success and deployed health remain the final gates before Step 21.
