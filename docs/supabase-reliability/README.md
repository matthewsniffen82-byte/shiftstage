# Supabase reliability audit — 9 September 2026

## Status and scope

**Step 1: architecture audit. Initial classification: NEEDS WORK.** This is a baseline, not a claim that all 24 requested hardening steps are complete. No application rows, schema, authentication settings, storage objects, or access policies were changed during this step.

Production metadata was captured at **2026-09-09 09:08:49 UTC**, using an explicitly selected project and a repeatable-read, read-only transaction. The source baseline is `6ef753e2a654d52a8621eed508d30072311b4a40`. The isolated checkout preserves unrelated work in the primary checkout.

The [complete inventory](step-01-inventory.json) contains every captured column, primary/foreign/check/unique constraint, index, enum, policy, relation grant, function signature/execution grant/fingerprint, trigger, view definition, bucket configuration, migration version, literal table/RPC consumer, auth call, and environment-variable name. It includes Supabase-managed `auth` and `storage` metadata as well as application-owned `public` objects. It contains no application records, object contents, passwords, API keys, or tokens. Function bodies are fingerprinted rather than copied into the report.

The [capture SQL](catalog-read-only.sql) imposes a 30-second statement timeout and two-second lock timeout. The [offline inventory generator](../../scripts/audit-supabase-architecture.mjs) accepts only a read-only metadata capture and performs no network requests. Re-run from the repository root with `node scripts/audit-supabase-architecture.mjs <private-catalog.json> <report.json>`.

## Verified architecture

| Area | Current evidence |
| --- | --- |
| Database | PostgreSQL 17.6; 81 public relations; every public base table has a primary key and RLS enabled |
| Full captured schemas | 112 relations, 1,346 columns, 664 constraints, 377 indexes, 144 RLS policies, 133 functions, 58 triggers, 18 enums, two views |
| Public schema | 1,035 columns and 112 functions; no invalid or unready captured indexes |
| Migrations | 128 files, 123 distinct local versions, 86 live ledger entries; four duplicate-version groups; 39 files have no recorded live version |
| Storage | Ten buckets; four public and six private; configured file size and MIME restrictions |
| Edge Functions | CLI returned an empty deployed-function list |
| Realtime | No tables in the `supabase_realtime` publication; no application `.channel()`/`postgres_changes` subscriptions found |
| Jobs | Five Vercel HTTP crons: image moderation, video moderation, DMCA restoration, shift check-ins, finance |
| Deployment | GitHub `origin/main` to Vercel. Application deployment does not apply database migrations |

The inventory is a point-in-time snapshot. Two new live ledger entries initially preceded their source files; fetching current `main` reconciled both (`202609090002` and `202609090003`). There are now **zero live-only versions against this baseline**. Concurrent deployments must be checked before interpreting differences as unexplained drift.

## Application dependencies

| Functionality | Principal database dependencies |
| --- | --- |
| Identity and sessions | Supabase Auth, `app_users`, `customer_profiles`, `dancer_profiles`; account provisioning and Auth email-mirror functions |
| Recovery | `account_recovery_events`, `request_rate_limit_buckets`, `content_reports`; Auth recovery API, callback, account update API, Resend notifications |
| Public dancer discovery | `dancer_profiles`, `public_dancer_profiles`, `dancer_profile_slug_aliases`, `social_links`, `dancer_photos`, `mydancr_tv_videos`, `venues`, `club_deals`, `trending_scores` |
| Approval and onboarding | `approval_reviews`, `dancer_nfc_enrollments`, `nfc_tags`, `nfc_tap_events`, `venue_dancer_verification_tokens`, `venue_dancer_affiliations`, `venue_dancer_affiliation_events` |
| Working Now and upcoming dates | `shifts`, `shift_location_events`, affiliations, NFC functions; six-hour sessions and cooldowns; optional upcoming dates |
| Media and moderation | `dancer_photos`, `image_moderation_records`, `mydancr_tv_videos`, storage buckets; upload/finalize/delete routes, moderation crons |
| Customer activity | `favorites`, `follows`, `venue_follows`, `going_signals`, `media_likes`, `customer_deal_saves`, `notifications` |
| Analytics | `profile_views`, `schedule_views`, `direction_requests`, `social_clicks`, `mydancr_tv_events`, `venue_page_events`, `ranking_events`, `trending_scores`, `dancer_monthly_impact` |
| Venue operations | `venues`, `venue_signup_requests`, `venue_ownership_claims`, `venue_claim_codes`, `venue_team_members`, `venue_team_invitations`, `venue_activity_log`, `venue_nfc_support_requests`, `venue_pilot_night_reports` |
| Deals and settlement | `club_deals`, `venue_club_deal_requests`, `qr_redemptions`, `qr_redemption_events`, `deal_revenue_events`, `commission_events`, `club_finance_accounts`, invoices/items/reminders |
| Earnings and payouts | `dancer_earning_status_history`, `dancer_payout_accounts`, batches/items, `payout_settings`, `financial_audit_events`, payment-provider webhook events, NATS affiliate/export tables |
| Sales attribution | `sales_agents`, `agent_commission_events`, `venue_sales_attributions`, `venue_referral_fee_terms`, `venue_referral_fee_change_requests` |
| Support and administration | `support_threads`, `support_messages`, `support_ai_runs`, `admin_actions`, reports, `dmca_cases`, counters/strikes/settings |
| Billing | `subscriptions`, provider webhook records, finance tables; privileged server routes |

