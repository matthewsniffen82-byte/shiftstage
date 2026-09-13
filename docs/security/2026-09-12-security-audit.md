# MyDancr security audit — September 12, 2026

## Executive summary

**FIXED:** notification identity and pickup-detail exposure, two database
permission issues, and current dancer-media delivery after pause/disable.
The audited controls passed the checks described below. No unresolved critical
or high vulnerability was demonstrated within this scope.

**MANUAL ACTION REQUIRED:** Supabase must revoke historical direct Storage signed
links to complete the requested historical-link privacy guarantee. Current
application links and former public-bucket URLs are protected. This is a bounded
assessment, not an unconditional production security certification; the remaining
provider action, credential-scope and operational limits are explicit below.

Exactly **one initial full scan** and **one final full scan** were performed.
Individual fixes and changes arriving from concurrent tasks received targeted
retests. The full audit was not restarted after each fix.

## Scope, architecture and initial evidence

Initial revision: `bdf4111e1becd1f511a2cd99c2c0dd0e83178365`.
The application uses Next.js App Router on Vercel, a generated HTML/JavaScript
shell, Supabase Auth/Postgres/Storage, server-side media processing, Stripe,
Resend and optional OneSignal/NATS integrations. Browser sessions authenticate
API calls using bearer tokens; Supabase `getUser` validates server identity.
Privileged clients are server-only. Mutations use HTTP handlers and database
functions; no Next server-action or Supabase Edge Function entry points were found.

The initial scan covered 119 API route files / 190 HTTP handlers, 665 tracked
application/configuration/migration sources and 174 migration files. It reviewed
authentication, role/ownership boundaries, every sensitive route, RLS/grants,
functions/triggers/views, storage/uploads, admin operations, public projections,
input/output handling, headers, credentials, dependencies and provider settings.
The initial selected security suite ran **200 files / 4,250 tests: all passed**.

Fresh production metadata initially contained 83 public tables, all with RLS,
140 public policies and 182 column grants. A local PostgreSQL-compatible fixture
loaded current production policies and synthetic records: **1,357 assertions
passed**. This is policy execution, not just frontend inspection. Production
queries in this thread were read-only; no real accounts, payments, messages,
uploads or customer records were changed or exported by this audit thread.
The coordinated database task applied the reviewed forward migrations and used
separate recovery-project test accounts, which it cleaned up.

## Initial master findings

| ID | Severity | Affected area | Confirmed issue / realistic scenario | Required fix and status |
| --- | --- | --- | --- | --- |
| SEC-01 | HIGH when push is configured | `src/lib/dancr/notification-delivery.ts`, `customer-notification-delivery.ts`, notification API | Customers used keyed opaque aliases, but dancer/venue/admin push recipients used raw account UUIDs. A client knowing a professional account ID could claim it as an unverified OneSignal external ID and receive that account's alerts. Reproduced using synthetic provider calls, without touching real subscriptions. | **FIXED:** use the existing keyed alias for every role; expose only the active verified caller's alias. Code plus conditional re-enrollment of existing professional subscriptions. |
| SEC-02 | MEDIUM when external shuttle alerts are configured | `club-shuttle-requests.ts`, `notification-delivery.ts` | Guest name, phone, email and precise pickup location were copied into push bodies/data and SMS, exposing unnecessary details through providers and notification previews. | **FIXED:** generic alerts link to the authenticated venue dashboard; full details remain in the authorized inbox. Code only. |

No critical vulnerability was confirmed in the initial scan. The final Vercel
project environment inventory contained no OneSignal application, REST or SMS
configuration, so these were confirmed dormant code paths, not evidence of an
active production push compromise. No private values were requested or displayed.

## Remediation and final-scan discoveries

**FIXED — Notification delivery**, commit
`db25048ffc246ea4293db6a731a1b5a6487805c4`:

- Applied the existing HMAC alias scheme to customer, dancer, venue and admin
  delivery. Existing customer aliases are unchanged; no additional library.
- Notification GET requires an active verified account, returns its own enrollment
  capability and sets `Cache-Control: private, no-store`.
- Shuttle push carries a generic message and only its non-sensitive kind; SMS
  contains a generic dashboard link. Private inbox functionality is retained.
- Tests exercise all four roles, another supplied account ID, unauthenticated
  access, and synthetic push/SMS payloads containing malicious disclosure probes.

