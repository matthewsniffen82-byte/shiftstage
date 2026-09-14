# Invoice reminders and complete finance totals

The September 2026 code audit's findings 3 and 4 are addressed by migrations `20260914055314` and `20260914055315`. Apply these committed, additive migrations before deploying the application consumers. They do not alter historical financial rows or replay previous migrations. Finding 2's exhausted video recovery is already included in commit `6c401500` and covered by the video worker ownership tests.

## Reminder delivery

Every reminder reserves a durable delivery ID before calling Stripe. An invoice lock serializes claims and completion, a 60-second lease prevents overlapping dispatch, and the delivery ID supplies one provider idempotency key across retries. Completion inserts the unique reminder ledger entry, increments the invoice summary, and marks delivery sent in one database transaction. Failed or lost acknowledgments retain the reservation. A completed ledger entry skips later dispatch.

Stripe can discard [idempotency keys after at least 24 hours](https://docs.stripe.com/api/idempotent_requests). The reservation therefore permits retries for 23 hours from the first claim, using a 10-second provider request with automatic network retries disabled. Later uncertainty moves the invoice to `review_required`; a later weekly reminder cannot bypass that hold. Held invoices do not occupy the next candidate batch. Other eligible invoices continue when one delivery fails, and the batch still reports an error.

Admin finance displays the durable hold even if provider reconciliation has cleared the invoice's transient `last_error`. To investigate, an operator with service access can inspect `club_invoice_reminder_deliveries` and match `mydancr-reminder-<delivery ID>` against Stripe request logs and invoice delivery events. Once the outcome is independently confirmed, reconcile the delivery and reminder ledger/count in one reviewed transaction. Do not delete a reservation or issue a new key to resolve an unknown outcome. If delivery cannot be verified, keep the hold. A delayed retry can require this review even when the original request never reached Stripe; avoiding an unverified duplicate is intentional.

Only the service role can access the new table or execute claim/completion. The existing admin authorization boundary still controls reminder operations. Tests use a synthetic provider; production validation must never invoke invoice automation or send a real reminder.

## Finance totals

`get_admin_finance_totals()` aggregates all relevant invoices, settled platform revenue, NATS accounts/exports and earning groups in the database. Invoice/payment status definitions are preserved. The top ten venue and dancer rankings are selected after all eligible commissions have been grouped. Recent display lists remain bounded independently.

The service-only function returns integer strings so the application can reject missing or unsafe values without silently showing partial totals or zeroes. Existing dancer balance summaries continue to use their separate accounting function. Regression fixtures exceed the previous 200-invoice, 5,000-revenue/commission and 500-NATS limits, and cover empty history, partial payment, terminal statuses, rankings, browser-role denial, malformed totals and persistent reminder holds.
