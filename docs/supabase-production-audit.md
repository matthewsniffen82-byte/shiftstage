# MyDancr Supabase production-readiness audit

Audit date: 2026-09-07. Baseline: `8a503065` (`origin/main` when the isolated audit checkout was created). Stage 1 is an inspection/report stage; no production data, accounts, passwords, sessions, policies, or application behavior were changed during this audit.

## Scope and evidence

The repository inventory covers 815 tracked files, including 115 migrations. The companion inventory lists all source files matching Supabase, database calls, or the application's session helpers. Matches are an inventory, not proof that every branch has been executed. Runtime authorization, asynchronous failure behavior, and SQL definitions were inspected across authentication, customer, dancer, venue, admin, public discovery, NFC, moderation, storage, finance, notifications, and scheduled work.

Read-only production catalog queries inspected 86 public/storage relations (including two public views), 142 policies, 10 buckets, 539 constraints, 255 indexes, the account bootstrap trigger, exposed security-definer functions, and 73 migration-history entries. All inspected public base tables have RLS enabled. RLS alone does not establish correct access: grants, overlapping policies, views, and service-role routes must also agree.

Production catalog observations below are distinct from repository assumptions. No live adversarial writes, user-account creation, password changes, financial transactions, destructive migration replay, or outage injection were performed. Multi-device email delivery and actual session-expiry timing require a disposable staging account and provider configuration; unit tests cannot establish those production properties.

## CRITICAL

### C1 — Legacy dancer policy overrides privacy restrictions (confirmed live)

**Evidence:** `202606250001_initial_schema.sql` creates `approved dancers are public`. Production still has that permissive SELECT policy alongside `approved public dancers are public`. Its condition permits every `status = 'approved'` row, without `is_public`, verification, venue approval, or `disabled_at` restrictions. `202607150001_dancer_profile_visibility.sql` was intended to remove the old policy.

**Risk:** Direct Data API reads can access approved profiles even when application privacy filters would hide them. Permissive policies combine with OR; the stricter policy does not cancel the old one. This is a confirmed access-rule defect, not evidence that a particular person exploited it.

**Fix:** Add an additive corrective migration that drops the exact legacy policy and preserves owner/admin reads and the current approved-public predicate. Verify anonymous/owner/unrelated-user results with fixtures in a disposable database and inspect the live policy catalog after deployment. Do not change dancer publication state or delete records.

## HIGH

### H1 — Three venue-team policies allow cross-venue reads (confirmed live and source)

**Evidence:** `202608100001_venue_team_operations.sql:155,174` and `202608230001_venue_club_deal_requests.sql:48` use unqualified `venue_id` inside a membership subquery. Production resolves this to `member.venue_id = member.venue_id` in policies on `venue_activity_log`, `venue_nfc_support_requests`, and `venue_club_deal_requests`.

**Risk:** An active team member can satisfy the membership predicate for another venue's records through the Data API. Server-side venue filtering does not repair direct database authorization.

**Fix:** Recreate only these three policies with the outer table explicitly qualified. Retain existing owner/admin access; require active membership in that exact venue. Add cross-venue SQL regression fixtures.

### H2 — Public views bypass underlying RLS (confirmed live)

**Evidence:** Both `public_dancer_profiles` and `dancer_monthly_impact` are selectable by `anon`, have no `security_invoker` option, and use creator privileges. The monthly view aggregates all dancers without an ownership/publication filter. The profile view uses `(status = approved OR verification_status = approved)` and omits the current venue-approval requirement.

**Risk:** Private dancer IDs/analytics and profiles excluded by current rules can be exposed independently of API filtering. The monthly view also joins several unaggregated event tables, creating potentially multiplicative work.

**Fix:** Inspect consumers and grants before changing compatibility. Restrict unused analytics-view browser grants; make the public projection obey current publication rules and invoker security where supported. Preserve view column names. Replace the monthly aggregation with independent pre-aggregations or retire browser access, rather than exposing private underlying tables to make it work.

### H3 — Live schema and migration history are not a reliable deploy baseline (confirmed)