The JSON maps every public relation to direct source references and foreign-key targets. A table without a literal `.from()` consumer is **not proven orphaned**: ten such relations include RPC-owned rate limits, invoice/payout items, shift events, histories, and views. Dynamic names and SQL dependencies require the relevant later-step review. No table or column is proposed for deletion based on textual usage alone.

## Clients, authentication, and privilege boundaries

- `src/lib/supabase/admin.ts` is server-only, uses the service-role credential, and disables persistent sessions, automatic refresh, and URL-session detection.
- `src/lib/supabase/server.ts` provides anonymous server reads. Request-scoped authentication validates bearer/refresh input and uses `getUser()` before authorizing a request.
- `src/lib/supabase/client.ts` is a singleton anonymous browser upload transport with session persistence/refresh disabled. Application session state lives in the existing browser-session layer; there is no second independent upload login.
- `src/lib/supabase/bounded-fetch.ts` bounds response headers **and bodies** (15 seconds, 120 seconds for storage), does not replay mutations, and converts uncertain Auth delivery into a non-retried unavailable response.
- `/api/auth` handles signup/login/logout/recovery with neutral recovery responses and rate limits. `/auth/callback` handles code/OTP/fragment compatibility; `/api/account` handles password/email/account changes. The source reference map includes every other Auth caller.
- Main signup and callback paths use `provision_app_account_safely`. Its compatibility fallback preserves existing dancer approval and checks account role, but retains multiple writes and a slug-allocation loop. Separate exported `signUpCustomer`/`signUpDancer` helpers in `auth.ts` have no application callers found and still implement older provisioning. Step 7 must eliminate or safely align this duplicate implementation after dependency review.
- Password-update code distinguishes an actual password change from a later session-revocation or alert failure. Existing tests cover this distinction and stale-session responses; real mailbox delivery, one-time-link use, refresh, and recovery after a network interruption still require designated test accounts.

Three enabled Auth triggers are present: `on_auth_user_created` calls `handle_new_auth_user()` after user insertion; `sync_verified_auth_email` mirrors a changed Auth email; and `venue_request_email_confirmed` runs when confirmation becomes available. They are part of the signup/recovery dependency chain, so later trigger testing must include failure propagation and role preservation. All 58 captured triggers include their event, table and target function in the inventory.

Environment references include public URL/anon credentials and server-only service-role, recovery, moderation, payment, notification, cron, and deployment settings. The inventory records **names only**. A local public-only build file was used; service-role credentials were supplied only to the existing read-only readiness script. Development/preview target separation has not yet been certified.

A fresh CLI configuration comparison was run with `--dry-run` using a separate temporary local config. It reported `wrote: false`. The live site URL is `https://www.mydancr.com`, with exactly one additional redirect, `https://www.mydancr.com/auth/callback`. Email confirmations are enabled; SMTP is enabled at `smtp.resend.com:465`; the email minimum interval is one minute and the send-rate setting is 30. TOTP enrollment/verification are enabled. Session inactivity is 720 hours and timebox is 2,160 hours. This verifies configuration, not actual email delivery. SMTP credentials and other secret fields are excluded from this report.

## RLS and privileged functions

Every public base table has RLS enabled. Both public views and all policy predicates/grants are recorded in the inventory. This proves configuration coverage, not complete cross-user authorization correctness. Step 5 must exercise each relevant command with customer, dancer, venue, administrator, anonymous, and service identities in a disposable environment.

Five public SECURITY DEFINER functions are browser-callable: `current_user_role`, `has_active_club_deal`, `is_admin`, `settle_deal_revenue_event`, and `void_generated_deal_redemption`. The first three also permit anonymous execution. All have pinned search paths. These permissions are review targets, not automatic proof of a vulnerability: policy helpers need their intended privileges, and settlement functions must enforce internal authorization. No privileges were changed during the audit.

Supabase advisors returned 3 anonymous and 5 authenticated SECURITY DEFINER warnings, 1 disabled leaked-password-protection warning, 75 RLS initialization-plan warnings, and 247 multiple-permissive-policy warnings. The latter are policy/role/command combinations, not 247 distinct exploitable defects. Do not remove intentional owner/admin policy combinations mechanically.

## Storage boundary

