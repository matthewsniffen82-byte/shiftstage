# Step 13 — consistent cashier commission allocations

## Inspection and production impact

Fresh read-only production inspection captured `confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb)` with fingerprint `fffe4ecf407c242bb997dc75b4e3a9cc`. Its caller issues and confirms a Club Deal in one transaction. The confirmation function calculates the agent total, reads the venue attribution separately, and later calls the allocation helper again to create individual agent earnings. An agent status, depth or attribution change between statements can make those results disagree.

The allocation helper is SQL STABLE, fingerprint `53d947a8e9c8708d0cf727a4e200a8fd`. PostgreSQL documents that STABLE functions use the calling statement's snapshot; separate statements inside a volatile function can observe different committed data. [PostgreSQL 17 function volatility documentation](https://www.postgresql.org/docs/17/xfunc-volatility.html).

An isolated reproduction uses the actual table definitions and an injected event trigger to suspend the direct agent after the total is calculated. The old function commits an agent total of 2,400 cents but only 900 cents of individual agent earnings. Other controlled cases cover reactivation, attribution replacement/expiry and founder depth changes. These are deterministic interleaving tests, not independent hosted-session concurrency tests. No such trigger or business operation was run in production. Read-only production aggregation at 16:48:06 UTC found two revenue events, zero agent earnings and zero mismatched totals or attribution IDs. No historical data correction is indicated by that check.

## Narrow implementation

Migration `20260910165000_snapshot_cashier_agent_allocations.sql` replaces only the confirmation function. One SELECT captures the total, ordered recipient rows and attribution ID using the same statement snapshot. Later inserts consume those captured rows. The attribution ID remains recorded even when no recipient qualifies; no attribution remains null. Existing 15% direct and sponsor rates, founder restrictions, rounding, dancer enrollment and 30/40/50% tiers, venue-local month, referral agreement, locks, duplicate checks and side effects remain unchanged.

No table, column, constraint, index, trigger, role, grant, RLS policy, provider setting or application caller changes. There is no recalculation, historical update, automatic provider transfer or data cleanup.

## Validation and limits

The metadata-only fixture rebuilds all sixteen affected tables with their 292 columns, 162 constraints, 66 indexes and 26 application triggers. Identity, payout-setting, history and notification dependencies are explicit synthetic projections. Browser policies were audited separately; this fixture keeps RLS enabled and tests the service-only RPC boundary. It does not claim a complete migration replay or full hosted authentication test. PostgreSQL runs locally through PGlite (PostgreSQL 18); production is PostgreSQL 17. The preserved function fingerprints are checked before applying the new migration in the fixture.

All 39 focused cases pass; ten fail against the old definition. Coverage includes changes between allocation reads, missing/inactive/future attribution, both founder-level rates, fee rounding/bounds, unenrolled dancers and all three enrolled monthly tiers, repeat token/customer rejection, inactive tag/account/venue/deal rejection, failed downstream inserts with full transaction rollback, denied anonymous/authenticated RPC execution, migration repeatability, preserved data and unchanged schema/function access.

Full-suite, lint, production build, standalone TypeScript, thirty read-only readiness checks, migration guard, guarded release rehearsal, exact commit/push/Vercel and production preservation/health gates are required before moving to another correction. Historical migration replay and hosted multi-session tests remain deferred.

## Safe delivery and recovery

The release wrapper rejects an unexpected function, helper definition/volatility, execution privilege or RLS state. It takes bounded locks with a three-second lock timeout and thirty-second statement timeout, verifies population bounds, captures all sixteen table fingerprints and schema/access metadata, and preserves every other public function and prior ledger entry. The exact committed migration source and its ledger entry are applied in the same transaction. Postflight must confirm the new fingerprint and unchanged records/metadata. Failure rolls back the definition and ledger together; no business RPC is invoked by deployment.

Restoring the fixture's inspected original function is possible without changing records, but reintroduces the allocation race. Prefer a reviewed forward correction. Any reversal must retain the audit ledger and assess newly created financial records rather than deleting or recalculating them. This correction does not close the remaining privileged-operation, trigger, lifecycle, recovery or end-to-end audit work.

Full validation passed all 6,030 tests, lint, production build, standalone TypeScript, thirty read-only readiness checks and the migration guard. Guarded transaction rehearsals passed repeat rejection, definition/grant/RLS drift rejection and rollback of injected record/access changes. The exact committed source has SHA-256 `718d6bd224c17d81f8c8e2a7881afa3ac53cf75fce040fb0999a10ac5f8805e5` and MD5 `78adb595d233d4d216e10432052aa90a`; the replacement function fingerprint is `21979c6d6db75319a656ec793cb7f51f`. Production commit/push, source application, Vercel and independent preservation/health verification remain required. No production financial mutation was used as a test.
