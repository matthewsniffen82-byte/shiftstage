# Supabase remediation record

## Stage 1 — audit

Delivered as `8d38fbd56d33555739ce4b3711bf32539c74ed5c` to `origin/main`. Local HEAD and remote matched after push. Vercel reported **success** for that exact commit. Final combined validation: 1,510 tests passed, TypeScript passed, lint passed, production build passed. Only audit documentation was changed.

## Stage 2 — authentication hardening

Delivered as `5e4cc16c202cc0f7725882dd6412a531fdf58c1b`; local HEAD matched `origin/main` after push and Vercel reported **success** for that exact commit.

Changes:

- Login and signup preserve passwords exactly, matching password update semantics (H4).
- Provider outages/timeouts and rate limits are distinguished from incorrect credentials. Password/email update outages report an uncertain result safely (H7).
- Password update reads required account context before the mutation. Other-session revocation and email-alert exceptions cannot turn a committed update into a false failure. Response/email wording reflects whether revocation was confirmed (H8).
- Recovery account checks offer retry during outages and have cancellation/deadlines. Password submission has a deadline, duplicate-submit protection, and an explicit uncertain-result message without automatic resubmission.
- Callback verification handles provider/network failures without invalidating unrelated sessions. Blocked browser storage stops navigation and explains recovery. Invalid customer/dancer/venue confirmations show a clear failure instead of implying confirmation success (M3).
- Existing signup confirmation, safe redirects, token scrubbing, account-neutral reset delivery messages, and new-password form behavior are preserved.
- Fragment email callbacks follow the verified account role even when their redirect hint names a different account type. Unconfirmed login explains the required email verification.

Behavioral regression coverage includes exact password characters, authentication provider statuses, successful password change with failed revocation/email, failure before mutation, recovery vs signup routing, invalid/missing recovery parameters, malformed/failed confirmation, temporary outages, unavailable browser storage, session-check timeout, mismatched passwords, explicit submission, and terminal auth failures. Existing session/auth suites cover authenticated request verification and refresh rejection, protected-route authorization, and duplicate/stale actions.

Validation passed: all 1,543 tests, TypeScript, zero-warning lint, and the production build. Browser checks against the built app confirmed missing recovery links show the expired-link state and invalid customer confirmation shows an explicit error. Logged-out account, dancer dashboard, and admin approval API requests returned 401/AUTH_REQUIRED. The temporary local server and browser tab were stopped after verification. Tests use isolated mocked provider boundaries; they do not reset production passwords, send emails to users, or establish real cross-device inbox delivery. The operational test matrix below remains necessary before declaring complete production readiness.

## Stage 3 — client and session architecture

Delivered as `62a99aab5af9601c4acea2a0e2ebdf9eda3a917a`; HEAD matched `origin/main` after push and Vercel reported **success** for the exact commit.

Refresh responses now require the initiating access/refresh token pair to still match browser storage. Late admin, dashboard, NFC, saved-deal, media, and recovery responses cannot restore logout, replace another account, or roll back newer credentials. Recovery submission is bound to the account verified by the form. Legacy confirmation hydration preserves verified server roles and existing sessions during lookup failures instead of inventing a role from a URL hint.

The signed-upload browser client is a singleton with SDK persistence, auto-refresh, and URL detection disabled. It no longer creates a second auth storage lifecycle. Server clients remain request-scoped with explicit user verification; the server factory is marked server-only. The existing custom bearer-token architecture is retained, rather than partially introducing incompatible SSR cookies. The scoped NFC cookie is unchanged. A redundant post-setSession getUser verification remains deliberately in place; no shared user-token cache was introduced.

Public configuration validates HTTPS/local development URLs and anon/publishable key types without printing values. The build rejects privileged public keys before bundling; legacy anon JWTs and modern publishable keys are supported. Existing production values require no change.

Validation: all 1,546 tests, TypeScript, zero-warning lint, and the production build passed. Generated browser assets contained no configured service-role/OpenAI keys. Regression coverage checks logout, out-of-order refresh, same-role account switching, changed recovery account, and invalid/private public configuration. No database/configuration or account mutations were performed in this stage.

## Stage 4 — database and RLS hardening

