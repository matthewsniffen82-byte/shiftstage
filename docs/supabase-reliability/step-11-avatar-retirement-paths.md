# Step 11: canonical avatar retirement paths

## Previous release

Caller correction `9f6515ad1d6151007ed9c1b70e21fd0b789ccde3` passed all 5,633 tests, lint, build, standalone TypeScript and thirty readiness checks. It was pushed with matching main references and a successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/FdtE56NS6D3wrfnxTMi3Vy8AZSCu). Health and unauthorized owner/admin media rejection passed at 13:38:17–22 UTC on 2026-09-10. Read-only comparison preserved sixteen profiles, 72 photos, 43 moderation rows, 88 history rows, zero retirement markers, 22 venues, 452 storage objects, ten buckets, 154 public/storage policies, 130 functions and 112 ledger entries.

## Inspected issue and bounded plan

The actual avatar uploader writes `user UUID/profile UUID/avatar/generated-image-name`. The deployed retirement RPC and caller intentionally recognize only the gallery master directory, so they retain old avatar files even after their references leave. Read-only inspection at 13:39:27 UTC found all sixteen current avatars and eight moderation final paths use the avatar directory. No inspected current source has whitespace, leading-slash/URL, percent, parent-traversal or doubled-slash alias candidates. Other legacy/unrecognized paths stay retained.

Add one forward migration changing only the claim function's allowed master pattern to accept the exact optional `avatar/` directory. Verify the existing function fingerprint before replacement and preserve its owner, service-only execution, Read Committed restriction, history requirement, source reference checks, family locks, permanent receipts and all reference/history triggers. Update the caller receipt validator to accept the same exact directory. Do not change prior migrations, business rows, marker rows, policies, buckets, or the family-mapping function.

Existing application versions safely retain newly supported paths until updated; new callers also retain paths if the older database function is still installed. Deployment order therefore preserves backward compatibility. This is physical-cleanup path support, not a metadata deletion transaction or avatar-review lifecycle redesign.

## Verification and rollback

Native tests must reproduce old avatar retention, then confirm new avatar retirement and shared-reference protection for master/variants across all three sources. Verify late publishers are rejected, explicit retries reuse receipts, invalid/extra directories and unmatched history stay retained, legacy gallery behavior is unchanged, and ordinary roles remain denied. Run actual caller/path handling with synthetic storage, plus the full tests, lint, build and standalone TypeScript.

Rehearse a guarded committed-source deployment with exact prior-function checks, repeat/drift rejection and transactional preservation of source/history/marker data, all other functions, source access/schema/triggers and prior ledger entries. Do not create a production retirement or remove a file as a test. Commit/push, apply only that exact migration, verify privacy/preservation and exact deployment/health before continuing.

An application rollback may conservatively retain avatar files, but permanent receipts and reference guards must remain. Do not restore direct deletion, remove retirement markers, replay old migrations or restore deleted bytes into a retired path; use a new publication path if authorized restoration is required.

## Prepared evidence

All 32 native/gateway cases pass. The pre-migration test reproduces avatar retention and verifies an existing gallery receipt and every source/history row survive the new migration unchanged. Actual responsive/original path mapping is used with synthetic storage; no production file is touched.

The deployment wrapper passed normal application and repeat rejection, dependency/permission/trigger drift rejection, injected profile/marker corruption rollback and access-change rollback. It permits only the expected claim function body change, preserving function metadata/privileges, all other functions, source rows/schema/access/triggers, history, permanent markers and prior ledger entries. Full release validation and exact committed-source rollout remain required.

Full validation passed all 5,665 tests with zero failures or skipped tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks. Postbuild population was skipped. No production retirement, media mutation or schema application was performed during tests. Exact commit/push, committed-source application, privacy/preservation and deployment/health remain the release gates.
