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

## 1. Executive summary

**FIXED / VERIFIED HARDENED.** The initial configuration already protected private
accounts, verification documents, financial records and privileged functions.
Confirmed weaknesses in notification provenance, hidden-venue deal visibility,
shuttle retry identity and dancer media delivery have been corrected. Two related
publication/reenablement defects found during media compatibility testing were
also fixed before the final verification.

The application and forward migrations are deployed. The final production catalog
was captured at **2026-09-13 00:50:28 UTC**. All 84 public base tables have RLS;
the reviewed access comparison, function security gate and API readiness checks
pass. Production media delivery succeeds with private buckets. Existing customer
records and media objects were preserved.

**MANUAL ACTION REQUIRED:** complete revocation of *historical Storage signed
links* requires Supabase support. New application links check current visibility
on every request, including requests using a saved URL. Old direct signed links
are a separate provider capability. Until those have expired or been revoked, an
absolute claim that every previously issued URL stops working on account pause
would be incorrect. This is the remaining obstacle to fully certifying the
user's requested historical-link privacy guarantee.

## 2. Findings and disposition

The master table above preserves the findings recorded before implementation.

| Finding | Severity | Disposition |
| --- | --- | --- |
| SB1 — notification payloads writable by recipient | MEDIUM | **FIXED:** browser UPDATE is limited to `read_at`. |
| SB2 — deals exposed for hidden venues | MEDIUM | **FIXED:** public reads require an active, published venue. |
| SB3 — stale access baseline and missing column ACL comparison | LOW | **FIXED:** current policies, helper definitions and exact column privileges are verified. |
| SB4 — deletable shuttle handoff identity | HIGH | **FIXED:** concurrent architecture delivery added durable request identity, atomic handoff and narrow service grants; verified here. |
| SB5 — media remains accessible after privacy changes | MEDIUM | **FIXED** for current application delivery and public bucket URLs; **MANUAL ACTION REQUIRED** for historical provider signed links. The user explicitly required paused accounts' media to become inaccessible. |
| SB6 — historical migration and recovery certification limits | INFORMATIONAL | Documented operational limits; historical migration replay remains quarantined. |

Two related defects were confirmed during targeted compatibility tests, before
the final full verification:

| Finding | Severity | Failure and root cause | Disposition |
| --- | --- | --- | --- |
| SB7 — public media policy disagrees with established publication rules | MEDIUM | Approved, verified and explicitly public dancers without venue affiliation appear in the application, but the profile/photo read policies still required `venue_approved_at`. The new checked photo endpoint correctly denied these rows. | **FIXED:** two SELECT policies now match the existing application contract; private columns and owner/admin branches remain protected. Migration and role tests required; no Dashboard action. |
| SB8 — reactivation loses public state for unaffiliated dancers | MEDIUM | Hosted pause/resume testing showed the saved public state was not restored because the transition function also required venue approval. | **FIXED:** remove that prerequisite in the existing function's assignment and consistency assertion. Retain verified approval, pause ownership, locks, suspension controls and service-only execution. Migration and lifecycle tests required; no Dashboard action. |

No critical finding was confirmed. The final full verification discovered no
additional security or integrity defect after these corrections.

## 3. RLS changes

**FIXED:**

- `notifications`: revoke broad authenticated UPDATE and explicitly grant only
  `UPDATE(read_at)`. Existing own-row SELECT/DELETE, administrator INSERT and
  server delivery operations continue to work.
- `club_deals`, `Active club deals are public`: require the referenced venue to
  be active and have `published_at`. Production role probes confirmed 17 public
  offers remain accessible and three hidden-venue offers are excluded.
- `dancer_profiles`, `approved public dancers are public`: public access requires
  approved status, approved verification, explicit publication and no disabling
  timestamp. Venue affiliation is no longer incorrectly required.
- `dancer_photos`, `approved photos are public`: require an approved photo and
  the same public profile conditions; preserve trusted owner/admin access.
- `storage.objects`: add the restrictive SELECT policy
  `Dancer media reads require checked delivery` for anon/authenticated. Existing
  permissive policies cannot bypass it for dancer photos or TV objects.