**Evidence:** `account_recovery_events` and `customer_deal_saves` are absent in production. The recovery RPC falls back to count-then-insert records in `content_reports`; Club Deal saves report `persisted: false` and rely on browser fallback. The ledger omits the signup-role hardening version even though the actual bootstrap function has the hardened definition. Four migration version numbers are reused by different files; one occurs three times.

**Risk:** Features can deploy before their tables exist; security corrections may be missing or only partly applied. Blind `db push` or replay can run old data updates/deletions, collide on versions, or revert current business rules. Count-then-insert recovery throttling is not atomic under concurrency.

**Fix:** Capture a catalog baseline and reconcile each migration by its actual effects. Apply narrowly scoped, non-destructive corrective migrations for missing objects. Record repair history only after checking definitions. Do not rename/replay historical migrations indiscriminately. Add a read-only release readiness check for required tables/RPCs and policy invariants.

### H4 — Password login/signup trims characters that password update preserves (confirmed source)

**Evidence:** `app/api/auth/route.ts` reads passwords through `readRequired` → `readOptional` → `.trim()`. `app/api/account/route.ts` passes the new password without trimming.

**Risk:** A password changed to include leading/trailing spaces cannot subsequently be submitted unchanged through login. Existing accounts must retain their credential semantics.

**Fix:** Read passwords as exact strings with existing byte/body and length limits. Preserve trimming for email and ordinary text fields. Test signup, login, and update with whitespace-containing passwords; never rewrite stored credentials.

### H5 — Outstanding responses can restore or mix browser sessions (confirmed source)

**Evidence:** `persistRefreshedBrowserAuthSession` merges a returned session with whatever is currently stored, including an empty store after logout. `customer-deal-saves-client.ts` and the recovery form use it without binding the response to the initiating credentials. `dashboard-session.ts` already has a stronger guarded response path, but its direct refresh helper bypasses that guard.

**Risk:** Slow responses after logout or account switching can restore old credentials or associate tokens with another account's cached UI metadata.

**Fix:** Centralize guarded response persistence using the initiating access/refresh pair and current stored session. Never create a session through a refresh response after logout. Keep explicit login/callback session establishment separate. Test out-of-order requests, logout, account switches, and cross-tab storage changes.

### H6 — Authentication and database operations lack consistent deadlines (confirmed source)

**Evidence:** Supabase factories have no bounded fetch wrapper. Login/reset forms have cancellation controllers but no request deadlines. The callback confirmation fetch and recovery form GET/PATCH lack deadlines. `requestDashboardJson` supports a timeout only when each caller opts in. Signed video uploads have no upload-specific deadline.

**Risk:** A hanging network/body read can leave users waiting indefinitely and consume server capacity. Cancellation on unmount is not an outage timeout.

**Fix:** Add shared bounded transport with a larger explicit storage-upload budget and abort-signal propagation. Ensure response-body consumption is bounded too. Never automatically retry mutations, token exchanges, refresh rotation, or financial RPCs. Give users an understandable retry/recheck state for uncertain write outcomes.

### H7 — Auth outages are misreported as credential or expired-link failures (confirmed source)

**Evidence:** `app/api/auth/route.ts` maps all remaining Supabase auth errors to HTTP 400 and incorrect-credential/signup messages. The recovery form treats any failed account load as an expired link. `request.ts` already distinguishes retryable provider errors for authenticated API calls, but that distinction is not shared throughout auth.

**Risk:** Users may repeatedly reset valid credentials during a provider outage. A valid recovery session may be discarded or presented as unusable because of a temporary error.

**Fix:** Share safe classification for network/timeout/429/5xx versus terminal authorization errors. Preserve sessions on transient failure and show a retry state. Keep enumeration-safe reset responses and sanitized logging.

### H8 — Password update can succeed while the response reports failure (confirmed source)

**Evidence:** After `auth.updateUser`, the route revokes other sessions, sends an alert, then reads `app_users`. Failure of that final read returns a generic failed update even though the password was changed. Revocation failure is logged, but the response and email still claim other sessions were signed out. The email helper already bounds provider requests and converts provider failures to delivery results.

