# Durable gallery reference history

The `20260910092022_add_gallery_reference_history.sql` migration records committed gallery and avatar reference changes in a private database journal. A lost HTTP response no longer loses the evidence that a gallery replacement released an old path. The journal is a foundation for recovery; it does not authorize storage deletion.

## Recorded behavior

`gallery_media_reference_history` stores the source kind, source row ID, profile ID, exact storage path, event kind, transaction ID and observation time. A `baseline` event captures each existing nonempty gallery/avatar reference at migration time. That timestamp is not the original publication time.

Restricted `AFTER ROW` triggers record `referenced` and `released` events for inserts, deletes and changes to reference identities or paths. A replacement records both sides in the same transaction. Unchanged paths and unrelated fields do not create events. Both approved and unapproved gallery rows are references. Shared paths remain separate source references; releasing one does not imply that all references were removed.

History has no source foreign keys, so photo/profile deletion and cascading deletion retain the observations. No account contact details, image contents or authentication tokens are copied. The new table has RLS enabled and no browser policies. Anonymous and authenticated roles receive no table, sequence or function privileges. The service role can read the journal but cannot directly insert, alter, erase or truncate it. The pinned-search-path definer function only accepts row events from the two exact source relations and is not directly executable by API roles.

Source mutations and history commit or roll back together. A journal insert failure fails the source mutation, avoiding an unrecorded successful change. This adds one small append for insert/removal and two for a changed reference, plus the primary-key and profile-history index updates. History reads can be bounded by profile and event ID. The application has no new network request, client bundle, worker or scheduled cleanup.

## Migration and deployment

Run the complete automated suite, full lint, standalone TypeScript and production build before release. Apply only the exact committed new migration through the existing controlled Supabase workflow; never replay historical migrations or use a blanket database push. Coordinate using the existing `mydancr:database-release` transaction advisory lock and confirm the new version, table, function and trigger names are absent before applying.

The migration uses a three-second lock timeout and a thirty-second statement timeout. It briefly locks the source tables against concurrent writes while installing triggers and seeding the current baseline. Reads remain available. The production preflight found 72 gallery rows and 16 nonempty avatar references, with both source tables retaining RLS. Recheck the current size before applying; abort rather than unexpectedly backfilling a much larger population.

The deployment wrapper must compare source-row and existing-security fingerprints before/after inside the transaction, verify the journal grants/RLS/function/trigger configuration and baseline, and record the exact SQL in the migration ledger in that same transaction. After an uncertain response, inspect the version, SQL digest and catalog before deciding whether any retry is needed. Do not blindly rerun this migration.

If deployment fails, the transaction rolls back the table, triggers and baseline together. An operational rollback after success should disable/remove the two new triggers through a separately reviewed change while retaining the private history table and its data. Do not erase the journal to undo the rollout. The existing upload/delete callers are compatible before and after this migration.

## Limits and next recovery work

This journal records database references observed from rollout onward. It cannot reconstruct previously lost references, uploads that never gained a database reference, or all unfinished storage attempts. It does not track storage deletion acknowledgments. The reference inventory remains read-only and does not automatically consume `released` events as deletion candidates.

Storage writers still need durable attempt registration and a coordinated retirement state that prevents a publisher from attaching a retiring path. Avatar/gallery sharing, moderation history and any other consumers must be checked before cleanup. Private originals and responsive variants remain linked operationally to their public master, not individually retired by this journal.

Trusted database-owner operations that disable triggers, truncate source tables, restore snapshots or directly manipulate storage are outside this row-trigger history. Such maintenance must preserve/reconcile the journal explicitly. Event IDs can have gaps and concurrent transactions can commit out of allocation order; the IDs and timestamps are observations, not a global commit-order cursor or proof of deletion safety.

## Verification

Native PostgreSQL tests exercise baseline preservation, insert/replacement/removal, shared paths, profile moves, cascade deletion, rollback, injected journal failure, browser isolation, restricted service writes, foreign-trigger rejection and indexed/private catalog configuration. The actual gallery publication RPC suite runs with the new triggers and verifies lost-response replay, replacement races and rollback history. These local tests do not establish independent hosted multi-connection concurrency or authorize production test deletions.
