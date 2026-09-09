# Migration consistency and safe release procedure

## Step 2 status

The application now checks migration history before every production build. The guard is filesystem-only: it needs no credentials, never connects to Supabase, never runs SQL, and never changes migration tracking. A successful check means the frozen history is intact and new filenames pass the guard. **It does not certify clean replay or production schema consistency.**

The read-only audit used Supabase CLI **2.117.0**. Use an explicit version such as `npx --yes supabase@2.117.0` for reproducible audit commands; review later CLI upgrades separately. The build guard itself uses only Node standard libraries and does not install or invoke the CLI.

Full historical reconciliation remains blocked on an explicitly designated disposable Supabase environment. The production project has no preview branches. No Docker/Postgres runtime or approved non-production project has been established for this audit. Do not substitute a production reset, create a paid branch, or assume an unrelated project is disposable.

## Exact issue being addressed

The audited repository contains 128 migration files with 123 versions. Four version groups contain multiple files. Supabase's live ledger has 86 entries, and 39 repository files have no recorded version. Current objects already show that some unrecorded SQL took effect. Replaying every apparently missing version could overwrite current functions/policies, repeat data updates, or fail partway through an inconsistent historical sequence.

Historical file names and normalized SHA-256 hashes are frozen in `supabase/migration-history-baseline.json`, derived from the Step 1 metadata/source audit. The four existing duplicate groups are disclosed as known exceptions, not silently renumbered or repaired. The complete file/ledger comparison remains in `step-01-inventory.json`.

Direct inspection confirms that the ledger gaps cannot safely be treated as pending work:

| Unrecorded historical file | SQL it would attempt to run again |
| --- | --- |
| `202607270002_mydancr_tv_ten_second_limit.sql` | Hide videos longer than ten seconds and reinstate a ten-second constraint/policy, superseded by today's thirty-second model |
| `202608090001_restore_public_dancer_media.sql` | Promote matching pending dancer profiles to approved/public and rebuild older visibility policies/views; its view also references the retired biography column |
| `202608080003_remove_verifymycontent_integration.sql` | Drop the old verification table with CASCADE and drop identity columns |
| `202607110001_seed_las_vegas_venues.sql` | Upsert venue names, addresses and coordinates and force matching venues active, potentially overwriting later venue edits |

These files were read, not executed. No affected-row estimate is asserted here and no data-changing replay is authorized by the guard. Exact impact counts and dependencies must be captured for any proposed targeted repair. A transaction that now errors on obsolete schema is still not a reliable migration plan.

## Guard behavior

Run `npm run db:check-migrations`. `npm run build` also runs it first and stops if it fails.

The check rejects:

- Missing, renamed, or content-edited historical SQL. CRLF/LF conversion is normalized.
- A new file reusing any existing version, including joining a historical duplicate group.
- New files without a valid 14-digit UTC `YYYYMMDDHHMMSS` timestamp and lowercase descriptive name.
- New versions that sort before or into the frozen historical sequence.
- Empty SQL files, non-regular SQL files, unsafe baseline paths, and missing/malformed baseline metadata.

It reports `replayReady: false` while historical reconciliation is outstanding. It is not a SQL parser, privilege verifier, schema-diff engine, or replacement for database tests. A comment-only migration can still be syntactically nonempty; reviewers must inspect the actual SQL and test it on the disposable database. The baseline protects the audited history; later applied migrations must be added to the reviewed history manifest after their SQL and deployed effects are verified. Never regenerate the manifest merely to make an unexpected failure pass.

## Production impact and rollback

This step changes a build gate and documentation only. It adds no migration, table, constraint, index, policy, trigger, or data update. Existing application behavior and production database permissions are unchanged. A failing guard prevents the next application build; the currently deployed application remains available.

If a new migration is incorrect, fix that new file before application, or add a forward correction if already applied. Restore an accidentally edited historical file from Git. Rolling back the guard itself is an ordinary application-code revert followed by the full release checks; no database rollback is needed for this step.

## Required reconciliation before schema application

1. Select an explicitly disposable Supabase project and verify its project reference against production before any write. Pin the CLI version and capture a schema-only snapshot and migration ledger; keep credentials and any private records outside Git.
2. Compare each unrecorded or collided historical file with current objects **and later migrations**. A current function fingerprint cannot prove that every earlier data update ran. Classify each as represented, superseded, missing, or ambiguous, with evidence. Do not infer completion from a file name or a single existing table.
3. Preserve the original history. Develop a deterministic replay/baseline strategy in the disposable project, with explicit dependency ordering and an object-by-object comparison to the required schema. Never blindly rename old versions or generate a replacement production schema.
4. Run the full database/RLS/auth/storage tests there. Check schema replay twice on fresh disposable instances, including failure cases and upgrade from the prior release. A production reset is never a substitute.
5. For ambiguous historical data effects, use read-only aggregate preflights and a reviewed additive repair. Document affected rows, dependencies, recovery source, rollback/forward-fix path, expected locks, and timeout behavior. Stop a destructive action if recovery is unproven.
6. Only after effects are proven, consider narrowly scoped migration-ledger reconciliation. `migration repair` changes tracking only; it does not execute or undo the original SQL. Review the exact versions and record before/after evidence. Never mark all missing files applied as a batch shortcut.

## Every future schema release

Use one database deployer at a time. Fetch current `origin/main` and read the live ledger again before choosing a timestamp. Use a new 14-digit UTC timestamp and a descriptive name; retain historical files unchanged. Prefer additive changes, bounded locks, explicit transactions when supported, `NOT VALID` plus separate validation when appropriate, and a documented recovery path. `IF EXISTS`/`IF NOT EXISTS` does not prove an existing object's definition is correct.

Run the guard and complete automated suite, TypeScript, lint and production build. Test the migration and role boundaries in the disposable environment. Commit and push the reviewed step. During its deployment phase, apply only that committed migration to the explicitly selected production project, verify its postconditions, and record its ledger entry and immutable SQL hash. Because Vercel starts application deployment on push, additive database changes and application consumers must remain compatible during rollout; separate dependent releases when necessary. Vercel does not run SQL migrations. Verify the exact commit's deployment and health before proceeding to the next hardening step. Missing database evidence keeps that step open.

## Validation coverage

Regression tests exercise actual temporary migration directories: historical edit/rename, Windows newlines, valid new migrations, old and new version collisions, invalid calendar dates, backdating, empty files, missing metadata and unsafe paths. No production tables or accounts are created to test the guard.