**Risk:** Users cannot tell whether the new password took effect, and are given an inaccurate session-security claim.

**Fix:** Separate the committed password change from best-effort follow-up work; fetch required account context before mutation or make post-update reads non-fatal. Report revocation truthfully. Test each partial-failure boundary without automatically repeating the password write.

## MEDIUM

### M1 — Browser upload client enables an unnecessary second auth store

`src/lib/supabase/client.ts` creates a new default Supabase client on every call. Its sole direct caller uploads TV files using signed upload tokens, while application login uses `dancrAuthSessionV1`. Default persistence, auto-refresh, and URL detection create an unrelated Supabase auth lifecycle. Use a reusable client with auth persistence/URL detection/refresh disabled for signed uploads; do not migrate or clear working application sessions.

### M2 — Recovery callback's PKCE branch has no verifier persistence

`confirmSupabaseCallback` calls `exchangeCodeForSession` on a fresh nonpersistent server client, with no PKCE cookie/verifier integration. Production's recovery template currently uses `.ConfirmationURL`; implicit fragments and token-hash verification are the relevant compatible paths. Treat unsupported code-only callbacks explicitly and document the supported email flow. Do not introduce a partial SSR/PKCE conversion that breaks other-device recovery.

### M3 — Callback storage failures are swallowed

The callback catches `localStorage.setItem` errors and continues navigation. In restricted browsers the destination then has no session. Render an actionable storage-unavailable message and retain a safe sign-in route; never expose tokens in a displayed error or URL. Token-hash links consumed before an account-sync failure also need a recoverable sign-in/support message.

### M4 — Auth email changes do not synchronize the application email mirror

The account route updates Supabase Auth email; the inspected live `auth.users` application trigger runs only AFTER INSERT. Notification delivery reads `app_users.email`. Confirmed email changes can therefore leave alerts/recovery lookup using a stale address. Synchronize only the verified Auth email through a trusted path, without trusting browser metadata or overwriting an unconfirmed address. Preserve account IDs and sessions.

### M5 — Provisioning and publication have multi-write failure windows

`provisionAppAccount` upserts `app_users` before profile work; dancer creation checks then inserts and can race with another provisioning request. Signup already has an Auth bootstrap trigger. Account state/publication and admin moderation also span multiple writes and notifications. Audit compensation outcomes and use conflict-safe, existing-profile-preserving provisioning. Prefer atomic RPCs for tightly coupled database state, with external notification work separated from committed changes. Do not roll back by deleting existing accounts.

### M6 — Public photo URLs remain readable independently of profile RLS

Production `dancer-photos` is public. The storage SELECT policy's approval predicate does not protect direct public object downloads. Original/moderation/verification/proof buckets are private, which is appropriate. Determine the intended lifetime of previously published image URLs; document this limitation and plan a compatible private/signed delivery strategy if hiding a profile must revoke old URLs. Do not flip the bucket private and break all existing images without replacing their delivery path.

### M7 — Database health endpoint cannot detect an Auth-only outage

`/api/health/supabase` probes one table only and has no deadline. The recent GoTrue configuration outage could coexist with database availability. Add bounded, read-only Auth and database component checks with safe status-only output and no public configuration/key details. Operational alerts should cover Auth 5xx, DB failures, latency, and email-provider rejection rates.

### M8 — Performance and completeness risks in administrative aggregation

Public directories already have limits and batched metrics, and customer cards batch schedules/images. Admin ranking recalculation performs per-dancer metric queries concurrently; several administration listings rely on the provider's default row cap. Batch aggregation and paginate administrative lists where completeness matters. Use query plans and actual filters before adding indexes; do not add speculative duplicate indexes.

### M9 — Constraint validation and generated schema typing gaps

Production has no invalid indexes. `mydancr_tv_duration_check` and `club_deals_liquor_free_check` are NOT VALID constraints: new writes are checked, historical rows have not been certified. Preserve historical data and audit violations before any validation. Widespread `SupabaseClient`/`as any` use means TypeScript does not verify query columns or RPC signatures against live schema. Introduce a reviewed schema snapshot/type-generation workflow incrementally.

