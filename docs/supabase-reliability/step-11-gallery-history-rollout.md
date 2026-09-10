# Step 11: roll out committed gallery reference history

The video-removal correction was pushed as `8739f5d96963d447cc365894441234595b330d30`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/HmbfkQygiaP91NceUL3cEYPU4fzE) succeeded. Matching main references, health, protected-route checks and thirty readiness checks passed at 11:52:22–25 UTC on 2026-09-10.

## Exact scope

Apply the existing committed migration `20260910092022_add_gallery_reference_history.sql`, preserving its source unchanged. It was delivered in independent commit `bfe54fcc2c4f0e17c6ec337cfa2ab634dbe6a547`, but read-only inspection confirms it has not been applied to production. This is a controlled application of that specific missing version after later independent releases, not historical replay or blanket ledger repair.

The migration adds a private reference journal, one restricted trigger function and two source triggers, and captures the current reference baseline. It changes no existing source rows, storage bytes or caller behavior. See `gallery-reference-history.md` for the event model, permissions, retention and limitations. Its history is evidence for recovery; a released path alone never authorizes deletion.

Fresh preflight at 11:54:58 UTC found sixteen profiles, 72 gallery rows and sixteen nonempty avatars. The complete inspected photo/profile columns, constraints and trigger definitions match the native fixture. The new table, identity sequence, function, trigger names and ledger entry are absent.

## Release plan

Rehearse the exact committed SQL against the complete source-table fixture, alongside the existing history and gallery-publication regression suites. Use the shared release advisory lock, lock the ledger and briefly hold source writes. Abort after three seconds of lock contention; cap execution at thirty seconds. Abort if source counts exceed 200 profiles or 500 photos, or if source definitions/target absence have changed.

Within one transaction, compare source-row fingerprints, existing columns, constraints, indexes, triggers, permissions, policies, functions and prior ledger entries before/after. Validate all baseline references without returning their private paths. Confirm journal RLS, zero browser policies, service-only SELECT, revoked direct writes/sequence access, the fixed definer function and its two enabled triggers. Record the exact committed SQL in the ledger in the same transaction.

Run all automated tests, lint, production build, standalone TypeScript, migration guard and read-only readiness. Commit/push only this rollout documentation/check coverage, then apply the exact already-committed migration through the rehearsed wrapper. Verify database preservation and journal privacy, the exact pushed Vercel deployment and production health before continuing storage work.

If application fails, the transaction rolls back the new objects, baseline and ledger together. After an uncertain response, inspect the version/source digest and catalog before considering a retry. A later operational rollback must preserve the private journal and use a separate reviewed migration to remove the two capture triggers. Do not erase history or alter the original migration.

## Rehearsal results

The exact committed migration has normalized SHA-256 `1659161135a42e7d857a103175687feb8b47799c79a7c0e8d79d003d71e6e7b6` and source MD5 `4dadec68c5b2f903dc4351adc7088b36`; expected function MD5 is `a7d1c2f8c56b50b97835f34db25e3b97`. Native deployment rehearsals pass success, repeat-target rejection, source-schema drift rejection, row-preservation rollback, missing-baseline rollback and browser-grant rollback. Existing history/publication regression passes all 53 cases.

No migration source was edited, and no production history or source row has changed in preparation. Full validation, rollout commit/push, application of this one exact committed SQL file, read-only privacy/baseline verification and Vercel/health gates remain required.

Full validation passed all 5,393 automated tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks. Postbuild skipped population. The remaining release gates are the rollout commit/push, another exact committed-source rehearsal, guarded application, database/API privacy and baseline verification, matching main references and exact Vercel/health success.
