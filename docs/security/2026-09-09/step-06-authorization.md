# Step 6 — Role authorization and account-state enforcement

## Confirmed findings

| Severity | Finding | Fix |
| --- | --- | --- |
| HIGH | A suspended user could first request `disabled`, creating a trusted self-pause marker, then request `active` to bypass an administrative suspension. An Auth identity retained after incomplete deletion could also reactivate a deleted application account. | Self-service transitions reject both relabeling and reactivating an administrative suspension. Deleted accounts cannot return to active or disabled. Retrying deletion remains supported. |
| HIGH | Reactivation and rollback omitted the self-pause metadata keys instead of deleting them. Supabase merges metadata updates, so obsolete self-reactivation permissions persisted and could undermine a later suspension. | Send explicit null values for the two self-service keys. Write only those keys, preserving other trusted metadata. Each new pause of an active account receives a fresh timestamp. A narrowly scoped migration removes pre-existing obsolete markers from active accounts. |
| MEDIUM | Several dancer APIs checked profile ownership but not the current application role/state before using a privileged client. A previously provisioned dancer profile remained readable by its owner after account disablement, enabling continued privileged media/profile operations. Agent APIs checked an active sales-agent record without checking application suspension. | Add an optional server-selected account requirement to the verified request context. Fifteen dancer routes now require an active dancer before their work; agent commissions require an active application account in addition to the existing agent capability check. Previously stronger guards and ownership predicates remain. |

The callback changes from Step 5 were already pushed, deployed and verified before this work began. No other security area is combined into this step.

## Reviewed authorization boundaries

The Step 1 route inventory and Step 3 live table/policy matrix were cross-checked against the current checkout. Roles in `app_users` are customer, dancer, venue and admin. Sales-agent eligibility is a separate server-managed capability. Venue owner/manager/staff permissions are scoped memberships, not additional global roles. No moderator or superadmin role is currently defined.

| Area | Authority and ownership boundary |
| --- | --- |
| Authentication / provisioning | Auth verifies the identity; database `app_users` supplies the role/state. Browser role hints cannot provision admin or venue authority. Existing-account provisioning preserves role and approval. The old exported signup helpers have no application callers and cannot override revoked browser write grants. |
| Admin | Every admin API imports the existing `requireAdmin` boundary, which queries the verified user ID and requires an active database admin. User metadata and hidden menus do not authorize it. Detailed administrative action/logging review remains Step 7. |
| Account lifecycle | `/api/account` always passes the authenticated user ID to lifecycle operations. Body role/user-ID fields are not used for privilege or target selection. Self-pause, resumption, administrative suspension and permanent deletion remain distinct. Account recovery/support access is preserved. |
| Dancer profile, avatar, gallery, pins, video and shifts | The new request requirement checks the verified identity's active dancer role before privileged work. Existing profile/media/shift queries still scope IDs to that dancer; approval, publication, affiliation, moderation, upload paths and final write ownership checks remain. |
| Dancer dashboard, finance and venue verification | Existing explicit active-dancer checks remain; no duplicate check was added. The public NFC tap flow already verifies an active dancer before its operation. Retired document upload and legacy check-in entry points remain closed. Free-checkout/portal informational responses do not create payment authority. |
| Venue management | `getVenueAccess` verifies an active venue account and derives an owned venue or active manager/staff membership from the database. Team access also requires the owner's account to remain active. Draft/private venue visibility does not grant or remove management ownership. |
| Venue capabilities | Profile/roster actions require their specific permission; finance uses `view_finance`; team mutation requires owner `manage_team`. Team member/invitation IDs are constrained to the authorized venue, and assignments allow manager/staff only. Venue deal mutation remains MyDancr-controlled. Referral agreements are read-only for venue users. |
| Agent commissions / payout link | New application-state check precedes the existing active sales-agent lookup. Commission, referral and payout records use that agent ID. The browser cannot select a recipient or approve its requested payout link. Active accounts retain eligibility for separately assigned agent capability. |
| Customer preferences / saved deals | Verified user IDs scope favorites, follows, profiles and saved records. Public-target checks and Step 3 active-write policies remain. Cross-role following is intentional; only customer deal-save functionality requires the customer role. No new restriction removes legitimate shared preferences. |
| Notifications / support / DMCA | Recipient, thread owner and uploader predicates constrain record IDs. Support and account-management paths remain available for resolving suspended-account issues. Admin variants retain admin authorization. |
| Public / token / scheduled routes | Public discovery has no private management authority. Claim/redemption/NFC links use their existing purpose-specific token checks. Scheduled work requires the cron credential and Stripe verifies its signature before privileged work. Their deeper scheduled reviews remain separate. |
| Direct database access | Browser writes to account roles, dancer content, moderation and team authority remain revoked. RLS and existing security-definer caller checks are unchanged; the 94-test PostgreSQL isolation suite still covers anonymous, unrelated, owner and admin access. |