The final scan incorporated these genuine additional findings from the
concurrent Supabase audit, followed by targeted verification:

| ID | Severity | Affected component | Issue / attack scenario | Status |
| --- | --- | --- | --- | --- |
| SEC-03 | MEDIUM | `public.notifications` column privileges | A recipient could change its message ID, body, payload and delivery timestamps, undermining message provenance and altering saved pickup details. RLS restricted rows but did not restrict editable columns. | **FIXED:** revoke full-row and legacy column UPDATE grants; authenticated users may update only `read_at`. Own read/delete and service delivery remain available. |
| SEC-04 | MEDIUM | `club_deals`, `Active club deals are public` policy | The deal's active flag alone exposed offers associated with withdrawn/unpublished venues; three hidden-venue offers were initially reachable anonymously. | **FIXED:** public reads also require the corresponding venue to be active and published. Explicit owner/admin management reads remain. |
| SEC-05 | MEDIUM | Dancer photo/video URLs, Storage and public response caching | Previously issued public artwork URLs and direct signed video URLs could continue serving media after an account was paused/disabled. The owner clarified that media must become private until re-enabled. | **FIXED** for current application delivery and public-bucket URLs: private buckets, checked streaming and no-store responses. **MANUAL ACTION REQUIRED** for historical provider signed links. |

The coordinated media task also corrected two compatibility defects exposed by
the new checks: public photo policies incorrectly required venue affiliation,
and self-reactivation could lose an unaffiliated dancer's saved public state.
Both corrections retain verified approval, explicit publication, owner/admin
boundaries and independent suspension checks. Their scope and tests are detailed
in the [Supabase report](../supabase-hardening-audit-2026-09-12.md).

Related concurrent work was preserved and reviewed: durable immutable shuttle
requests and atomic inbox handoff, post-response best-effort external alerts,
request-scoped venue permission-query deduplication, recovery for failed schedule
saves/public-profile secondary queries, and bounded NATS invoice responses that
preserve uncertain-dispatch handling. NATS now reads at most 64 KiB with an
existing 15-second deadline instead of buffering an unbounded provider body.
These changes were authored by the other active tasks, not presented as this
thread's initial findings. Unrelated navigation/video changes were preserved.

## Supabase / database

**VERIFIED SAFE within the tested boundaries:** the final captured catalog had
84 public tables with RLS, 140 public policies and 183 column grants before the
two final permission fixes. Current-policy tests passed **1,373 assertions**.
The live function gate passed for **148 public functions**, including 108
SECURITY DEFINER functions; six anonymous and nine authenticated interfaces were
explicitly reviewed. No unexpected browser execution, unsafe privileged role
membership or unreviewed definer search path was detected. All **62 API/schema
readiness checks** passed.

Forward migrations incorporated and independently confirmed in production:

- `20260912232600_preserve_club_shuttle_requests.sql`: durable service-only
  request table with RLS and atomic `handoff_club_shuttle_request` function;
  replay does not recreate a deleted inbox handoff or repeat external alerts.
- `20260912234500_limit_notification_updates_to_read_marker.sql`: UPDATE limited
  to `read_at`; no row deletion, data rewrite or schema incompatibility.
- `20260912235000_scope_public_deals_to_published_venues.sql`: restrict the public
  deal policy without changing owner/admin reads or stored offers.
- `20260913000500_narrow_shuttle_service_grants.sql`: remove inherited service
  DELETE/full UPDATE; retain receipt creation and UPDATE on `handed_off_at` only.
- `20260913003000_require_checked_dancer_media_delivery.sql`: make dancer media
  buckets private and block direct browser reads/signing through a restrictive
  Storage SELECT policy, preserving all stored objects.
- `20260913004500_align_public_media_with_profile_publication.sql`: align public
  dancer/photo reads with verified, explicitly public profile status.
- `20260913004600_preserve_unaffiliated_dancer_reactivation.sql`: restore the
  prior verified public state without adding a venue-affiliation prerequisite;
  preserve the existing transaction, locks and service-only execution.

The final targeted production check independently confirmed both permission
fixes, service notification UPDATE access, no browser SELECT on durable shuttle requests,
**zero hidden-venue offers exposed**, and **17 intended public offers visible**.
The resumed targeted production check confirmed the remaining four migrations,
both private media buckets, restrictive browser SELECT, service-only reactivation
with an empty search path, and shuttle UPDATE limited to `handed_off_at`.
All seven migrations are applied; no payable referral state was changed.

