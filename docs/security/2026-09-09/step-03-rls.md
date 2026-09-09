# Step 3 — database row access boundaries

## Evidence and scope

Production catalog metadata was captured at 2026-09-09 10:51 UTC in an explicitly read-only transaction against the MyDancr project. All 79 public base tables have RLS enabled. Their policies, relation grants and function fingerprints matched the independently captured 09:08 catalog in `docs/supabase-reliability/step-01-inventory.json`. Eighty-two direct column grants were captured separately: the same 41 SELECT columns for anon and authenticated across dancer_profiles and shifts. This is configuration evidence, not a claim that RLS activation alone proves isolation.

Every public table's SELECT/INSERT/UPDATE/DELETE grants and applicable policy predicates were reviewed. The accompanying table matrix includes all 79 base tables and two views. Relations without browser grants/policies remain server-only. Supabase-managed auth tables are not exposed application tables; storage object policies are inventoried in the catalog and reviewed in Step 4. PostgreSQL roles, public policies, trusted role helpers, views and column privileges are part of this step.

## Confirmed finding: disabled-account preference writes (MEDIUM)

The existing owner-scoped ALL policies on customer_profiles, favorites, follows, going_signals and venue_follows validate ownership but do not require an active account. Authenticated users with a still-valid session can insert or update their own rows after their application account is disabled. The affected write policies have no trigger enforcing account state. This permits continued profile-preference changes and social activity after disablement; it does not let users edit another user's records or become administrators.

An isolated PostgreSQL reproduction using the captured policies and the five tables' actual not-null/default/primary-key/foreign-key/check constraints permitted both disabled INSERT and UPDATE on all five tables. No production account or row was changed to reproduce the issue.

The additive migration `20260909110000_enforce_active_account_preference_writes.sql` adds restrictive INSERT and UPDATE policies requiring an active app_users row for the authenticated UID. Restrictive policies combine with existing ownership/admin policies, so this cannot expand access. Existing reads, owner deletions, active-account actions and trusted service operations are preserved. Existing role semantics are preserved; this step does not invent new product restrictions on which active account roles may follow a profile. Customer deal saves already require an active customer on INSERT and retain that stronger check.

## Controls retained

- is_admin reads the database role and requires account_state=active. Browser metadata cannot grant administration. Its existing pinned search path remains intact.
- Browser roles cannot mutate app_users or dancer_profiles, including role/approval fields. Trusted provisioning and privileged server writes remain the relevant mutation boundaries.
- Venue owner/team predicates qualify the outer venue ID. The prior cross-venue fixes remain in place.
- The public dancer view uses security_invoker; hidden profiles are filtered by the underlying table policy. Legal-name column access and the private analytics view remain denied.
- Sensitive server-only recovery, rate-limit, media-like and affiliation tables retain their revoked browser grants. No RLS or stronger prior restriction was removed.

## Executed validation

- 94 PostgreSQL tests exercise the captured public-table policies and exact new migration, rather than searching SQL source for strings. Every base table has a synthetic private record. Anonymous and unrelated-user SELECT/INSERT/UPDATE/DELETE attempts are tested; separate users own separate dancer/venue records and venue memberships.
- Positive tests cover owner reads, active-account inserts/updates/removals, active-admin access, and public profile publication/hiding. Negative tests cover ownership transfer, customer edits to dancer approval/account roles, forged admin metadata, disabled-admin access, private views/legal names and disabled preference writes. Removals and own reads remain available after disablement.
- Fresh read-only production checks under customer, dancer and venue database role contexts passed. The selected actors existed; only booleans and role labels were returned. Other account/profile/preference/support/notification rows, admin actions, hidden dancers and unrelated venue activity stayed hidden. Account-role/dancer writes and legal-name reads lacked grants.
- These role-context probes use privileged SQL to select an existing actor internally and then SET LOCAL ROLE authenticated. They do not create browser tokens, test Auth token issuance, or expose account IDs. Each transaction is READ ONLY and ends with ROLLBACK.
- The complete suite passed 2,066 tests with zero failures/skips. Lint, TypeScript, the migration history gate and production build passed; postbuild skipped demo population. The dependency audit after adding the isolated test runtime reported zero vulnerabilities. Exact-commit deployment and database postconditions must also pass before Step 4.

## Test limits

The test-only pinned PGlite dependency runs PostgreSQL locally with no network or production credentials. The fixture copies audited enums, typed columns, table/column grants, policies, views and trusted role helpers. The changed tables retain their captured constraints/defaults; unrelated tables focus on policy semantics and do not replay their complete constraints, triggers or side effects. It is not a complete Supabase staging project or a replay of the ambiguous historical migrations. The catalog fixture is intentionally frozen; a later policy change must update the relevant regression expectations and validate the actual new migration.

No disposable Supabase project or authenticated staging accounts have been designated. Full Auth/REST/browser integration for all roles remains a validation limitation for the later authentication and final defensive-validation steps. Safe SQL role-context checks and real PostgreSQL policy execution provide independent coverage here, without treating source assertions as live proof.

## Controlled database deployment

Review the final diff and rerun the complete checks. Commit/push this step, then apply only its committed migration to the explicitly selected production project. Vercel does not apply SQL. Recheck the live policy/migration catalog immediately before application; stop on unexpected concurrent changes. Do not replay historical files or repair unrelated migration versions.

The migration is transactional, takes no data-changing action and uses a three-second lock timeout and thirty-second statement timeout. Verify exactly ten new restrictive policies, unchanged ownership policies/grants/RLS and healthy read boundaries. Record this migration's version, name and immutable SQL hash in the deployment evidence and migration ledger through the existing controlled workflow. Update the history manifest only after successful application and verification.

If a regression requires rollback, remove only the two newly named restrictive policies from each of these five tables in a bounded transaction, restoring the captured pre-step policy set. This reopens the documented disabled-account gap; prefer a tested forward correction. Never drop existing ownership policies, disable RLS or alter production records as a rollback shortcut.

No paid service, credential rotation, account reset or identity-document access was needed. Broader browser data minimization, storage, server authorization and abuse controls retain their later numbered reviews.