Delivered as `6d5a3bacc5da46929fffc8951c9bb9f4a672dfc5`; HEAD matched `origin/main` after push and Vercel reported **success** for that exact commit. Both targeted SQL migrations were subsequently applied, verified, and recorded in Supabase migration history. Live Auth/public API health and permission-denial checks passed.

The route release supports legal-name column privacy, server-controlled shift writes with an atomic active-shift guard, and server-attributed support writes after owner verification. Targeted migrations close C1/C2 and H1/H2/H9/H10/H11, restore the missing recovery/saved-deal schema (H3), and mirror future verified Auth email changes (M4). Existing accounts, historical rows, financial protections, and public image URLs remain intact.

Both migrations passed live-schema dry runs ending in ROLLBACK. Tests confirmed public/owner profile access, private-field exclusion, restricted direct mutations, private RPC/table grants, and recovery limits. No active venue-team fixture was available; representative two-venue testing remains explicit. SQL-token fingerprints matched the reviewed repository files before application. See `supabase-database-remediation.md` for release order and remaining operational items.

Final combined validation passed: all 1,556 tests, TypeScript, zero-warning lint, and production build. Concurrent profile styling and favorite-club improvements were preserved. Database application follows successful deployment of this route release; it is not performed by Vercel automatically.

## Stage 5 — query reliability

Account provisioning now preserves existing roles, names and city, handles concurrent bootstrap safely, and commits related rows atomically. Publication changes lock and recheck current account/profile state. Support messages, thread state and in-app notifications commit together; optional request IDs deduplicate uncertain submissions and admin replies. External notification failure no longer reports a committed message as failed. Older databases retain a compatibility path only for a confirmed missing function; uncertain write failures never trigger a second write path.

Ranking counts no longer assume composite-key tables contain an `id`. Batches of at most 200 dancers replace eight network requests per dancer, with bounded pagination and fail-closed incomplete metrics. Two indexes match predicates missing from the live catalog. The private monthly view preserves existing metric meanings while avoiding multiplicative joins. Saved rankings remain successful when secondary notifications or logging fail, with visible warnings.

Validation passed: 1,563 tests, TypeScript, zero-warning lint and production build. Reviewed SQL fingerprints matched both migration files. Live PostgreSQL rollback assertions verified preservation of existing customer metadata, rejection of role changes and unauthorized publication, authorized private publication, ranking reads, support/admin reply deduplication, mismatched-request rejection, sender-role protection, durable in-app notifications and restricted function grants. All synthetic messages/notifications and publication changes rolled back. Notification/support tables have no external-delivery triggers. No production emails were sent by these tests.

Deploy the route release before applying `202609070003_atomic_accounts_publication_and_metrics.sql` and `202609070004_atomic_support_messages.sql`; record both versions and reviewed statements atomically in migration history. Vercel does not run SQL migrations. Deployment/application confirmation follows in the next stage record.

## Staging/manual verification still required

Use a designated staging project and disposable customer/dancer/venue accounts. Do not create or remove production users as a test shortcut.

| Flow | Required observation |
| --- | --- |
| Signup and verification | One account/profile, delivered email, correct role and destination after verification |
| Existing email/signup retry | Existing role/profile/session remain unchanged; no duplicate profile |
| Recovery email | Latest email reaches inbox; exact destination accepted by allowlist; email-scanner behavior checked |
| Recovery on another browser/device | Supported implicit/token-hash flow opens the new-password form; no dependence on the initiating browser's local state |
| Expired/used/malformed email link | Safe error/sign-in path; no successful confirmation claim |
| Password update then login | New exact password works, old password fails; verify whitespace and leaked-password rejection |
| Multiple reset requests | Provider/app limits respected; latest usable link explained; no automatic request loop |
| Session persistence and expiry | Refresh/reopen/navigation retains valid identity; expired/invalid credentials require sign-in |
| Refresh outage | Existing session preserved with retry message; restored provider allows recovery |
| Logout/account switch with pending reads | Old responses never restore old credentials; Stage 3 adds shared response guards |
| Provider outage during a write | UI stops loading and explains uncertain outcome; no duplicate automatic mutation |
| Browser back/forward and refresh | No unintended password resubmission or stale account mutation |

Stage 3 addresses remaining session-response races and client lifecycle. Stage 4 handles the confirmed live RLS/schema findings. Stages 5–6 cover broader query atomicity, transport deadlines, and outage behavior. Do not interpret Stage 2 as completion of those later requirements.
