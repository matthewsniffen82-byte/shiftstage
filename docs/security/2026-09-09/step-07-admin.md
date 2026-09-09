# Step 7 — Administrative controls and audit integrity

## Confirmed findings

| Severity | Finding | Change |
| --- | --- | --- |
| HIGH | An administrator can disable a dancer profile while leaving its login account active. `/api/account` reactivation then calls the owner-authorized publication transition, which previously removed that administrative suspension. Repeated self-pause/resume has the same effect. | Track administrative suspension separately in a private database column. Only an active admin can clear it. Owner reactivation may resume the login account while keeping the moderated profile disabled and private. The atomic function and its compatibility path enforce the same rule. |
| MEDIUM | Live `admin_actions` grants and its `FOR ALL` policy allow an active admin session to forge another administrator's event, edit history or delete it directly through Supabase. | Browser roles receive read-only access, constrained to active admins. Remove browser write, truncate, reference and trigger privileges, including column writes. Server writers and existing privileged database operations retain access. |
| LOW | Two admin POST handlers replace authorization errors with generic errors, returning 500 instead of 401/403. This also prevents the admin client from recognizing an expired or unauthorized session. | Preserve the original error through the existing safe response policy. No provider messages are newly exposed. |

## Review scope and retained controls

All 28 admin route files and their 50 exported methods were reviewed against the source inventory. Their shared boundary verifies the Auth identity and queries the current `app_users` role/state before privileged work. Runtime tests cover every method with customer, dancer, venue, missing-account, anonymous, disabled-admin and deleted-admin identities. Browser role and target hints confer no authority. The admin pages render a sign-in/client shell; private records arrive only from protected APIs. Public HTML is not treated as admin authorization.

Profile approvals/rejections, lifecycle actions, profile/media deletion, reports, venue review/access codes, NFC provisioning, TV moderation/import, DMCA, finance/referral fees, sales agents and support were traced to their handlers and helpers. Mutations use explicit POST/PATCH/DELETE requests and bounded bodies where applicable. Existing confirmation prompts and required reasons remain. No administrative GET was found to perform a destructive action.

Admin creation requires the existing server-side bootstrap credential, constant-time comparison and auth throttling; trusted provider metadata is set only after that check. The database provisioning trigger ignores client role claims, and public account-role writes remain revoked. The review does not change the owner's established password policy or silently enroll/lock administrators into MFA. Supabase's TOTP capability was previously observed, but mandatory admin enrollment/AAL2 is not implemented; plan enrollment and recovery before enforcement. No credential was exposed or rotated.

Existing action records include approvals, lifecycle changes, deletion, report resolutions, venue changes, NFC operations, DMCA actions and financial/referral/agent operations. Image moderation also stores reviewer/time/decision and emits a minimal event. Financial audit tables already deny browser writes and retain their stronger implementation. This step protects the central admin event history; it does not claim protection against a compromised service-role key or database owner. Some multi-system actions write their audit event after the main operation; coverage, transaction/reconciliation gaps and retention remain explicit Step 22 review items.

## Database rollout and privacy

Fresh read-only production preflight found zero disabled dancer profiles, zero historical dancer lifecycle events and zero removed-profile reports. Migration `20260909124600` locks the profile table briefly and refuses to apply its new column if an existing suspension population requires provenance review. It performs no historical user-data repair. The new nullable `admin_disabled_at` column is withheld from browser roles and is not added to public API output. Existing ownership, approval, account-state, row-lock order and service-only function-execution checks remain.

The current live publication function was compared with the historical source used in the tests. Their complete SQL token streams match; differences are only formatting/comments. Its live pre-change definition MD5 is `709084c5c18fb6101c83ac3e7afe603a`. Deployment preflight must reject a different definition rather than overwrite an intervening change.

Migration `20260909124500` replaces only the central audit table's broad policy and browser grants. Existing records are preserved. The `ON DELETE SET NULL` foreign key still anonymizes a removed admin's identifier while retaining the action record. Server-only inserts retain generated IDs and timestamps. No verification documents, contact information, passwords or tokens are added to the log.

Publish the compatible application change, verify its exact Vercel commit, apply only these committed migrations with bounded transactions and their own ledger entries, then verify metadata, role boundaries and health. Freeze each applied SQL hash afterward in the same step's delivery follow-up. Do not replay historical migrations. An application rollback must preserve the new database protections; undoing administrative suspension provenance would weaken security and requires a separately reviewed correction.

## Regression evidence and limits

- 352 runtime admin-boundary tests cover 50 actual route methods plus active-admin refresh/non-refresh success. Before the response fix, 14 denied requests returned 500; after it, all expected 401/403 responses pass before privileged work or body consumption.
- Four isolated PostgreSQL audit tests reproduce the old forgery/edit/delete permissions, then verify browser denial, active-admin reads, inactive/forged-role denial, server inserts, historical-record preservation and account-deletion anonymization.
- Seven suspension tests reproduce the old bypass and verify direct/repeated self-service attempts, moderation during an account pause, authorized admin restoration, direct database denial, column privacy, migration preflight and the missing-function compatibility path. One runs the actual account self-service and publication modules against synthetic PostgreSQL data.
- Production probes are read-only metadata or unauthenticated requests. No real account was impersonated or suspended, and no production audit records were modified to test access. Disposable staging accounts remain undesignated. Full release checks and live migration/deployment results are recorded in the execution ledger.
