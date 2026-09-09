# Retained gallery source reconciliation

The maintenance command `npm run media:reconcile-gallery-sources` checks temporary copies left after a confirmed gallery approval. Its default is a dry run. It is not called by a page, API, cron job or deployment hook and does not add a background watcher.

## Scope and eligibility

An eligible record must have a consistent approved gallery decision, a completion and last update at least seven days old, and a still-approved photo belonging to the same verified profile and owner. Both the published photo and its archived original must exist with valid, nonempty, old storage metadata. Missing or uncertain replacements retain the recovery sources.

Only the exact server-generated upload name is accepted: `<user UUID>/<profile UUID>/<timestamp>-<upload UUID>.<image extension>`, optionally prefixed with `review-`. The command checks the original temporary path and its corresponding review copy. It never lists an entire bucket or infers a deletion target from an arbitrary prefix. Avatar, rejected, pending and uncertain-publication records are excluded. Unknown legacy filenames are retained.

Before selecting a copy, it checks all other moderation-record temporary paths, all moderation final paths, gallery paths and avatar paths for references, without restricting those reference checks to the selected owner or review status. The moderation temporary, moderation review and original-media buckets must still be private. Public photos, responsive derivatives and archived originals are never deletion targets. No SQL row or policy is changed.

This is a recovery operation for known completed approvals, not a general historical orphan purge. Unattributed public or archived files still need a durable provenance/retirement design before they can be deleted safely. An absent current reference alone does not establish that an in-flight publisher will not reference such a file later.

## Dry run and pagination

Run on a trusted maintenance host with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` supplied through the existing server environment. The command can load the repository's local environment using the same mechanism as other maintenance scripts. Never send server credentials to a browser, paste them into command arguments, or save them with reports.

```sh
npm run media:reconcile-gallery-sources
npm run media:reconcile-gallery-sources -- --limit=20
npm run media:reconcile-gallery-sources -- --after=<nextCursor UUID>
npm run media:reconcile-gallery-sources -- --record=<moderation record UUID>
```

The default page is five records and the hard maximum is twenty. A UUID cursor advances in primary-key order; it does not repeatedly revisit already-clean rows. A non-null `nextCursor` may lead to an empty final page. This is a bounded pass, not a transactionally frozen inventory of every historical record. Concurrent eligibility changes may require another pass. Each provider request has a ten-second deadline; there is no write retry.

Output includes record IDs, status, eligible-copy count/bytes, and an `expectedPlan` fingerprint when a copy is eligible. It omits account identity, storage paths, image contents, signed URLs and provider exception text. Keep reports in a private operational location because moderation-record IDs are internal identifiers.

## Applying one reviewed result

```sh
npm run media:reconcile-gallery-sources -- --apply --record=<moderation record UUID> --expected-plan=<SHA256 from its dry run>
```

Apply requires one explicit record and its dry-run fingerprint; there is no bulk apply option. Immediately before each individual object deletion, the command reloads the record, ownership, photo, references and object versions. It proceeds only if they match the reviewed plan, allowing only its own previously acknowledged removal. A new reference, modified object or changed decision stops further deletion. Sources use immutable server-generated names and terminal gallery decisions; this workflow does not claim an atomic transaction spanning PostgreSQL and object storage or safe coordination with arbitrary manual storage writers.

The command verifies the published file and archived original before removing either temporary copy. It does not change the approval record or clear its historical path. Repeating an already completed cleanup reports `already_clean` without deleting anything else. Existing upload, review and public media behavior is unchanged.

## Failure handling

- `eligible`: dry-run candidate; no mutation occurred.
- `already_clean`: neither temporary copy remains after all publication checks passed.
- `retained`: the command could not establish eligibility, or the reviewed state changed. The `reason` is a fixed diagnostic code.
- `cleaned`: both selected deletions were acknowledged, or the one remaining selected copy was acknowledged.
- `failed`: provider verification was unavailable or malformed. No later object deletion is attempted for that record.
- `removal_unconfirmed`: a deletion request failed or its response could not be validated. It may have committed. Stop and dry-run again; do not infer rollback or blindly retry.

`confirmedRemoved` counts only acknowledged deletions. If the first bucket succeeds and the second check fails, the report preserves that partial count and exits unsuccessfully. Apply also exits unsuccessfully for a missing, retained or changed record. A failed verification never authorizes deletion. Keep the report alongside the exact code revision used.

## Verification and rollback

Runtime tests exercise the real maintenance module with an in-memory provider that records every storage mutation. They cover preview-only operation, pagination, explicit plan matching, ownership and shared references, missing originals, malformed paths/metadata, changes between checks, partial cleanup, and failures before/after a deletion commits. A separate production dry run is executed with HTTP restricted to GET/HEAD; no real production media is deleted during release verification.

This release adds no migration, browser code, schedule or dependency. Rollback is to stop invoking the command or revert its files and npm entry. Already-deleted temporary copies are not restored by code rollback; their verified published photo and archived original remain. General public-file orphan reconciliation remains a separate follow-up.