| Bucket | Access | Limit | Allowed type family |
| --- | --- | --- | --- |
| dancer-photos | Public | 10 MiB | JPEG, PNG, WebP |
| dancr-image-moderation-review | Private | 10 MiB | JPEG, PNG, WebP |
| dancr-image-moderation-temp | Private | 10 MiB | JPEG, PNG, WebP |
| dancr-media-originals | Private | 10 MiB | JPEG, PNG, WebP |
| mydancr-tv-videos | Private | 75 MiB | MP4, WebM, QuickTime |
| venue-cover-images | Public | 10 MiB | JPEG, PNG, WebP |
| venue-logo-images | Public | 10 MiB | JPEG, PNG, WebP |
| venue-ownership-proofs | Private | 10 MiB | Images, PDF |
| venue-qr-codes | Public | 10 MiB | JPEG, PNG, WebP |
| verification-documents | Private | 10 MiB | Images, PDF |

Public dancer-photo URLs may remain usable after profile visibility changes. Making the bucket private without migrating URL consumers would break working media; Step 11 needs a compatibility and cache plan. The legacy verification bucket remains private, but metadata alone does not establish whether retired identity objects exist or that their retention is appropriate. Do not delete anything as an audit shortcut.

## Findings and ordered follow-up

| ID | Finding / production impact | Required controlled step |
| --- | --- | --- |
| DB-01 | Four duplicate migration-version groups make blind CLI replay ambiguous | 2: reconcile file/ledger history without replaying production DDL |
| DB-02 | 39 local files have no recorded live version; existing effects must be checked individually | 2: classify historical effects, record evidence; never equate a missing ledger row with missing schema |
| DB-03 | No proven clean migration replay or disposable Supabase project for this run; setup docs list an incomplete historical sequence | 2, 18, 21: reproducible tooling, environment safeguards and fixtures |
| DB-04 | `club_deals_liquor_free_check` is NOT VALID. Earlier evidence identified one inactive historical exception | 3, 15: fresh aggregate preflight and preserve history; do not remove the constraint or rewrite production records automatically |
| DB-05 | Older unused signup helpers can reintroduce conflicting provisioning behavior | 7: consolidate safely; test partial signup, retries and role conflicts |
| DB-06 | Account lifecycle spans Auth metadata, venue state and app/profile updates with compensation | 9, 17: fault injection and atomic boundaries; inspect failed compensation |
| DB-07 | Public media visibility and private legacy-file retention need object-lifecycle review | 11, 17: ownership, failed finalize/delete and recovery checks |
| DB-08 | Role-policy and SECURITY DEFINER advisor review remains necessary despite RLS coverage | 5, 10, 13: prove permissions and measure before policy/index changes |
| DB-09 | Exact installed dependencies have four advisories: Next critical, sharp and js-yaml high, qs moderate | 18: coordinate with concurrent application-security work; verify exact versions and patched build before updating |
| DB-10 | Leaked-password protection is disabled per fresh Auth advisor | 6: determine configuration/plan requirements before a setting change; no paid feature activation |
| DB-11 | Real signup/recovery mail delivery and staging role fixtures are not designated | 6, 7, 21, 23: use approved disposable accounts; never mutate real passwords or send unsolicited test mail |
| DB-12 | Previous backup report established daily database backups, PITR off, but no restore drill or storage-object restore proof | 22: recheck capabilities and document an isolated recovery drill; no production restore |

Duplicate versions: `202606280001` (venue role/check-ins), `202608040001` (watermarks/finance), `202608080001` (multi-offer deals/TV/payout separation), `202608180001` (Bitsafe/commission). Full names and SHA-256 hashes are in the inventory.

Previous September 7 audits and remediation documents describe already-addressed profile visibility, cross-venue policy, analytics view, missing RPC/table, session and password handling problems. Those are regression targets; this report does not reclassify historical defects as newly discovered live vulnerabilities. See [prior remediation](../supabase-remediation-record.md), [operational evidence](../supabase-operational-verification.md), and [recovery operations](../account-recovery.md).

## Verification and limits

The existing readiness probe passed **20/20 production read-only checks**, including Auth reachability, schema/RPC presence, anonymous public projection access and denials for legal names, private analytics, and saved deals. It does not prove successful writes, cross-user policies, complete signup, or email delivery. Release validation and exact deployed-commit evidence are tracked in [the execution ledger](execution-ledger.md).

No reset, schema push, migration repair, account mutation, object deletion, restore, paid feature activation or RLS weakening was performed in Step 1. The first configuration-read attempt required a local CLI config; the subsequent isolated dry-run succeeded without altering production. Fresh backup capability verification remains outstanding.

## External operational references

- [Supabase migration management](https://supabase.com/docs/guides/deployment/database-migrations): migration history repair updates tracking, not the actual SQL effects. Reconciliation requires independent schema evidence.
- [Supabase local migrations](https://supabase.com/docs/guides/local-development/database-migrations): disposable local replay is distinct from a production reset.
- [Supabase backups](https://supabase.com/docs/guides/platform/backups): database backups do not include Storage object bytes. Database and media recovery must be planned separately.
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project): restoring database state does not reproduce every external setting or storage object.
