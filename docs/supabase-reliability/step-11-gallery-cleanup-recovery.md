# Step 11: explicit recovery for retired gallery storage

## Previous release

Avatar-path correction `19cda43a81b8e676a4646f9c069f431bdbbcc405` passed all 5,665 tests, lint, build, standalone TypeScript and thirty readiness checks. The exact committed migration `20260910134200` applied through its preservation wrapper, changing only the intended function body. Source data, history, zero existing retirement markers, access, 53 constraints, twenty indexes, 81 triggers, 129 other functions, 154 policies and 112 earlier ledger entries were preserved. Read-only checks at 13:51:03–07 UTC confirmed permissions, function identity and all 452 storage objects.

Main references matched and the [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/5QxrEeZPJVvMtTw3HdgwAoxkcB8f) succeeded. Health, unauthorized owner/admin media rejection and thirty readiness checks passed at 13:52:18–23 UTC. No production retirement or media operation was used as a test.

## Inspected gap and bounded plan

After metadata deletion, partial/uncertain storage cleanup retains a permanent database retirement receipt. Retrying the original deleted photo ID may return not found, so the application needs an explicit recovery path for that receipt. Add an active-admin-only endpoint accepting one retirement UUID. Look up the stored profile/path by that UUID; never accept a caller-provided storage path. Reuse the actual guarded cleanup code and require the returned claim UUID to match the requested permanent receipt before removing bytes.

Return success only after both storage phases acknowledge cleanup. A missing marker is not found; uncertain lookup/claim/storage fails without reporting success. Shared or unrecognized paths remain retained and report a conflict. Keep the marker after success or failure, so repeat requests are safe and future publication cannot reuse the retired path.

This is an explicit operational retry, not a recurring sweep, bulk deletion, or authorization to remove unproven orphan files. Do not add a paid service, background watcher, cron, or production deletion test. Existing private review/temp cleanup and source-record lifecycle remain separate work.

## Operator procedure

1. Inspect a known retirement record using authorized read-only access to `public.gallery_storage_retirements`. Use its `retirement_id`; do not infer authorization from a storage listing or absence of a current profile.
2. With an active MyDancr admin session, call `POST /api/admin/gallery-retirements/{retirementId}/retry`. No request body or storage path is needed. Preserve any refreshed session returned by the standard admin authentication flow.
3. `cleanup: "confirmed"` means both deletion responses were acknowledged; already absent files are valid on retry. It is not a guarantee of immediate public-CDN cache eviction.
4. A 409 retains the file for reference/path review. A 503 leaves the permanent marker intact and may be retried explicitly after the temporary failure is resolved. Never delete a retirement marker, bypass the RPC, republish to that path, or use a service key in a browser.

Run actual endpoint authorization and native receipt/storage failure tests, then complete full validation, exact-file commit/push, Vercel success and read-only production health/preservation. A rollback can remove this optional endpoint without changing markers or storage state; keep the underlying guards.

## Prepared evidence

All 31 actual-endpoint/native cases pass. The test runs the existing `requireAdmin` function against synthetic account rows and the deployed avatar-capable retirement functions against their reconstructed schema. It verifies authorization before service-client construction, missing and malformed lookup/claim results, foreign retirement IDs, retained-reference conflicts, partial/lost storage receipts, repeated cleanup and preservation of the standard refreshed session. Error responses contain no storage paths or raw provider diagnostics.

Storage transport and authentication-session acquisition are simulated; this is not a hosted account/session test. A native fault-injection case temporarily disables only its in-memory reference trigger to model unauthorized manual corruption, restores the trigger, and proves the RPC still refuses deletion. No production trigger, policy, file, retirement or user record is changed by these tests.

Full validation passed all 5,703 tests with zero failures or skipped tests, including the existing route-inventory checks for the new endpoint. Lint, production build, standalone TypeScript, migration guard and thirty readiness checks passed; postbuild population was skipped. No database migration or production mutation is part of this correction. Exact-file commit/push, matching main references, Vercel success and production preservation/health remain required.