### M10 — Operational email and restore readiness needs external verification

Verified dashboard configuration: custom SMTP enabled (`smtp.resend.com:465`), sender `no-reply@mydancr.com`, 60-second per-user interval; Site URL `https://www.mydancr.com`; one redirect URL `https://www.mydancr.com/auth/callback`; recovery template uses `.ConfirmationURL`. Security notification switches were off. Session time-box/inactivity were corrected in the preceding incident to 2160/720 hours; JWT remains 3600 seconds and refresh reuse 10 seconds.

Email signup and email confirmation are enabled in production. Anonymous sign-ins, manual identity linking, phone login, and the listed external providers are disabled. Verify exact generated callback URLs (including query parameters) against the allowlist, inbox delivery, link-scanner behavior, SPF/DKIM/DMARC, SMTP/provider limits, and project backup restoration in staging. Database backup alone does not establish storage-object recovery. Keep unknown settings explicitly unverified; do not guess values or duplicate password-change emails from both application and provider.

The Email provider also has secure email change and leaked-password protection enabled, OTP expiry 3600 seconds, and OTP length eight digits. Password-change reauthentication and current-password requirements are disabled. Enabling either would require a compatible reauthentication UI and recovery-flow verification first; do not toggle them blindly during hardening.

## LOW

### L1 — Configuration shape checks are incomplete

`env.ts` checks presence but not URL shape or public-key role. Server-only imports protect the service-role factory, and no intentional service-role browser export was found. Validate public URL/key configuration without logging values, and scan built browser assets for secret material using boolean results only.

### L2 — Historical migration identifiers and tests need durable release checks

The four duplicate version groups are listed in the inventory. Many security tests inspect migration text or mocked clients; those can pass while a policy is absent or stale in production. Add a live read-only invariant audit and disposable-database behavioral tests alongside source assertions. Never treat an empty migration ledger entry or successful Vercel build as proof of database deployment.

### L3 — Dependency advisory outside the Supabase path

The baseline `npm audit` reports one moderate transitive `qs` issue with a fix available. Trace the dependency and update the lockfile in a separately validated remediation stage if compatible. Do not run a blanket force upgrade during the inspection stage.

## Existing protections to preserve

- Server-only service-role factory; request-scoped authenticated clients validate users with Auth rather than trusting browser account IDs.
- Admin routes use active-admin authorization; venue access is derived from ownership/team membership and explicit permissions.
- Live signup bootstrap accepts privileged roles only from trusted app metadata; missing migration history does not imply that protection is absent.
- The two callable financial security-definer RPCs inspected (`void_generated_deal_redemption`, `settle_deal_revenue_event`) check active admin identity and lock target rows. `is_admin` checks active account state.
- Private verification, ownership-proof, moderation, original-media, and TV buckets; signed TV upload preparation and upload IDs support retry/reconciliation.
- Stripe signature verification, webhook claims, ledger RPCs and row locks; retain their idempotency boundaries.
- Bounded request bodies, safe public error mapping, sanitized error metadata, no-store auth responses, safe local redirect validation, and several existing session-response guards.
- NFC browser-account deterrence uses a signed HttpOnly cookie and does not depend on phone numbers. It is not a physical-device identity guarantee.
- No application Realtime subscription usage was found in the repository inventory. No repository middleware-based Supabase cookie session architecture is present; protected data is authorized in API routes.

## Remediation and verification sequence

1. Finish Stage 1 report/inventory and baseline tests, TypeScript, lint, production build; commit, push, verify exact-commit Vercel success.
2. Auth hardening: exact password input, outage classification, reliable password mutation response, callback/form failure states, lifecycle regression tests.
3. Client/session architecture: guarded session persistence, reusable stateless upload client, config boundaries and request/session race tests.
4. Database/RLS: targeted corrective SQL, live-drift reconciliation, missing tables, policy/view access fixtures and catalog verification. No destructive historical replay.
5. Query reliability: provisioning concurrency, partial-success boundaries, justified performance changes and explicit schema readiness.
6. Outage handling: shared deadlines/cancellation, safe user retry states, component health checks; no automatic non-idempotent retries.
7. The supplied request ends at `STAGE 7 — PASSWORD RESET`; remaining requirements were requested separately. Existing password-reset requirements in Stage 2 remain in scope.