**VERIFIED HARDENED:** all 84 public base tables have RLS. The final catalog
exactly matches 140 reviewed public policies, 15 Storage policies, relation CRUD
grants, view security and 184 explicit public column privileges. Sensitive
account identifiers, legal names, moderation fields, precise location data,
financial values and private analytics remain excluded from public projections.

## 4. Roles, authorization and ownership

**VERIFIED HARDENED:** Auth UUIDs map to protected application accounts, with
`auth.uid()` ownership helpers for dancer and venue records. Browser-controlled
metadata does not confer administrator or venue management privileges. Active
database roles and explicit venue team permissions govern server actions.
Browser roles cannot create schema objects, grant roles or bypass RLS. Role
attributes and memberships are unchanged between initial and final captures.

The account transition correction changes restoration eligibility only. It
cannot restore a later administrator/DMCA suspension, overwrite an independent
publication decision or grant a different account's pause permission. Native
tests cover those cases, private-state preservation and unauthorized RPC calls.

## 5. Storage and media delivery

**FIXED:** `dancer-photos` is private; `mydancr-tv-videos` remains private.
Photos, avatars, responsive variants, thumbnails, TV videos and posters now use
application endpoints that authorize each request. Public requests use anonymous
Postgres RLS. Video delivery additionally verifies current account state. Scoped
management previews recheck active account state and cannot bypass account pause.

The server streams authorized bytes without redirecting the browser to a Storage
signed URL. Responses, including errors and HEAD requests, prohibit browser/CDN
reuse. Video byte ranges remain supported. Path validation, exact database object
matching, responsive manifests, transform allowlists, deadlines and byte ceilings
bound the server's privileged read. Uploaded originals and stored derivatives
were not moved, deleted or rewritten.

Browser roles cannot directly read or mint new Storage read links for the two
media buckets. Existing server-mediated uploads, immutable upload paths and
authorized deletions remain in place. The recovery tests use synthetic objects
and remove only their own fixtures.

Both production bucket cache purges were accepted at **00:49:45 UTC**. After the
propagation window, the previous public photo endpoint returned a denial while
new photo/thumbnail/poster endpoints returned 200 and video range requests 206.
Dynamic dancer/profile/feed metadata now also uses `private, no-store`.

**VERIFIED HARDENED:** seven private buckets cover dancer photos, TV, originals,
moderation staging/review, verification documents and venue ownership proofs.
Only venue covers, logos and QR artwork remain intentionally public.

