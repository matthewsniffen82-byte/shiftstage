# Step 4: atomic gallery publication foundation

## Issue and bounded rollout

Gallery moderation currently chooses a slot before uploading and later infers replacement from that slot. Two different uploads can select the same slot; a late approval can remove the photo that won earlier. Publishing a photo, recording approval and updating the profile also occur in separate database requests. The previous release prevents destructive failure compensation but does not make these writes atomic.

This release adds the database foundation only. It does not switch application callers, approve existing reviews, renumber media, remove storage objects or change public access. Rollout is deliberately staged:

1. Apply and verify this additive migration and service-only transaction.
2. In a separately tested and deployed change, record explicit upload intent and use the transaction for automatic, retried and administrator gallery approvals. Replacement must carry the selected photo ID. Keep avatar publication separate.
3. Review remaining writers before considering additional slot uniqueness constraints. Do not add an index that breaks the existing insert-before-delete replacement path.

The gallery race is not fixed in production until the callers use the transaction. Step 4 remains open.

## Production inspection

Read-only catalog checks at 2026-09-09T20:30:28Z and a legacy-state check at 20:33:48Z found four pending gallery reviews. All four have no linked photo or final storage path. Four existing non-primary photos have a zero-or-lower sort order; those rows remain intact. No library has reached fifty live photos. Browser roles lack INSERT/UPDATE/DELETE privileges on photo and moderation tables; service_role can read storage object metadata. The most recent applied migration is the previously verified upcoming-date guard, `20260909183820`.

The catalog also shows unnecessary TRUNCATE, REFERENCES and TRIGGER privileges for browser roles on several media/profile tables. RLS does not protect TRUNCATE, but no public HTTP route or exploit enabling this operation has been demonstrated. Review and remove unnecessary privileges in the dedicated Step 5 access audit; do not run production truncation tests or mix a broad grants change into this release.

## Migration and transaction

`20260909203842_add_atomic_gallery_publication.sql` adds `photo_publication_mode` and `replacement_photo_id` to moderation records. Existing rows receive `legacy` intent with no replacement target. The CHECK constraint permits only legacy/add without a target, or replace with a target. The expected replacement ID deliberately has no foreign key: deleting the target must leave a stale expectation that fails, rather than nulling it into permission to add or replace another photo.

`publish_approved_dancer_gallery_photo` is SECURITY INVOKER with an empty search_path. PUBLIC, anon and authenticated cannot execute it; only service_role is granted execution. It validates input shape/size, owner/reviewer state, gallery context, storage ownership and the existence of the uploaded object. Storage reads use the fully qualified storage.objects catalog; the function never uploads or deletes bytes.

Publication locks the owner's profile before the moderation record. It checks the expected moderation timestamp and decision, so a stale approval cannot overwrite another decision. It inserts the approved photo, updates the approval record and changes the profile's photo review state in one transaction. A lost-response retry returns the existing committed photo identity. A deleted or inconsistent result is rejected and never resurrected.

An addition chooses a free gallery slot while holding the profile lock and enforces the fifty-photo limit. Legacy reviews may add a photo but cannot implicitly replace one. Explicit replacement locks and removes only the recorded photo ID belonging to the same profile and media context. If it has changed or disappeared, publication fails. Existing zero-order photos are preserved. Older outstanding reviews linked to the exact replaced photo are withdrawn with their history retained. Existing foreign-key behavior for likes and moderation references is unchanged and participates in the same transaction.

The function returns superseded storage paths for cleanup after confirmed commit. A failed or uncertain call must retain potentially referenced files. No automatic write retry or storage garbage collector is introduced. Profile locking coordinates users of this function; it does not serialize legacy application writers until they are migrated.

## Validation and deployment safeguards

Eighteen embedded PostgreSQL tests execute the actual migration and function with synthetic users, profiles, reviews and storage metadata. They cover competing additions and replacements, lost-response identity, rollback of replacement/likes/review updates, legacy preservation, withdrawn reviews, missing/foreign/duplicate storage paths, limits, stale decisions, deleted results, primary-photo handling, paused owners, administrator checks, input constraints, browser execution denial and preservation of pre-existing review fields during migration.

PGlite queues statements in one PostgreSQL instance. These tests exercise the transaction and predicates, including queued competing requests; they are not a multi-connection Supabase load test, real Storage upload test or replay of the full historical migration chain. Historical replay remains deferred by the user.

Before production application, validate the entire delivery transaction with synthetic rows. Apply only the exact committed migration, using a three-second lock timeout and thirty-second statement timeout, and record only its own migration-ledger entry in the same transaction. Reject pre-existing target columns, function or ledger state instead of replaying blindly. Preserve before/after fingerprints of profiles, photos and original moderation fields, existing ledger rows, RLS, table grants and policies under bounded locks. Verify the function privileges and CHECK constraint before committing the database transaction. Do not invoke the new publisher against production records as a test.

Full tests, lint, build, standalone TypeScript, live readiness, exact pushed-commit Vercel success and post-deployment database/HTTP verification are required before the next controlled release.

Pre-release validation passed on `94eca43fdb3e4e8a6e8f79648b4e2cda03f11278`: all 3,088 tests (zero failures/skips), full lint, production build and standalone TypeScript. Postbuild skipped layout-review population. All thirty live readiness checks passed again. This preserves the independent original-photo retention fix and profile styling updates. The eighteen new database tests passed, and the complete bounded deployment transaction passed separately with synthetic existing rows and repeat-application rejection. Normalized migration SHA-256: `819e7b9651aacb26fa480416b1ec67c23f331feddfceb53e64b7584065e63301`. Production application and exact deployment evidence must be recorded after the release.

## Recovery

If a lock cannot be obtained promptly or any pre/postflight assertion fails, the entire transaction aborts. Inspect current schema and ledger before retrying an uncertain response. No cleanup, data rewrite or constraint removal is an acceptable workaround.

The current application remains compatible with the two defaulted metadata columns and unused function. If the foundation deployment needs to be paused, leave the additive schema in place and keep existing callers. Before any later rollback, verify caller deployment and dependencies. Prefer an additive correction or revoke function execution while affected callers are stopped; do not drop the new columns and lose recorded replacement intent. Once the caller release is live, reverting to legacy slot-based replacement would reintroduce the race and requires an explicit recovery decision.
