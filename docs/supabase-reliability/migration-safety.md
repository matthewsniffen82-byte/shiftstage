# Verified application schema baseline

The application now has an isolated replay path: `supabase/baselines/20260914040900_application.sql`. It captures the production application schema at commit `6c4015005f6571b4159384adc781996cbf9dd1aa`, through migration `20260914040900`. The 182 covered historical files stay unchanged. Their four version collisions remain quarantined; do not run the original migration directory against a fresh database or repair the production ledger to conceal those collisions.

## Evidence and scope

Two independent native PostgreSQL 17 rehearsals on the designated recovery project `cwpsrrjhrkedwtyatntv` recreated the application objects and matched the production catalog fingerprint. Each ran in a transaction that rolled back; original recovery catalog and migration-ledger fingerprints matched afterward. The receipts and their hashes are checked in beside the baseline. These were fresh application-schema reconstructions within an existing Supabase project, not two newly provisioned platform instances.

The comparison covers 84 tables, two views, 149 functions, 155 application/Storage policies, 70 triggers, constraints, indexes, identity sequences, enum labels, RLS flags, grants, default privileges and ten Storage bucket configurations. It ignores object IDs and capture timestamps, normalizes one PostgreSQL check-expression serialization difference, and compares effective Storage privileges without duplicate grants from different managed-service grantors. Auth/Storage platform objects, roles, owner privileges and the recorded PG17 extensions are prerequisites. They are not replaced by this baseline.

This is schema recovery, not a data backup. Application rows, Auth users, Storage objects/media, secrets and historical seed-data effects are not restored or certified. Historical data ambiguity must still be handled through a reviewed, additive repair. No production reset or bulk ledger repair was performed.

## Prepare a fresh replay

Run `node scripts/prepare-schema-replay.mjs <new-output-directory>`. The command requires a nonexistent destination and produces an isolated `supabase/migrations` directory containing the baseline followed by only migrations after its cutoff, plus a replay plan. It does not connect to a database. Initialize Supabase configuration in that new directory and select a fresh disposable Supabase project with the required platform services/extensions before applying it. Never link the generated replay workspace to production.

The baseline itself refuses any existing application tables/views. It creates the current schema directly rather than rerunning obsolete historical data updates. Future migrations remain separate forward steps, and the guard reports that they require their own validation.

## Build guard and future changes

`npm run db:check-migrations` checks frozen historical hashes and unique, valid UTC timestamps for later files. It also verifies the baseline, covered SQL, catalog query, normalizer, rehearsal runner and both receipts. Editing those inputs invalidates the proof. A successful baseline check never executes SQL or changes a remote ledger.

`historicalReplayReady` remains false. `baselineReplayReady` identifies the verified alternative. `replayReady` is true only when history checks pass and no unvalidated forward files remain. Do not regenerate proof hashes merely to hide a failure; changed baseline inputs require another catalog comparison and two successful rehearsals.

`node scripts/rehearse-schema-baseline.mjs cwpsrrjhrkedwtyatntv <new-receipt.json>` is restricted to the designated recovery project and always uses rollback. It uses the installed Supabase CLI (`SUPABASE_CLI_PATH` can select the binary; validation used 2.117.0). Coordinate one database deployer at a time. Recovery rehearsals temporarily hold DDL locks and should run without other recovery migrations.

For production releases, use new additive migrations, explicit timeouts, focused database/role tests and verified postconditions. Preserve historical files and apply only the reviewed new migration. Commit, push, and verify the exact application's Vercel deployment. Vercel does not apply SQL. Validation is proportionate to the change under AGENTS.md.
