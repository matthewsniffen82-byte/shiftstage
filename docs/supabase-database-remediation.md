# Supabase database remediation — Stage 4

## Release order and scope

1. Deploy the accompanying profile, shift, and support route changes first. Wait for the exact commit's Vercel success.
2. Apply `supabase/migrations/202609070001_supabase_access_boundaries.sql` to project `hfmzwadzabmgxkjzmqun` in a single transaction. This replaces overly broad permissions, preserves owner/public reads, and adds a verified-email mirror trigger. It does not modify existing rows. The new trigger only follows future committed Auth email changes; pending email changes are ignored.
3. Apply `supabase/migrations/202609070002_restore_recovery_and_saved_deal_schema.sql` in a single transaction. It adds the two missing tables, their constraints/indexes/RLS, and the service-only recovery limiter. It never deletes security history. The limiter separately locks IP and subject dimensions in stable order; a combined IP+subject lock would permit concurrent bypass across either dimension.
4. Verify the live catalog and anonymous REST boundary. Record application status and migration history explicitly. Never replay the entire historical migration directory: duplicate historical versions and existing history drift require a separate reconciliation.

Both files use bounded lock and statement timeouts. A lock timeout must be investigated and retried during a quieter window, not bypassed with a long blocking migration. Each transaction is atomic. Do not re-open the insecure grants as a rollback shortcut; resolve a failing server query using verified ownership and the correct server client.

Database application is **pending until the post-deployment verification record confirms it**. Vercel does not apply these SQL files automatically.

## Validation evidence

- The permission migration executed successfully against the production schema inside a transaction ending in `ROLLBACK`.
- Assertions confirmed anonymous/authenticated legal-name reads are denied, public stage-name access remains, the public view executes under invoker RLS, direct shift/deal/support mutations are denied, and private analytics are inaccessible to anonymous users.
- Anonymous private-profile exclusion and a sampled real dancer's owner access passed. No names, tokens, IDs, or private row contents were exported as test evidence.
- Cross-venue query assertions passed for an unaffiliated identity. No active venue-team account existed for a representative positive/negative team-membership test. Test two venues with an active member of only one in staging before declaring that scenario end-to-end verified. The live policy definitions now planned for replacement explicitly correlate each outer table's venue ID.
- The additive migration executed successfully with rollback. Synthetic hashed recovery events verified first-request acceptance, same-IP/different-subject rejection, and same-subject/different-IP rejection; all synthetic rows and new objects were rolled back. Anonymous saved-deal access and authenticated recovery-RPC execution were denied.
- Existing base tables all had RLS enabled in the live catalog. Admin-definer financial RPCs require an active administrator. Existing financial no-delete triggers and uniqueness protections are retained.
- New saved-deal bookmarks use a `(customer_id, club_deal_id)` primary key, preserving duplicate-save idempotency. Their foreign keys intentionally remove bookmarks when the account/deal is removed and clear an optional dancer attribution when its profile is removed. This migration itself removes no accounts, deals, profiles, or bookmarks.

## Operational items that remain explicit

- **Historical migration reconciliation:** compare the checked-in inventory against `supabase_migrations.schema_migrations`; do not rename duplicate versions or mark missing history applied based only on filenames. Confirm each object's actual definition. Only repair history after matching the applied SQL.
- **Public photo storage:** `dancer-photos` remains public. RLS and app visibility cannot revoke a previously copied public URL. Changing the bucket to private immediately would break existing image URLs. A separate compatible migration must first deploy an authorization-aware media route, switch clients/derivatives, verify caches and profiles, then change bucket privacy and retire old URLs. Private identity/moderation/original/video buckets remain private.
- **Existing NOT VALID checks:** `mydancr_tv_duration_check` and `club_deals_liquor_free_check` were unvalidated. Inspect legacy exceptions without exporting private data, resolve them through the existing moderation/business workflow, then run `VALIDATE CONSTRAINT` with a bounded lock timeout. Do not delete historical rows to force validation.
- **Email mirror:** verify a disposable staging user's confirmed email change updates `app_users.email`; check both old/new-address confirmation and failure recovery. Existing production users are not backfilled or emailed by this release.
- **Telemetry retention:** the repaired recovery function deliberately does not purge data. Define and authorize a retention process separately; do not revive the historical per-request DELETE implementation.
- **Cross-device email and delivery:** the staging/manual matrix in `supabase-remediation-record.md` remains outstanding. Repository tests cannot prove inbox delivery, email-scanner behavior, or backup restoration.
