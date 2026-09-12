# Supabase hardening audit — 2026-09-12

Initial application baseline: `bdf4111e1becd1f511a2cd99c2c0dd0e83178365`.
One initial audit was completed before implementation. Fixes receive targeted
checks; one final full verification follows. Concurrent user tasks are preserved.

## Initial system map and evidence

The production project is Dancr (`hfmzwadzabmgxkjzmqun`). The existing recovery
project is separate (`cwpsrrjhrkedwtyatntv`). Initial read-only metadata was
captured at 23:27 UTC; column ACLs, memberships and operational metadata followed
in the same initial audit. No customer records or credentials were exported.

- 83 public base tables, all with RLS; two views; 147 public functions, including
  108 SECURITY DEFINER functions; 154 public/storage policies; 578 public
  constraints and 278 public indexes. Every captured index is valid/ready.
- `auth.users.id = app_users.id`; dancer/customer records belong through unique
  `user_id`. Authoritative account role/state live in protected `app_users`.
  Signup accepts public customer/dancer roles; admin and venue provisioning
  require validated invitations/codes and trusted application metadata.
- Venue ownership is `venues.owner_user_id`; manager/staff membership uses
  `venue_team_members`. Server access checks the active actor, venue and precise
  permission. RLS ownership helpers derive identity from `auth.uid()`.
- Public discovery uses approved/public dancer profiles, approved photos/social
  links, posted schedules, public venue artwork and deal projections. Legal
  names, account identifiers, raw location coordinates, moderation details and
  financial fields have restricted column grants. The public profile view uses
  invoker security; the aggregate impact view is service-only.
- Private domains include accounts, verification/moderation, support, notifications,
  referrals/NFC, venue teams, analytics, financial ledgers and copyright records.
  The initial shuttle implementation stored the handoff only in notifications;
  the concurrent architecture task owns its durable-request correction.
- Ten buckets: four public artwork buckets (`dancer-photos`, venue covers, logos,
  QR codes); six private buckets for verification, ownership proofs, originals,
  moderation staging/review and TV. Ordinary users cannot write Storage directly.
  Server-created paths and scoped signed upload tokens mediate legitimate uploads.
- Nine browser-callable functions: two actor-role helpers, two ownership helpers,
  two pure predicates/formatters, a computed public deal predicate and two
  authenticated administrator-only financial/redemption functions. Other public
  functions are service-only or owner-only. The existing live function security
  gate passed, including ownership, execute permissions and explicit search paths.
- No Realtime publication entries, application subscriptions or installed pg_cron.
  Five authenticated Vercel cron handlers perform existing scheduled work.
- Server-only service client, verified Auth identity, protected role lookup and
  route-level ownership/permission checks form the privileged API boundary.
  Public endpoints are intentionally narrow, validated and rate limited; provider
  webhooks authenticate signatures and cron routes require their secret.
- Time/response bounds, conflict-safe provisioning, unique social relationships,
  atomic redemption/payout/webhook/publication routines and worker claim checks
  already exist. No blanket indexes, NOT NULL changes or schema redesign is needed.
- 174 migration files at baseline, 132 live ledger versions. Four historical
  version-collision groups and 39 unrecorded historical files remain quarantined;
  this is not evidence that all 39 effects are absent. All later recorded fixes
  must be applied individually; neither historical replay nor mass ledger repair
  is authorized by a successful migration-hash check.

Initial API readiness passed 62 checks. Supabase Auth configuration preserves the
exact production callback, email confirmation, SMTP, token rotation and the
existing session policy. No credential or provider configuration is weakened.
One active dancer account lacks a profile; verified login already invokes the
existing missing-profile recovery transaction. There are no missing app accounts,
orphan app accounts or confirmed-email mirror mismatches. The absent profile is
not automatically published or backfilled with invented personal information.

## Initial master findings

| ID | Severity | Component / realistic failure | Smallest fix | Required action |
| --- | --- | --- | --- | --- |
| SB1 | MEDIUM | `notifications`: recipients can update IDs, message content, payload and delivery timestamps, although their supported operation only changes `read_at`. A recipient can alter a saved pickup's displayed details or undermine the original retry identity. Ownership RLS prevents changing another recipient's row, but does not protect message provenance. | Revoke general browser UPDATE and grant UPDATE on `read_at` only. Preserve SELECT, own DELETE, admin INSERT and server delivery. | Forward migration plus targeted role tests; no Dashboard step. |
| SB2 | MEDIUM | `club_deals` / `Active club deals are public`: checks only the deal flag. Initial read-only anonymous SQL confirms three active deals belonging to hidden venues remain queryable. | Correlate the public policy with an active, published venue. Preserve explicit venue-owner/admin reads. | Forward migration plus publication/owner role tests; no Dashboard step. |
| SB3 | LOW | `check-supabase-access` baseline predates deployed ownership helpers, column restrictions and private lifecycle tables, so production fails its comparison despite those valid repairs. Column ACLs are outside this comparison. | Refresh reviewed metadata and include exact column-privilege verification; retain detection of unexpected access changes. | Code/fixture/tests; no database mutation. |
| SB4 | HIGH | Initial shuttle contact data exists only in deletable inbox rows; retry can recreate delivery. | Durable immutable request identity and atomic inbox handoff. | Concurrent **Arch and stability** task owns implementation and delivery. Verify its resulting database boundary here. |
| SB5 | MEDIUM | Published image URLs remain accessible after a profile becomes private because artwork buckets are public. This is inherited Storage delivery behavior, not an RLS bypass for verification documents. | Preserve existing working media. Decide whether private-profile changes must revoke previously shared URLs before a compatible delivery/cache migration. | Product retention decision; no automatic bucket flip. |
| SB6 | INFORMATIONAL | Historic migration provenance and backup availability do not prove clean replay, restored Storage bytes or end-to-end email/payment delivery. | Keep known limits and use an isolated recovery rehearsal for operational certification. | Operational follow-up; no destructive production action. |

No new critical issue or demonstrated cross-account private-record bypass was
confirmed in the initial audit. No new foreign key, financial-state redesign,
index or broad role-policy rewrite is justified by these findings.

## Coverage

The initial pass covered all requested topics: table/operation RLS and ownership;
roles/admin/anon/authenticated exposure; service clients and callers; callable
functions, definer privileges, search paths and dynamic SQL; buckets/path/signed
URL ownership; foreign keys/delete actions/uniqueness/checks/nulls/defaults;
timestamps/triggers; referral/financial atomicity and retry identity; query/index
bounds; Realtime; signup/email/password/deletion lifecycle; sensitive verification;
views; schema/default/function grants; migration provenance and environment drift.
Metadata, native SQL fixtures, API reads and hosted provider journeys are separate
evidence categories. No synthetic production account, payment or outgoing message
is needed for the two database fixes.

## Fix and final verification evidence

Pending implementation and final verification. This document does not yet claim
delivery or production readiness. External evidence is retained in
`D:/Codex/MyDancr-validation-2026-09-11/supabase-audit-20260912`.