Every stage must pass the full automated suite, TypeScript, lint and production build, then be committed/pushed and verified on Vercel before continuing. Database/configuration changes that cannot be safely applied are documented as outstanding, not described as deployed.

## Reference semantics

- [Supabase RLS and view security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Public and private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase session and refresh behavior](https://supabase.com/docs/guides/auth/sessions)
- [PKCE verifier requirements](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

## Stage delivery record

### Stage 4 catalog follow-up findings (before remediation)

- **CRITICAL C2 — legal-name column exposed by table-wide SELECT grants.** Live `dancer_profiles` grants allow anon/authenticated callers to select `real_name` on publicly visible rows. App serializers omit it, but direct REST callers bypass those serializers. Revoke table-wide SELECT and explicitly grant the non-legal-name columns; route owner-only private profile reads through the verified server boundary. Preserve the column and all values.
- **HIGH H9 — legacy Club Deal owner mutation bypass.** The venue endpoint correctly refuses venue edits because deals are managed by MyDancr, but live `Venue owners manage own club deals` plus DML grants permits direct edits. Retain owner SELECT, remove owner mutation access, and preserve server-admin publication.
- **HIGH H10 — direct scheduling bypasses route affiliation checks.** Live shift triggers protect location/check-in fields, so this is not evidence of unrestricted forged check-ins. However, direct owner DML can bypass the route's required active venue affiliation, scheduling rules, and controlled cancellation. Route verified writes through the existing server client and revoke browser DML, retaining owner reads and existing proof triggers.
- **HIGH H11 — support sender/role impersonation inside an owned thread.** INSERT policy checks thread ownership but does not bind sender identity/role/kind; thread UPDATE also permits administrative fields. Keep reads under RLS; move existing authenticated, ownership-checked writes behind the server boundary and revoke direct browser mutation privileges. No messages or threads are deleted.

### Stage 5 query follow-up findings (before remediation)

- **HIGH H12 — ranking counts assume a nonexistent `id` column.** The generic ranking count helper selects `id` even for follows/favorites, whose keys are composite. This can fail an otherwise valid ranking recalculation. Use a head-only wildcard count and batch metric retrieval to avoid eight network queries per dancer.
- **MEDIUM M11 — provisioning retries overwrite existing account metadata.** The shared provisioning helper upserts role/name/email and customer city before preserving the dancer profile. A repeated callback can overwrite working account preferences. Use insert-on-conflict preservation and transactional provisioning where available; handle a concurrent same-user profile insert without failing signup.
- **HIGH H13 — missing-profile repair violates the live NOT NULL constraint.** The live `real_name` column is NOT NULL, while repository fallback provisioning inserts null. Auth's existing bootstrap uses a private `Verification pending` placeholder. Use that same placeholder only for newly repaired draft rows, preserve existing values, and keep the Stage 4 column privacy boundary.
- **HIGH H14 — rotated sessions are not consistently returned by authenticated endpoints.** The request client can rotate expired credentials, but several routes omit `session` from their response. A successful operation can leave the browser with the old refresh token. Stage 6 must provide a consistent refresh transport and test endpoints that currently omit session bodies; no long-lived service key belongs in that transport.

Stage 1 baseline validation passed: all 1,500 automated tests, TypeScript, ESLint with zero warnings, and the production build. The build's data-population hook reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. A scan of built static assets found no matches for the locally configured service-role or OpenAI secret values (values were not printed). The inventory and read-only SQL checklist are documentation-only additions. Concurrent commits `45021ca8` (styling) and `3d9e81f7` (device-saved deal display) were preserved before publication; the combined suite now has 1,510 tests. Neither supplies the missing server-side deal-save table. Commit/push and exact-commit Vercel verification follow this report; subsequent stage records identify their outcomes and any remaining operational work.
