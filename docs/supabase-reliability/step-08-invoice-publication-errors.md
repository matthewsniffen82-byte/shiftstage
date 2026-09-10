# Step 8: invoice publication acknowledgments and recovery

## Prerequisite and production scope

The reminder correction was pushed as `dbf368034b0f460ec14eca435eb547c0ba1059e5`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/9GbZe2F2Yava6isfzcNPgKQJsQGg) succeeded. Both health routes and all thirty readiness checks passed at 02:32:02–05 UTC on 2026-09-10. Unauthenticated administrator GET/POST, venue/dancer finance and finance-cron requests all returned 401. Local HEAD and both remote main references matched. No billing automation, provider action or real email was invoked for verification.

The prior read-only scan found one failed invoice and one automatic-billing finance account. This change must preserve that record and must not run production billing to test it. Tests use synthetic provider responses and local PostgreSQL data only.

## Confirmed risks

`publishClubInvoice` ignores the database result after creating a provider invoice. It can attach an item, finalize and send despite an unconfirmed local provider reference. If the reference was committed but its response was lost, a retry follows the existing-invoice branch and skips item creation. That branch can finalize an empty draft. `publishClubInvoiceDrafts` also ignores the write recording a failed publication, can overwrite a terminal status, and returns only an opened count while hiding individual failures from the automation result. Finally, a null reconciliation result is counted as opened.

## Controlled plan

Require a confirmed local invoice ID when storing the provider reference, constrained to the expected pending states and a null/matching provider ID. Stop before item creation or finalization if that result is uncertain. For both new and resumed draft invoices, verify provider identity/customer and inspect its complete line list. Create the expected line only when the confirmed draft has no lines, using the existing deterministic item idempotency key. Re-read and verify the single expected line's ownership metadata, currency and amount before finalization. Preserve existing matching lines and refuse unexpected or ambiguous items instead of changing or deleting them.

Require an acknowledged reconciliation result before counting publication success. Report per-invoice failures alongside accurate opened counts to the existing automation error list. Check failure-status writes, restrict them to pending states, preserve terminal invoices, and use sanitized diagnostics. Do not automatically retry database writes, delete provider invoices, change amounts, run production billing or send test emails.

Use runtime synthetic-provider/native-database tests for returned errors, zero acknowledgments, uncertain committed reference/item results, existing-line reuse after retry, wrong identity, unexpected line contents, concurrent terminal status and failed failure-record persistence. Run the complete suite, lint, production build, standalone TypeScript and live read-only checks; commit/push and verify exact deployment/health before another change.

## Limits and sources

This remains one controlled correction within Step 8. A database transaction cannot cover an external invoice API. Distributed publication/dispatch leases and durable email-delivery deduplication remain Step 9. If a provider invoice is created but its reference never persists, the confirmed early stop leaves an unfinalized empty draft; recovery/cleanup must preserve it for reconciliation rather than assume it is safe to delete.

Stripe's [idempotency documentation](https://docs.stripe.com/api/idempotent_requests) permits key removal after at least 24 hours, so re-entry must inspect existing invoice lines rather than blindly reuse an old key. The existing integration creates a standalone item attached to its explicit invoice, consistent with [invoice item creation](https://docs.stripe.com/api/invoiceitems/create). The [line-item object](https://docs.stripe.com/api/invoice-line-item/object) and installed SDK expose amount, currency and metadata for validation. These are interface contracts; no live-provider transaction is claimed by the synthetic tests.

## Implemented correction

Publication now returns accurate opened counts plus per-invoice failures, and the existing automation merges those failures into its error list. Provider-reference writes request and verify the returned local ID, constrain pending states and preserve any different provider reference. Failure-state writes are also checked and cannot overwrite paid, void or uncollectible invoices. Provider and database failures use generic review instructions plus sanitized diagnostic metadata instead of storing raw provider errors.

Both new and resumed drafts use the same line verification. The new line-list requests have a ten-second limit and no automatic SDK retry. Matching existing items are reused, including after a lost item response or an old idempotency key. Missing items are created only after an explicitly empty complete list; the list is reread before finalization. Ambiguous lists, additional items, wrong amounts/currency/metadata or provider/customer identity mismatches stop publication without changing those items. Reconciliation must acknowledge the expected invoice. Existing void/uncollectible provider invoices are reconciled without being counted as opened.

Twenty-six new native-query/synthetic-provider cases cover these paths, including the actual automation count/error contract and concurrent reference/terminal-state changes. They pass with the twenty reminder cases and nine existing finance checks (55 total). The fixture uses the captured invoice schema and synthetic finance account/provider objects; it does not exercise live Stripe, real emails, provider idempotency expiration or hosted concurrent database connections. Existing SDK call deadlines and distributed delivery leases remain subjects for their later dedicated steps.

## Release validation

Final validation on `299e626d`, preserving the independent subscription-cancellation webhook correction, passed all 3,890 tests without failures, skips or cancellations, full lint, production build, standalone TypeScript and thirty live readiness checks. This final run includes the bounded line-read options. The focused 55-case set also passed. Postbuild skipped layout-review population. No schema migration, production billing, provider invoice, email, account or data modification was used for testing. Exact push, Vercel success and post-deployment health remain the release gates.
