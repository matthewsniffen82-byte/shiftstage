# Step 9: webhook completion ownership

The additive receipt foundation was pushed as `cb51c4fc10ca1e93581ae8f9cfec21d96b9bb7c1`. Its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/E4ZNmXYgXcVFiAnR63r7fb47aZwh) succeeded; health and thirty readiness checks passed at 09:12:35–38 UTC on 2026-09-10. Committed migration `20260910091000` is applied and frozen, with source MD5 `d811a581f7bb886f97414fde80484211` and function MD5 `0109cad00c3e3436b0f71eea1d9cc28c`. The existing claim function, records, access, five constraints, three indexes, two triggers, policy, 123 public functions and 105 prior ledger entries were preserved.

## Controlled change

Replace the boolean claim plus separate lookup with the atomic `claim_payment_webhook_attempt` receipt. Validate its identity, shape, status, positive integer attempt count and timestamp before processing. Return only a frozen ownership object; preserve the exact timestamp rather than rounding it through JavaScript Date.

Both successful and failed completion now use one UPDATE constrained by provider, event ID, ledger row ID, attempt number, exact start timestamp and processing status. Require the acknowledged row ID to match. The endpoint passes the same ownership object to both completion paths. A stale worker cannot finalize, fail or release a newer attempt; absent/malformed ownership fails before querying.

Keep signed raw-body verification, the five-minute signature tolerance, one-megabyte cap, handled event list, provider reconciliation and generic failure responses unchanged. An active lease remains retryable; only an already processed receipt is acknowledged as a duplicate. Do not add automatic financial retries. A lost claim response leaves its lease intact, and a lost completion response leaves committed completion intact; the provider's next duplicate can observe that completed state.

## Tests and production boundaries

The actual TypeScript handler/service tests now run against the inspected full native event schema and applied receipt migration. Added coverage includes expired successful/failed workers, overlap with newer in-flight/completed work, missing/malformed receipts, unrounded timestamps, mismatched completion rows, private-field exclusion, invalid ownership, transport failures and lost acknowledgments. Existing signed-event, payout, invoice, subscription and payout-account test contracts retain their behavior with the new completion argument. All 267 focused tests pass.

Run the full suite, lint, build, standalone TypeScript, migration guard and read-only dependency/readiness checks before commit/push. Verify the exact deployment and production health. No production webhook, payout, billing request or email is used as a test; the SQL migration is not reapplied.

The ownership guard protects event completion. It does not cancel old workers or make every downstream operation exactly once, so provider operations still need their existing independent idempotency and reconciliation checks. Hosted multi-connection testing remains deferred. Roll back this caller commit if needed while retaining the additive function; never delete financial ledger rows or undo the schema history.