## Narrow production repair

Read-only aggregate queries found two active accounts with stale self-pause markers, one currently paused account with a marker, and no deleted application accounts retaining an Auth identity. No account IDs or metadata values were exported. The two active markers predate the fixed `2026-09-09T12:00:00.000Z` cutoff; no other active markers were found.

`20260909120820_remove_stale_self_service_permissions.sql` removes only the two obsolete permission keys from qualifying active accounts. It locks each matching application/Auth row, preserves every other metadata key, and leaves account state, roles, email, password, tokens and current pauses unchanged. Its fixed cutoff excludes new requests; new application code refreshes the timestamp for every active-to-disabled transition. The migration is idempotent. Live Auth triggers were inspected: they respond to insertion or email/confirmation-column changes, so this metadata-only update does not trigger email confirmation or account creation.

Deployment order is deliberate: publish and verify the fixed application first, then apply only this committed migration in a bounded transaction with its own migration-ledger entry. Compare postconditions, freeze the verified migration in the history baseline, and deploy that same-step delivery record before Step 7. Historical migrations are not replayed.

## Tests and release evidence

- 28 account-lifecycle runtime tests model Supabase's actual merge/null-delete semantics. They cover all four roles, administrative suspension, forged user metadata, deletion, legitimate pause/resume, private venue restoration, failed-write metadata cleanup and safe retry after a failed restoration.
- 151 professional-role runtime tests exercise the real request helper and exported route handlers with synthetic identities. They cover refreshed and non-refreshed sessions, current database role/state, user-supplied target/role hints, provider errors, missing accounts and denial before privileged work across the changed route methods. Existing application tests cover valid feature behavior.
- One PostgreSQL migration test covers obsolete, current, disabled, deleted, missing and malformed markers, unrelated metadata preservation and repeated execution.
- Initial focused security/RLS/ownership suite: 320 passed. After the final lifecycle refinement, all 32 lifecycle/venue checks passed and the complete suite passed 2,301 tests, including the independently published feed release. Lint, TypeScript and production build passed. Postbuild skipped demo population. Exact-commit deployment and cleanup results are recorded after execution.
- Existing source-shape tests were updated to require the explicit dancer guard rather than the former authentication-only call. No failing security assertion was removed to make the suite pass.

## Limits and follow-up

The fix commit `5db6de15bbd5e5d9746f2c21a901286ecd980c92` reached Vercel success and passed safe production health, anonymous authorization, callback and 30 Supabase readiness checks at 12:27 UTC. The committed cleanup then repaired exactly two active accounts and passed metadata/role/state preservation checks. A separate read-only verification confirmed no active self-pause markers remained, the current paused marker remained, and the migration ledger matched the committed SQL. The verified migration is frozen in the history baseline by this same-step follow-up, whose release checks and deployment must also pass before Step 7.

No destructive tests or real-user impersonation were performed in production. Disposable staging accounts remain undesignated; runtime fixtures are not represented as full live Auth/cross-device tests. Fresh aggregate/provider metadata reads and safe deployed unauthenticated probes complement the fixtures.

Account-state changes still span the application database and Auth API; this step does not claim transactional protection against every concurrent administrative change. That operation's broader transaction/reconciliation design remains part of the database and admin reviews. Previously issued signed upload URLs and access tokens retain their provider-defined lifetime; these request guards prevent new authorization, not retroactive revocation of already issued credentials.

Metadata semantics were checked against the primary [Supabase Auth implementation](https://github.com/supabase/auth/blob/master/internal/models/user.go), which merges supplied keys and deletes explicitly null keys.
