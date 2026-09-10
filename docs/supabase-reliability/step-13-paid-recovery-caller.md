# Step 13 — signed reversal recovery caller

The database prerequisite `flag_paid_payout_recovery_safely` is deployed and verified. Replace the paid/partial reversal handler's separate commission update and audit insert with that transaction. Require the returned payout ID, paid status, provider reference, true recovery flag, positive safe-integer earning count and boolean retry marker before acknowledging the signed webhook. An explicit error still fails even if data is present.

Keep failed/canceled transfer handling, exact persisted-reference matching and early dispatch-reference retries. Keep partial-transfer completion before recovery, and never release paid earnings for another payout. If a response is lost after recovery commits, fail the delivery safely; an explicit provider redelivery can obtain the idempotent receipt without a second audit. Do not retry the write automatically inside one delivery.

The signed-webhook regression harness executes the actual application module and Stripe signature verification against explicit local table projections and the deployed SQL definition. The companion native database tests cover the complete inspected financial table constraints and triggers. Hosted provider callbacks and multiple concurrent database connections are not inferred from these tests. No signed webhook, payout or recovery call is sent to production as a test.

This caller correction changes no schema, grants, buckets or financial balances. Its deployment depends on the verified prerequisite fingerprint `aa3e2c160ed9709ff19934e06dac5f97`; retain that function during application rollback. Full validation, exact commit/push/Vercel and read-only production preservation/health checks remain required.

All 171 focused cases pass. Each of the 39 new signed-webhook cases fails against the preceding caller. An uncertain committed result fails the first delivery, then a subsequent delivery confirms recovery without adding an audit. Actual SQL fault injection confirms audit failures roll back the flags; existing manual review reasons survive. Stale provider references and missing payout items fail safely without releasing paid earnings.

Full validation passed all 5,991 tests, lint, production build, standalone TypeScript, thirty readiness checks and the migration guard. The accounting source guard now verifies the no-debit marker in the transaction and its RPC call. Exact commit/push/deployment and independent production preservation/health verification remain required.