The initial ten-bucket configuration had four public artwork buckets and six
private buckets. The dancer-photo bucket is now private as well; venue artwork
keeps its established delivery. Dancer images, variants, posters and video use
application endpoints that check current visibility on every request and disable
browser/CDN caching. Signed management previews are resource-bound, expire and
cannot override a disabled account. Byte/range streaming, type/size bounds and
upstream error suppression preserve playback without disclosing service keys.
Direct browser writes remain restricted. Original media bytes were preserved.
Tests cover upload ownership, image decoding/pixel bounds and video processing
limits. Historical provider signed links remain the exception described below.

## Authentication / authorization

**VERIFIED SAFE within tested flows:** server identity is validated, account
role/state come from protected `app_users`, and active-admin checks protect
privileged handlers. Venue ownership/team permissions and dancer ownership are
derived from the verified actor, not supplied IDs or roles. Tests cover
cross-account denial, elevated-role attempts, protected APIs, login/signup,
reset, refresh, stale sessions, redirects, suspension and account deletion.
No demonstrated cross-account private-record or admin bypass remained.

Read-only Supabase configuration inspection confirmed the production site URL,
exact callback allowlist, email confirmation, SMTP, one-minute email spacing,
eight-digit email codes and TOTP capability. Existing 30/90-day inactivity/timebox
settings remain. Real email delivery and cross-device recovery were not exercised
against production accounts. Password-policy limitations are recorded below.

## API, web, referrals and privacy

**VERIFIED SAFE within reviewed paths:** bounded request parsing, parameterized
queries, ownership checks, public serializers and controlled error responses
protect sensitive routes. Targeted durable limits cover realistic public/auth
and paid-provider abuse; no blanket middleware or redundant infrastructure was
added. Cookie-based visitor mutations reject cross-origin/form requests.
Stripe validates raw-body signatures/timestamps and claims webhook events to
prevent duplicate financial effects. Cron handlers require their configured secret.

Production checks covered **23 HTTP requests and 11 private document routes**:
CSP hashes/nonces, nonce uniqueness, frame denial, nosniff, HSTS, referrer policy,
CORS and cache boundaries passed. Sensitive account, admin-finance, dancer
analytics, venue-dashboard and saved-item APIs returned 401 without authentication.
Public dashboard/admin HTML is a sign-in shell, not private account data.

Shuttle submission is a referral/lead handoff, not driver dispatch or proof of
arrival. Server validation/rate limits, immutable retry identity and recipient
permissions remain. Financial referral/attribution/redemption/payout routines
have ownership, transaction and replay/race tests. Retired QR confirmation routes
return 410. Critical billing transitions cannot be set by an arbitrary browser
payload. Existing structured logs/receipts avoid raw credentials and unnecessary
contact information; this work adds no sensitive logging.

## Secret management and dependency changes

**VERIFIED SAFE within the scans:** privileged clients remain server-only.
Tracked-text and accessible Git-history scans suppressed matched contents;
763,901 history-diff lines were examined initially and 764,949 at final scan.
Four pattern matches were deliberate synthetic fixtures in two security test
files. No application credential was found or added to a commit. This does not
attest to unavailable history, third-party logs or inaccessible systems.

The original final build's public-artifact guard passed, including a targeted check
against locally configured secret values without printing them: **272 files,
248 text files, 7,766,452 text bytes**. The resumed build after media integration
also passed its public-artifact guard: **274 files, 250 text files,
7,771,630 text bytes**. No `.env`, credential dump, raw database
capture or sensitive audit output is included in the report commit.

**DEPENDENCY CHANGES: none.** The initial production audit and final audit including
development dependencies reported zero known npm vulnerabilities. Validation used
the repository-supported Node 24.21.0 / npm 11.19.1; no major migration or package
update was necessary.

## Tests and final full scan

The final full scan began at `db25048f`. It repeated all major initial security
areas once, including current live metadata, public production HTTP checks,
provider/project metadata, secret scanning and dependency auditing.

- Initial security selection: **4,250 / 4,250 passed**.
- Notification fix: **119 targeted cases passed across the final focused runs**;
  the old raw-dancer-ID expectation was updated to the secure alias contract.
