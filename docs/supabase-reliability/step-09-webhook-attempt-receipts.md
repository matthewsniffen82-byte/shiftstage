# Step 9: webhook attempt ownership

## Inspected failure and controlled plan

The current claim function inserts a unique provider/event pair or reclaims failed/expired work, incrementing `attempt_count`. Its ten-minute processing lease is atomic, but it returns only a boolean. The application's separate completion UPDATE checks provider/event/status without the attempt number or start timestamp. If worker A pauses, worker B reclaims the event, and A resumes, A can mark B's attempt processed or failed. That can acknowledge unfinished reconciliation or permit another delivery while B is active.

Read-only production inspection at 09:02:31 UTC on 2026-09-10 captured all twelve table columns, five constraints, three indexes, two protection triggers, RLS and the admin SELECT policy. The ledger had zero webhook rows and 105 migration entries. The existing claim definition MD5 was `a59ee6e538a8ff65dd2731f3bc89ebb6`; it remains unchanged. No provider event was delivered or replayed to production.

First add the unused `claim_payment_webhook_attempt(text,text,text,text)` function. It calls the existing claim and returns the row ID, provider/event identity, claim outcome, status, attempt number and unrounded timestamp in the same transaction. It verifies the signed event type/object identity, and rolls back any claim if the receipt cannot be confirmed. It preserves the existing lease, unique key, retry count, retired-provider rejection and deletion protection.

The new function is security invoker, service-only, uses an empty search path, a three-second lock timeout and UTC receipt formatting. It adds no table/column/index, changes no existing policy/function, and returns no metadata or failure details. Keep the original boolean function for backward-compatible rollout and rollback. A later independently deployed caller release must retain this receipt and guard completion with its exact ownership fields. Until that caller is deployed, the older completion risk still exists.

## Validation and limitations

The local fixture uses the inspected full table schema and exact existing functions/triggers. Its synthetic browser roles have no administrator identity; the admin read policy itself was covered by Step 5. Thirty-four native PostgreSQL cases reproduce the old overwrite, exercise guarded completion, failed and expired retries, timestamp precision, duplicate claims, signed identity conflicts, post-insert failure rollback, retired providers, private data and denied browser access. PGlite queued calls are serialized and do not replace deferred hosted multi-connection tests.

The deployment wrapper rehearses an explicit transaction, duplicate-ledger rejection and schema-drift rejection. It compares existing data, catalog, privileges, constraints, indexes, policies, triggers, public functions and prior migration entries before/after applying only the committed additive SQL. It also verifies the inspected dependency and new service-only function fingerprint. No write RPC is called in production for validation.

Normalized migration SHA-256: `59f0d438938dadac0160f1bb7f277aa59598442dd3f55d3a54a23c67476f61a2`. Expected new function MD5: `0109cad00c3e3436b0f71eea1d9cc28c`.

This change fences completion of the event ledger. It cannot cancel an already-running external request or make all downstream provider effects exactly once. Those handlers must keep their own idempotency and reconciliation checks. Do not test by triggering billing, payouts, mail or real webhooks. Recovery before caller integration is to leave the new function unused and apply a forward correction; after integration, roll back the application first if necessary. Never delete financial records or rewrite migration history.