**MANUAL ACTION REQUIRED:** old direct Storage signed URLs may remain valid.
Supabase uses a separate internal Storage signing key; Auth JWT rotation does not
revoke those URLs. Its documented revocation path is support.
[Supabase signed-link documentation](https://supabase.com/docs/guides/storage/serving/downloads)
Cache purging is separate and does not recall existing browser caches or downloaded
copies. [Supabase cache purge documentation](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache)

## 6. Database integrity, atomicity and retries

**FIXED:** `club_shuttle_requests` retains an immutable request UUID, request hash
and bounded notification payload independently of inbox deletion. Its primary key
prevents duplicate request identities. Checks require a 64-character lowercase
hex hash and a bounded JSON array. `handoff_club_shuttle_request(uuid)` locks the
request, creates the expected notification rows and marks handoff atomically.
Retries do not recreate a deleted recipient inbox item. Server privileges permit
SELECT, INSERT and `UPDATE(handed_off_at)` only.

The durable request's venue/deal IDs intentionally preserve historical attribution
without introducing cascades that erase request history. No broad foreign key,
delete-action, nullability, timestamp or status redesign was added.

**VERIFIED HARDENED:** the one focused integrity review found zero missing primary
keys, unvalidated foreign keys, SET NULL/required-column conflicts, dancer-role
mismatches, shift-affiliation mismatches or video/shift ownership mismatches.
Duplicate active sessions, scheduled-date identities, photo storage paths and
case-insensitive dancer slugs were zero. Existing follow/favorite, redemption,
payment/webhook and publication constraints/atomic routines were retained.
One inactive historical deal falls outside an existing not-yet-validated liquor
check; there are zero active exceptions. Historical data was not rewritten.

## 7. RPC and function changes

- **FIXED:** `handoff_club_shuttle_request(uuid)` is service-only and executes as
  invoker. It adds real atomicity without another SECURITY DEFINER function.
- **FIXED:** `transition_own_account_safely(uuid,text)` restores an unaffiliated
  dancer's previous legitimate public state. A fingerprint guard ensures the
  forward migration changes only the reviewed existing definition. Its empty
  search path, lock timeout, permissions and authorization checks are preserved.
- **VERIFIED HARDENED:** 148 public functions, including 108 existing definers;
  six anonymous interfaces and nine authenticated interfaces pass the existing
  function security gate. Only the two expected function definitions differ from
  the initial capture. No function was opened to a new browser role.

## 8. Service-role review

**VERIFIED HARDENED:** privileged credentials remain server-side. The production
build's public-output scanner passed over 274 files, including 250 text files.
The new media URLs contain neither provider keys nor direct provider read tokens.
Management preview signatures use a server-held secret and bind the exact
resource and expiry. The established admin client remains server-only.

Privileged endpoints verify authenticated identity and protected role/account
state, with resource ownership and venue permissions where applicable. Public
media endpoints expose only currently authorized object bytes. Public forms use
their existing validation and abuse controls; payment webhooks validate provider
signatures and scheduled handlers require their configured secret.

## 9. Index and query changes

**FIXED:** the durable shuttle request primary key supports atomic ID lookup.
No speculative indexes were added. The final catalog has 279 public indexes;
the only new one is this primary-key index. Existing indexes remain valid/ready.

Media checks use bounded exact path/UUID queries. Video management serializers
avoid issuing provider signed-URL batches. Existing query bounds, workspace
ordering and metrics behavior remain covered by focused compatibility tests.

## 10. Forward migrations and delivery

All seven migrations below are recorded in production and match their normalized
version-controlled SQL exactly. The two shuttle migrations were delivered by the
concurrent architecture task; the other five are this hardening work.

| Migration | Purpose |
| --- | --- |
| `20260912232600_preserve_club_shuttle_requests.sql` | Durable, atomic shuttle handoff |
| `20260912234500_limit_notification_updates_to_read_marker.sql` | Protect notification provenance |
| `20260912235000_scope_public_deals_to_published_venues.sql` | Respect venue publication |
| `20260913000500_narrow_shuttle_service_grants.sql` | Restrict inherited service privileges |
| `20260913003000_require_checked_dancer_media_delivery.sql` | Private buckets and restrictive direct-read boundary |
| `20260913004500_align_public_media_with_profile_publication.sql` | Preserve legitimate unaffiliated public media |
| `20260913004600_preserve_unaffiliated_dancer_reactivation.sql` | Restore saved public state after self-pause |

Application delivery commits include `3572b4c9` (notification fix, delivered through
`de3d39bf`), `86657ab3` (deals), `8972775e` (access verification), `da540df3` (media)
and `2cebff24` (publication/reactivation). Each was committed and pushed.
Exact-commit Vercel success was confirmed for the media release
[`da540df3`](https://vercel.com/ai-movie-jobs/shiftstage/8FUyX5mcuQnzZHG8a18A62g8KmnC)
and the resulting application revision
[`2cebff24`](https://vercel.com/ai-movie-jobs/shiftstage/9DXXDjfDehWBN5b4kUNbbuKJWAnk).
Report-only delivery is recorded by the closing task response.

Historical migration collisions and unrecorded files were not replayed. The final
inventory contains 181 migration files / 176 distinct versions; the same four
historical collision groups and 39 unrecorded files remain quarantined. New fixes
were applied individually with short lock/statement limits and preservation
assertions, first in recovery where applicable.

## 11. Tests and application compatibility

**VERIFIED HARDENED:**

| Evidence | Result |
| --- | --- |
| Notification native role tests | 5 passed |
| Notification hosted recovery checks | 14 passed, synthetic identities cleaned up |
| Deal publication/owner/admin tests | 5 passed; production role probes preserve 17 public offers and deny 3 hidden offers |
| Initial refreshed access fixture tests | 126 passed |
| Storage/media focused tests | 74 passed |
| Media release compatibility tests | 1,779 passed, zero failures/skips |
| Publication/updated role matrix | 98 passed |
| Media/publication targeted tests | 13 passed |
| Reactivation/lifecycle tests | 76 passed, including independent suspension/decision protection |
| Final hosted media journey without venue affiliation | 17 checks passed at 00:47:30 UTC; all synthetic objects/users removed |
| Production media after private-bucket cutover | Photo, resized thumbnail, poster 200; video range 206; old public object URL denied |
| Final live catalog/access comparison | 22 checks passed |
| Final API readiness | 62 checks passed |
| Final live function/role security gate | Passed; no privileged application function invoked |

These test groups overlap; their counts are not added into an inflated total.
The concurrent architecture release also passed the full 9,431-test suite at
`8972775e`. After the media implementation, full route type generation,
TypeScript, lint, production build and public-build security scan passed with
Node 24.21.0 / npm 11.19.1. Subsequent changes were SQL, fixtures and targeted
tests; their exact Vercel build also succeeded.

Compatibility coverage includes auth/signup/provisioning/login/logout/reset
handling; dancer/venue profile authorization; schedules/check-ins; media
upload/publication/read/deletion; follows/favorites; deals/redemptions; admin and
analytics boundaries; notification delivery and shuttle retry behavior. These
are native automated, hosted recovery and bounded production-read checks as
identified above. This is not a claim that every role's entire browser journey,
external password-reset email delivery, payment settlement or mobile network
experience was manually exercised in production. No real account was paused for
testing and no production signup, financial mutation or outgoing message was
generated by this audit.

## 12. One final full Supabase review

**VERIFIED HARDENED:** the mandatory final pass covered RLS/CRUD and column ACLs,
ownership, roles/admin, public/private projections, service-role boundaries,
function definitions and privileges, Storage, views, constraints, atomic flows,
indexes, lifecycle, Realtime and migration consistency. Final catalogs have
84 public tables, two views, no materialized views, 155 public/Storage policies,
148 public functions, 581 public constraints and 279 public indexes. Only the
expected new shuttle relation/constraints/index, notification grants, four policy
changes and two function changes differ from the initial capture.

No new Realtime exposure or pg_cron jobs exist. The protected application cron
handlers remain in place. Auth/profile aggregate drift remains zero missing app
accounts, zero orphan app accounts and zero confirmed-email mirror mismatches.
The single already-known missing dancer profile remains eligible for existing
authenticated login recovery; no invented profile data was inserted.

The first role-membership export timed out while the CLI initialized its login
role. Only that export was retried; it succeeded and showed unchanged role
attributes/memberships. No full audit was restarted after any small fix.

The final pass found no additional issue. The one focused integrity review was
performed once after the related integrity fixes. Work stops after delivery of
this report; no recurring scan or background watcher was created.

## 13. Manual actions required

**MANUAL ACTION REQUIRED — Supabase support:** submit the prepared
[Storage signed-link revocation request](supabase-storage-link-revocation-request.md)
and obtain confirmation that historical dancer-media signed URLs have been
invalidated. Coordinate any project-wide impact on short-lived administrative
document previews and uploads. After support acts, recheck only the affected
media boundary and purge the two media bucket caches again if requested.

No outstanding Dashboard toggle, Storage bucket change, new environment variable,
Auth setting change or Vercel deployment is needed for the implemented fixes.
Changing Auth JWT keys is not a substitute for Storage signed-link revocation.
The support request is prepared and has **not** been sent to a third party.

## 14. Remaining risks and verification limits

- **MANUAL ACTION REQUIRED:** an unexpired historical direct signed URL can bypass
  the application's new per-request checks until provider revocation/expiry.
  Existing downloaded copies and browser caches cannot be remotely recalled.
- Historic migration provenance still prevents a blanket claim of clean migration
  replay. Use the documented recovery process; do not run all historical files.
- Backup configuration alone does not certify restored media bytes or external
  email/payment delivery. Those require separate operational exercises.
- The existing inactive historical constraint exception and missing-profile
  recovery case were retained deliberately rather than altering customer history.

## 15. Optional future improvements

**OPTIONAL FUTURE IMPROVEMENT:** schedule an isolated restore rehearsal that checks
database and Storage bytes, and exercise email/payment providers with their test
facilities. Measure real mobile playback and server egress after checked delivery;
per-request privacy removes shared caching, so use observations to guide any
future optimization. Keep future migration/access fixtures synchronized with
reviewed changes. These are separate from the implemented hardening fixes.

External metadata and validation receipts, without committed credentials or
customer datasets, remain in
`D:/Codex/MyDancr-validation-2026-09-11/supabase-audit-20260912`.