- Final complete suite: **546 files, 9,392 tests passed; zero failed/skipped**.
- Final TypeScript, complete lint and production build: **passed**.
- Current live-policy simulation: **1,373 assertions passed**; function gate,
  62 readiness probes and production browser-boundary checks: **passed**.
- Incoming-change verification through `86657ab3`: **11 targeted files,
  172 tests passed**, including both database fixes, notification delivery,
  shuttle persistence/alerts, NATS, schedule recovery and video behavior.
- Resumed verification through `7c392a44`: **18 targeted files, 366 tests passed**,
  including media privacy, Storage policies, reactivation, current access fixtures,
  TV serializers, image variants, cache controls and notification regression cases.
  A fresh production build, including TypeScript/lint and the public-artifact
  guard, passed after integrating the media implementation.
- Independent production media checks: public feed, photo and poster returned
  200; a three-byte video range returned 206 with the expected bytes; all used
  private/no-store caching. The former direct public photo route returned 400.

The additional database/media findings received fixes and focused verification
without a third full scan. The full-suite/build results identify their tested
snapshot; subsequent changes received targeted tests and exact-commit deployment
verification. The notification commit's Vercel deployment reached success. The
media task verified Vercel success for `da540df3` and `2cebff24`; final report-commit
delivery is recorded in this task's closeout. The remaining historical-link
provider action prevents claiming every old URL has been revoked.

## Manual action required / remaining risks

- **MANUAL ACTION REQUIRED before enabling professional push:** if any external
  client or old provider subscription uses raw professional UUIDs, re-enroll it
  using the authenticated notification endpoint's opaque alias. This repository
  currently contains customer enrollment only, and project metadata did not show
  OneSignal configured. No live subscription migration was possible or necessary
  on the observed configuration.
- **MANUAL ACTION REQUIRED — Supabase support:** submit the prepared
  [Storage signed-link revocation request](../supabase-storage-link-revocation-request.md).
  Historical direct signed links can bypass the new application checks while
  valid or cached. The media task made both buckets private, purged their caches
  and verified the former public route is denied, but that does not prove all
  previously issued signed links are invalid. Support must confirm revocation
  and any project-wide impact, then only the affected media boundary needs a
  retest. The request is prepared and has not been sent. Auth JWT rotation is
  not a substitute for Storage signing-key revocation. See
  [Supabase signed URL guidance](https://supabase.com/docs/guides/storage/serving/downloads)
  and [cache behavior](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
- **Remaining retention limits:** downloaded copies and browser caches cannot
  be remotely recalled. Guest phone/location and durable-lead retention need an
  owner-defined period; no broad legal policy or destructive purge was invented.
  Private identity and ownership documents were not made public.
- **Remaining account-policy risk:** the documented owner choice permits
  six-character passwords and disables leaked-password rejection. Direct Supabase
  signup uses its configured policy rather than the app's composition validator.
  This audit preserves that explicit choice; stronger credentials/shorter sessions
  require an owner decision. See `../password-policy.md`.
- **Remaining deployment risk:** several credentials have both preview and
  production scope. Vercel reports SSO protection for deployments except custom
  domains, Git-fork protection enabled, and production branch `main`. This is not
  evidence of public unauthenticated preview access, but authorized preview code
  has production privileges. Separate preview Supabase/provider credentials before
  permitting untrusted preview code. The Vercel review used environment metadata;
  no credential values were displayed.
- **Remaining operational limits:** historical migration version collisions and
  ledger gaps remain quarantined; a successful migration check is not permission
  to replay history. Production restore, Storage-byte restoration, real provider
  delivery and all cross-device account journeys were not certified. Physical NFC
  token copying remains a product trust assumption; no new fraud guarantee is made.
- No DNS change, new library, new environment variable or unapplied security
  migration is required for the implemented fixes. The Supabase support action
  above remains outstanding.

## Optional future improvements

**OPTIONAL FUTURE IMPROVEMENT:** use provider-signed push identity verification if
push enrollment expands; the existing keyed-capability fix already prevents raw-ID
claims. Rehearse restores and provider journeys in an isolated recovery environment.
Revisit MFA/password/session preferences and separate preview credentials as part
of planned operations, without treating these choices as an unfixed demonstrated
cross-account exploit.
