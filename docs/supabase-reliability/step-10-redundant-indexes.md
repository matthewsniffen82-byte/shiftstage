# Step 10: remove two confirmed duplicate indexes

The metric caller was pushed as `b35a7b15bd42117571d7bc9bafbf3544736d7413`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/FpJmqYFqAufwQdC6aWQdXSiBhtgP) succeeded. Matching main references, production health, authorization checks and thirty readiness checks passed at 11:22:18–20 UTC on 2026-09-10.

## Inspection and impact

Read-only catalog inspection at 11:23:25 UTC confirmed that `venues_owner_user_id_idx` and `club_invoice_items_revenue_idx` are ordinary nonunique btree indexes. Neither supports a constraint, replica identity, clustering or a dependent object. Their respective unique constraint indexes, `venues_owner_user_id_key` and `club_invoice_items_revenue_event_once_key`, have identical columns, operator classes, collation, order and predicates. All four are valid, ready and live. No application caller names either redundant index.

The tables have 22 venues and two invoice items. Each redundant index occupies 16 KiB. Removing them saves duplicate maintenance on future writes; it is not a claim of a measurable current latency improvement. Preserve both unique constraints, all rows and all other indexes.

## Controlled plan

Use one explicit transaction with a three-second lock timeout and twenty-second statement timeout. Lock the two small tables in a fixed order, verify both complete index pairs before removing anything, and use `DROP INDEX ... RESTRICT`. Refuse altered definitions, unsafe dependency/identity states or missing/invalid covering uniqueness. A repeat is harmless only when each covering constraint still satisfies the guard.

[PostgreSQL 17 documents](https://www.postgresql.org/docs/17/sql-dropindex.html) that ordinary index removal takes an exclusive table lock; concurrent removal cannot run inside the preservation transaction. Bound lock acquisition, keep this transaction small and abort on contention. Never retry indefinitely or use CASCADE.

Execute native tests for exact preservation, uniqueness, selective access plans, repeat application, drift rejection and rollback. The local fixture is an explicit index-focused projection of the two tables with the four captured index definitions; it is not a reconstruction of the complete production schema. Production guards separately compare rows, permissions, columns, constraints, triggers, retained indexes, functions and earlier migration entries within the transaction.

Run the full suite, lint, production build, standalone TypeScript, migration guard and read-only readiness. Commit/push this step, rehearse the exact committed SQL, apply only that migration, confirm preserved data/access and retained query plans, then verify exact Vercel/health before the next audit step.

## Rollback

Any failed guard or lock timeout rolls back both removals and the ledger entry. If a later rollback is necessary, add a new migration recreating `CREATE INDEX venues_owner_user_id_idx ON public.venues USING btree (owner_user_id)` and `CREATE INDEX club_invoice_items_revenue_idx ON public.club_invoice_items USING btree (revenue_event_id)`, with the same short lock limits. Do not alter the applied migration or remove either unique constraint.

## Verification

All 22 native checks pass. They preserve rows/access/catalog definitions, enforce owner/revenue uniqueness and a dependent foreign key, allow safe repeats, reject twelve drift conditions, deny browser-role migration attempts and restore both indexes after an injected failure. Selective queries on 10,000 synthetic rows use the retained unique indexes without forcing planner settings. Two test-harness errors (JavaScript dollar-delimiter replacement and the local PostgreSQL 18 RESTRICT error code) were corrected before the passing run; production SQL was not relaxed.

The guarded deployment rehearses transaction success, repeat-ledger rejection, preflight drift rejection and full rollback when postflight detects an injected row change. Migration SHA-256 is `fd02610ce5a3fe47a1e7f6135d51d10a23425ea6ef328c002e46eca15d7de089`; normalized source MD5 is `727731836ef9eb42b1aa72f03a040caf`. No production index has been removed at this preparation stage. Full validation and committed deployment gates remain required.

Full validation passed all 5,342 automated tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks. Postbuild skipped population. Only exact committed-source application, transactional preservation, read-only index/plan verification, matching main references and Vercel/health gates remain before this performance step closes.
