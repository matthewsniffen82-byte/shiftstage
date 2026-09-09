# MyDancr architecture and stability baseline

Audited: 2026-09-09. Scope: **Step 0 of the sequential hardening request**.

Audited source baseline: `25f63e9194caa7bf2fd91cdb6d48bbed5fcaa3d1` on
`matthewsniffen82-byte/shiftstage`. The audit began at 5f715a8e and incorporates
the intervening independently published application, security, database and
performance work. Those incoming changes were reviewed and preserved; they are
existing protections for this task, not implementations attributed to Step 0.
Their separate progress records are under `docs/security/2026-09-09/`,
`docs/performance/` and `docs/supabase-reliability/`.

This document describes the existing application. It does not certify production
configuration, apply migrations, activate services, or redesign the application.
Only this document is part of Step 0. Later numbered steps have not begun.

## 1. Evidence and scope

The audit enumerated all 1,076 tracked baseline files, scanned application/configuration/test
and migration sources, and inspected the principal execution and trust boundaries.
The inventory contains 116 API route handlers, 29 page files, 355 Node test files,
and 132 migration SQL files. Counts refer to the current source baseline above, before this
document was added. They are not counts of deployed functions, live database
objects, or independently tested user journeys.

Repository evidence is distinguished from provider state:

- GitHub's main ref and the local fetch identified the baseline SHA.
- GitHub's combined status reported **Vercel success for that baseline SHA**.
  [Baseline deployment](https://vercel.com/ai-movie-jobs/shiftstage/iXGjRceT8PYVjEs7WvPnHideYssz).
  This is not deployment verification for the new documentation commit.
- No production database writes, email sends, payment operations, moderation API
  calls, or load tests were performed for this audit.
- Supabase dashboard settings, effective live grants/policies, migration history,
  Storage objects, provider billing, backup retention and
  restore capability were not independently verified in this step.
- Existing operational reports under `docs/` are dated evidence, not checks
  performed by this session. The incoming [Supabase audit](supabase-reliability/README.md)
  captured production metadata at 2026-09-09 09:08:49 UTC against 6ef753e2:
  81 public relations, RLS and primary keys on every public base table, ten
  Storage buckets, and 86 live migration ledger entries. Its read-only Auth
  configuration comparison records the production site/callback URLs and SMTP
  enabled. This narrows configuration uncertainty without proving live email
  delivery, effective cross-user authorization, or recovery capability.
- The later [security execution ledger](security/2026-09-09/execution-ledger.md)
  records targeted policy, stale-permission and admin-control migrations, with
  their separate deployment evidence. That is dated evidence from the other
  session, not production SQL executed or independently reverified by this task.
  Current local tests now execute captured policies with synthetic records in
  PGlite; they do not connect to the live Supabase project.
- The incoming [performance baseline](performance/step-01-audit.md) records
  read-only mobile/browser and bounded media/API measurements against its stated
  earlier baseline. Its synthetic dashboard data and historical measurements
  are not current authenticated E2E verification. Scripts under
  `scripts/performance/` reuse an external Playwright installation; the offline
  Supabase inventory generator accepts metadata and makes no network requests.
- The GitHub main-branch API reported protected=false, protection disabled and
  no required status-check contexts during the resumed read. Organization rulesets
  were not separately inspected. Vercel production branch/auto-assignment and
  the maintenance-flag absence were inspected as described in Section 9.

The original workspace has unrelated changes. Baseline work is isolated under
`work/hardening-step0-20260909` on `codex/hardening-step0-20260909`. It used a
local junction to the already installed `work/public-loading-fix/node_modules`
for the earlier baselines. The incoming dependency patches required a matching
installation: only this checkout's junction was detached, its target was preserved,
and `npm ci` installed the existing lockfile into this isolated checkout. No package
was added or upgraded by this task; the upgrades came from the separate main
commit. The old junction is not a deployment dependency.

## 2. Runtime, tooling and repository layout

| Area | Current implementation |
| --- | --- |
| Web framework | Next.js App Router, locked at 15.5.24 |
| UI | React / React DOM 19.2.7, plus the checked-in live HTML/JavaScript shell |
| Language | TypeScript 5.9.3; strict type checking; JavaScript and HTML also present |
| Package manager | npm 11.19.1 declared in package.json and Vercel's install command |
| Database/Auth/Storage SDK | @supabase/supabase-js 2.108.2 |
| Payment SDK | stripe 16.12.0 |
| AI SDK | openai 5.23.2 |
| Media processing | sharp 0.35.4, ffmpeg-static 5.3.0 |
| QR tooling | qrcode 1.5.4, @zxing/browser 0.1.5 |
| Lint | ESLint 9.39.5 with Next, React, hooks and TypeScript rules |
| Tests | Built-in Node runner; source assertions, executable units, mocked API integrations and PGlite 0.5.8 PostgreSQL policy fixtures |
| Hosting | Existing Vercel Next.js integration |
| Local baseline runtime | Windows, Node 24.16.0, npm 11.19.1; this does not prove the Vercel Node setting |

`package-lock.json` is the installation source of truth; declared semver ranges
are not the exact installed versions. `.npmrc` enables strict script allowlisting.
The existing package allowlist permits ffmpeg-static's installation script and
denies unrs-resolver's script. Step 0 changes no package manifest or lockfile.

| Path | Responsibility |
| --- | --- |
| `outputs/index.html` | Production live shell: discovery, venue/dancer browsing, account entry, profile interactions and shared browser state |
| `app/route.ts`, `app/live-shell.js/route.ts` | Serve/version the shell and its extracted application script |
| `app/**/page.tsx` and adjacent clients | React pages, dashboards, admin, TV, profiles, NFC, deals and account recovery |
| `app/api/**/route.ts` | HTTP endpoints and privileged request boundaries |
| `middleware.ts` | API session refresh transport and private response cache protection |
| `src/lib/dancr/` | Business rules, data access, authorization helpers, finance, media, jobs and notifications |
| `src/lib/supabase/` | Public, request-scoped and service-role clients; bounded fetch and session transport |
| `src/lib/security/` | Root CSP generation and safe error metadata |
| `public/` | Existing CSS, browser scripts, logos, icons and media assets |
| `src/generated/live-shell-version.ts` | Generated shell version used to detect stale artifacts |
| `src/generated/static-asset-versions.mjs` | Build-generated hashes for current static asset URLs/cache rules |
| `public/outputs/live-shell.css` | Ignored, build-generated compact stylesheet; production root reads and inlines it |
| `supabase/migrations/` | Ordered SQL schema, policies, grants, functions, constraints, indexes and historical data changes |
| `supabase/migration-history-baseline.json` | Frozen SQL filenames/hashes checked offline before every build; not permission to replay SQL |
| `scripts/` | Build helpers and explicit operational/media/demo maintenance commands |
| `tests/` | Existing automated regression suite |
| `docs/` | Setup, prior audits, operational evidence and product/integration documentation |

No tracked Supabase Edge Function directory or GitHub workflow was found.
The source scan found no Next `"use server"` action directives; current mutation
entry points are HTTP route handlers and database RPCs. This is not a claim that
the application lacks server rendering or server-side functions.

## 3. Request and trust boundaries

```text
Browser
  |-- live HTML shell / versioned browser assets
  |-- React pages and client components
  |
  +--> Next API routes
          |-- bounded input parsing
          |-- Supabase identity verification
          |-- application role / ownership / publication checks
          |
          +--> src/lib/dancr services and policy helpers
                  |-- request-scoped Supabase client (RLS applies)
                  |-- server-only service-role client (bypasses RLS)
                  |-- database RPC / constraints / transactional claims
                  +-- existing provider adapters
                              |
                         Supabase / Stripe / NATS /
                         OpenAI / Resend / OneSignal

Authorized media upload --> scoped Storage upload token --> validation/review
Public media response --> approved image URLs or expiring video URLs
Vercel daily cron --> authenticated worker route --> bounded existing processing
```

The service layer and data-access layer are not separate packages; many services
accept a Supabase client and contain queries. Some server pages call services
directly. React clients and the shell generally call HTTP APIs. Authorization
must remain at the server/database boundary; UI visibility is not permission.

The service-role client is explicitly server-only and bypasses RLS. Its use is
necessary in existing administrative and controlled server workflows, so every
caller must validate actor and resource access before executing privileged work.
A successful unit test or presence of an RLS migration cannot prove every caller
is correct.

## 4. Frontend architecture and failure behavior

The root is a dynamic Node route reading the checked-in `outputs/index.html`.
It normalizes line endings, computes the shell SHA, externalizes the main script,
inlines the generated compact CSS in production, versions static asset references,
injects existing assets/banner/admin entry, and emits matching CSP/version headers.
The shell is production source, **not disposable build output**. Its generated
CSS is traced into the server output and must exist for a production root request.
Development retains live source CSS. The final incoming change retains compact
inline CSS for cold mobile rendering; earlier reports describing external main
stylesheet delivery are superseded by the stated source baseline.

Public dancer and venue pages, TV, customer/dancer/venue dashboards, admin and
account recovery also use App Router routes. The shell and React surfaces share
policy helpers and browser session storage but retain separate interaction code.

Existing browser protections include request deadlines, session-response ordering,
media recovery scripts, adaptive video warmup, bounded media grids, sound
preferences and targeted loading recovery tests. No tracked App Router
`error.tsx`, `global-error.tsx`, `loading.tsx` or `not-found.tsx` was found in
this source scan; individual pages may still render local error/loading/empty states.

Role-specific dashboard tools use dynamic imports. Feed rendering reuses time
formatters, navigations cancel obsolete public requests, and current video logic
limits warmup, pauses hidden-page playback and keeps playback on the selected
profile card. These are incoming existing controls. Dated lab comparisons are in
`docs/performance/`; they are not fresh physical-device measurements by this task.

Large source files increase regression risk:

| File | Approximate source size / lines at baseline |
| --- | --- |
| `outputs/index.html` | 2.61 MB / 66,737 lines |
| `app/dashboard/DashboardClient.tsx` | 638 KB / 9,943 lines |
| `public/dancr-aesthetic.v1.css` | 457 KB / 12,260 lines |
| `app/admin/AdminClient.tsx` | 343 KB / 5,965 lines |

These are source sizes, not measured compressed transfer sizes. They justify
careful boundary review, not a rewrite. ESLint explicitly ignores `outputs/**`;
therefore a green lint result does not lint the large live shell. TypeScript
strict mode does not cover all inline JavaScript, and lint permits explicit
`any` and unused TypeScript variables.

## 5. Authentication and account lifecycle

Primary paths:

- `app/api/auth/route.ts`: login, signup and reset request.
- `app/auth/callback/route.ts`: email confirmation and recovery callback.
- `app/account/reset-password/` and `app/api/account/route.ts`: password
  update and account operations.
- `src/lib/dancr/account-provisioning.ts`, `auth.ts`,
  `account-recovery.ts`, `password-policy.ts`, `safe-return-path.ts`,
  `public-app-url.ts`: shared policy and lifecycle helpers.

The application uses a custom browser session record, Authorization bearer headers
and a bounded `x-dancr-refresh-token` transport. The browser Supabase upload client
disables independent session persistence/auto-refresh. Request contexts verify
the user with Supabase Auth; middleware refreshes expiring API sessions and marks
credential-bearing responses private/no-store. Public cacheable endpoints bypass
that refresh path except the specifically handled media-like endpoint.
Routes can now select a trusted role/active-account requirement in the request
context; it reads `app_users` after verified Auth identity. The relevant dancer
routes and agent commission path use that requirement. Other route/service
ownership checks remain essential; the optional helper is not a universal gate.

Incoming callback safeguards compare browser session state before saving an
asynchronous confirmation and preserve an unrelated sign-in when recovery is
invalid. Self-service lifecycle checks cannot relabel an admin suspension as a
self-pause, reactivate a deleted account, or retain stale restoration metadata.
The private `admin_suspended` publication flag is preserved through ordinary
profile updates. These controls are covered by runtime fixtures in the full suite.

Password reset is particularly sensitive:

1. A bounded reset request is rate limited and sent to Supabase with a controlled
   callback destination. Provider failures must not be reported as delivery success.
2. Callback handling supports the existing token-hash and browser-fragment flows,
   validates safe local return paths and avoids caching/referrer propagation.
3. Recovery UI distinguishes missing/invalid/expired links and temporary failures.
   Browser session writes and out-of-order responses have dedicated tests.
4. Password updates verify the session/account, preserve the submitted password
   string and apply the shared password policy.
5. Revocation/notification failures must remain visible according to existing
   response behavior; a password update alone is not proof that every other device
   has been logged out.

The callback code and its tests do not establish an arbitrary cross-device PKCE
code/verifier flow. Supabase email templates, Site URL, redirect allowlist, token
expiry, SMTP deliverability and real new-password login need isolated live
verification. No real reset email or production account mutation was attempted.

Because tokens are accessible to first-party JavaScript, preventing XSS and unsafe
third-party script execution is especially important. Changing to another session
architecture would affect multiple surfaces and requires a separate reviewed step.

## 6. API map and input/error handling

All counts below are source route-handler counts:

| API family | Count | Purpose |
| --- | ---: | --- |
| `/api/admin/*` | 28 | Review, operations, finance, moderation, venues, support and monitoring |
| `/api/dancer/*` | 22 | Profile/media/schedules, publication, earnings and account features |
| `/api/venue/*` | 22 | Venue ownership, roster/team, media, deals, claims and finances |
| `/api/public/*` | 14 | Discovery, profiles, venues, TV, events, maps and share assets |
| `/api/customer/*` | 8 | Favorites, follows, Going, directions, saved deals and preferences |
| `/api/cron/*` | 5 | Scheduled workers |
| `/api/deals/*` | 3 | Issuance, redemption and related events |
| `/api/dmca/*` | 2 | Notices/case operations |
| `/api/health/*` | 2 | App liveness and Supabase probe |
| Other families | 10 | Account recovery, account, agent, auth, events, NFC, notifications, reports, Stripe and support |

Existing helpers include `bounded-json-body.ts`, `bounded-form-data.ts`,
`resource-authorization.ts`, `venue-access.ts`, `social-profile-url.ts` and
`api-error-policy.ts`. Routes use authenticated identity and role/ownership
checks; RPCs enforce selected atomic operations. The regression suite includes
malformed/oversized requests, ownership attacks, spoofed attribution, redirects,
webhook handling and unsafe media. Coverage is not a guarantee of every branch.

Three visitor-cookie POST paths (going, media likes and engagement shares) require
same-origin JSON through `requireSameOriginJsonMutation` before body/database work.
This is a browser CSRF boundary, not authentication or a replacement for rate limits.
Bearer-authenticated account APIs, signed webhooks, cron and email callbacks retain
their respective authorization mechanisms. Photo deletion inputs are bounded UUID
collections; the shell's rendering helpers encode HTML/attributes and reject unsafe
URL schemes. The associated runtime tests execute the actual helper/render functions.

`api.ts` maps failures through a shared public error policy and logs only selected
metadata. Sensitive API responses use no-store headers. Next configuration supplies
a restrictive API CSP. Per-route review is still needed for consistent validation,
status codes, identity derivation, failure semantics and request budgets.

Existing global headers include HSTS, nosniff, frame denial, referrer policy,
permissions policy, opener policy and CSP. The root uses generated script hashes;
the general Next page CSP still allows inline scripts/styles. CSP therefore needs
surface-specific review, not a claim that all inline execution is blocked.

## 7. Database, RLS and transaction boundaries

The incoming venue-publication commit makes coordinates optional for publication,
uses address-based directions when needed, and clears stale coordinate metadata
when an address changes. Its migration is already part of the incoming main history;
this task neither authored nor applied it. No production application of that
migration is inferred from the code deployment status.

The later incoming change requires an active Club Deal for public venue visibility,
keeps hidden venue records/affiliations intact, supports owner removal requests,
and approves removals through an atomic RPC. Removed deals are archived instead
of erased. The new SQL fixture under tests/fixtures is a transactional fixture,
not evidence that live RLS or the fixture has been executed by this task.

Supabase Postgres holds the application's persistent state. The migration history
covers these domains:

| Domain | Representative objects |
| --- | --- |
| Identity / roles | app_users, customer_profiles, dancer_profiles, approval_reviews, account_recovery_events |
| Venue access | venues, venue_team_members/invitations, venue_signup_requests, venue_ownership_claims, venue_claim_codes |
| Presence | shifts, shift_location_events, dancer_nfc_enrollments, venue_dancer_affiliations/events |
| Media / moderation | dancer_photos, mydancr_tv_videos, image_moderation_records, dancer_identity_verifications |
| Customer activity | favorites, follows, venue_follows, going_signals, customer_deal_saves, media_likes |
| Attribution / deals | nfc_tags/tap_events, qr_redemptions/events, club_deals, commission_events, deal_revenue_events |
| Finance | club_invoices/items, dancer_payout_accounts/batches/items, payout_settings, financial_audit_events, provider webhook records |
| Referrals | sales_agents, venue_sales_attributions, nats affiliate accounts and export records |
| Support / moderation | support_threads/messages, content_reports, dmca_cases/counter_notices/strikes |
| Analytics / ops | profile_views, schedule_views, direction_requests, social_clicks, ranking_events, trending_scores, notifications, request_rate_limit_buckets |

Migration text includes RLS enabling statements for every public table recognized
by the source scanner. This is **not effective-policy verification**: SQL history
contains replacements, revocations, triggers and data changes, and permissive
policies can combine in unexpected ways. Inspect SELECT/INSERT/UPDATE/DELETE
separately with anonymous, owner, non-owner and admin identities in an isolated
database before concluding the live boundary is correct.

Existing hardening includes column grants, server-managed write revocations,
security-definer search-path/execute restrictions, and publication/venue access
policies. For example, `202609070001_supabase_access_boundaries.sql` removes a
legacy permissive profile policy, restricts legal-name access, tightens venue team
policies and moves sensitive writes behind server routes. Its presence does not
prove that it has been applied in production.

Critical RPC boundaries include:

- `provision_app_account_safely` and `transition_dancer_publication_safely`.
- `consume_request_rate_limit`.
- NFC scan/enrollment/activation and `issue_and_confirm_deal_redemption_from_nfc`.
- Venue signup, claims and team invitation redemption.
- Invoice payments, payout batch creation/claim/completion and webhook claiming.
- NATS commission export claim/completion/failure and support-message creation.

Constraints and transactional RPCs already protect important duplicate/race cases.
Other operations use multiple API/database calls with compensation or optimistic
retry; these need case-by-case concurrency review. Do not add broad mutation
retries. Migrations include historical data changes: never replay the entire
migration directory against production as an audit technique.

Four historical migration version prefixes are duplicated across nine files:
202606280001, 202608040001, 202608080001 and 202608180001. This was checked against
the current filenames. A version-only migration ledger cannot identify which of
the colliding files ran. Do not rename/replay them blindly; reconcile file contents
with the live catalog before any migration deployment.

The offline migration guard now freezes 132 historical file hashes and rejects
new collisions, invalid timestamps, empty SQL and historical edits/removals. The
four inherited collision groups remain disclosed exceptions; `replayReady` stays
false. The guard runs before builds and never changes Supabase or its ledger.

PGlite fixtures now recreate captured table/policy/grant/view definitions and
synthetic identities for anonymous, owner, unrelated user, disabled user and admin
tests. Storage fixtures exercise SQL object policies and ownership paths. They
omit parts of the complete production schema/trigger lifecycle and do not run the
Storage HTTP service, Auth server or full historical migration replay. An explicitly
designated disposable Supabase environment is still missing. See
`docs/supabase-reliability/migration-safety.md` before proposing migration work.

## 8. Storage and media delivery

The following are **bucket definitions in migration source**, not a fresh listing
of deployed Storage settings or contents:

| Bucket | Intended source visibility | Use |
| --- | --- | --- |
| dancer-photos | Public | Approved images, avatars and video posters |
| dancr-image-moderation-temp | Private | Pending upload/processing |
| dancr-image-moderation-review | Private | Held review media |
| dancr-media-originals | Private | Original media retained by watermark pipeline |
| mydancr-tv-videos | Private | Video objects delivered through signed URLs |
| venue-qr-codes | Public | Venue QR images |
| venue-cover-images | Public | Venue covers |
| venue-logo-images | Public | Venue logos |
| venue-ownership-proofs | Private | Venue claim evidence |
| verification-documents | Private, legacy | Historical identity-document bucket; upload endpoint currently disabled |

`/api/dancer/verification-documents` returns 410 after authentication and states
that document uploads are disabled. Legacy tables/buckets and removal scripts do
not establish that every historical object has been purged. Do not reactivate this
flow or infer an active external identity-document provider from old documentation.

The photo pipeline validates actual image data, bounds decompression, uses Sharp
for processing, and stages moderation before publication. Original/media path
helpers, ownership checks and server-managed Storage policies are security
boundaries. The live photo crop/upload flow also binds selected files to the
initiating account, cancels a crop on account change and rejects cross-account
reuse before an upload. TV uses signed upload paths, stored-object validation, FFmpeg probing
and moderation before approval. Signed TV read URLs currently have a one-hour
lifetime; URL expiry and missing objects must be recoverable by clients.

Existing limits include 50 profile photos, 50 profile videos and 12-item media
pages. The repository contains mobile-image recovery, video autoplay recovery,
poster generation, warmup and buffer policy tests. These do not establish real
mobile network performance or full codec coverage.

Storage operations and server-side media processing can consume significant
memory, duration, bandwidth and provider usage. The shared Supabase fetch wrapper
buffers response bodies; large media responses therefore deserve memory profiling
in the media/network steps. Do not change media quality, bucket visibility or
retention as part of baseline work.

## 9. Environment and configuration

Current configuration boundaries:

- `env.ts` reads public configuration; missing Supabase settings throw.
- `src/lib/supabase/public-config.mjs` validates public URL/key values, including rejecting
  private keys before build-time embedding.
- `server-env.ts` and the admin Supabase/Stripe adapters are server-only.
- `next.config.mjs` validates production public Supabase configuration and all
  populated NEXT_PUBLIC values before bundling. It rejects private names,
  recognized secrets/private JWTs, credential URLs and configured server-secret
  copies without printing values. It sets headers and traces FFmpeg/compact CSS.
- `public-app-url.ts` canonicalizes production account/callback URLs; local
  origins are allowed only under its development rules.
- `DANCR_VIDEO_MODERATION_MODE` is explicitly exposed by Next configuration and
  must never contain a secret. Missing mode currently defaults to `ai`.

Names only are listed below. No environment secret values were copied into this
document or supplied to local tests/build.

| Group | Existing variable names / source responsibility |
| --- | --- |
| Public app / Supabase | NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY |
| Public push | NEXT_PUBLIC_ONESIGNAL_APP_ID |
| URL compatibility aliases | DANCR_PUBLIC_URL, NEXT_PUBLIC_APP_URL, APP_URL in public-app-url.ts |
| Public template entries requiring use/config review | NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY |
| Privileged Supabase / admin | SUPABASE_SERVICE_ROLE_KEY, DANCR_ADMIN_SEED_KEY, DANCR_ADMIN_SIGNUP_CODE, DANCR_MEDIA_IMPORT_KEY |
| Request / recovery / venue security | CRON_SECRET, DANCR_ACCOUNT_RECOVERY_SECRET, DANCR_PUBLIC_RATE_LIMIT_SECRET, DMCA_RATE_LIMIT_SALT, VENUE_CLAIM_CODE_SECRET, DANCER_VENUE_VERIFICATION_SECRET, DANCR_IP_HASH_SECRET |
| AI/media | OPENAI_API_KEY, DANCR_AVATAR_FACE_MODEL, DANCR_MEDIA_IDENTITY_MODEL, DANCR_VIDEO_POLICY_MODEL, DANCR_VIDEO_TRANSCRIPTION_MODEL, DANCR_VIDEO_MODERATION_MODE; moderation threshold names documented in .env.example |
| Stripe | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_DANCER_MONTHLY_PRICE_ID |
| Payout controls | PAYOUTS_ENABLED, PAYOUT_PROVIDER, EARNINGS_HOLD_DAYS, MINIMUM_PAYOUT_AMOUNT, PAYOUT_MODE |
| NATS | COMMISSION_SETTLEMENT_PROVIDER, NATS_BASE_URL, NATS_AFFILIATE_PORTAL_URL, NATS_API_USERNAME, NATS_API_KEY |
| Notifications | ONESIGNAL_REST_API_KEY, RESEND_API_KEY, EMAIL_FROM, ACCOUNT_RECOVERY_SUPPORT_EMAIL |
| Explicit local/maintenance operations | DANCR_ENV_DIR, MYDANCR_ADMIN_ACCESS_TOKEN, LAYOUT_REVIEW_POPULATE, LAYOUT_REVIEW_SYNC_DEALS, LAYOUT_REVIEW_SYNC_SCHEDULES, DEMO_UPCOMING_SYNC |
| Runtime | NODE_ENV, VERCEL_ENV |

Presence in source or an example file is not proof that a variable is configured.
Some reads are dynamic and validation is distributed. Current configuration is not
a complete typed startup schema. Development/preview separation, placeholder
rejection, environment alias consistency and missing optional-provider behavior
need the dedicated configuration step.

Build lifecycle risk: `scripts/manage-layout-review-postbuild.mjs` can invoke
explicit production demo-data operations when exact maintenance flags are set.
The local baseline clears all four flags and verifies the skip result. A read-only
Vercel Production environment check found no Project or Shared variable matching
LAYOUT_REVIEW or DEMO_UPCOMING; no value was revealed or changed. The production
screen also confirmed that main creates production deployments and auto-assigns
custom domains. Recheck these flags before future maintenance deployments so a
one-time operation cannot unknowingly be replayed.

## 10. Integrations actually represented in the source

| Integration | Existing use and activation boundary |
| --- | --- |
| Supabase | Auth, Postgres, Storage and RPCs; live settings require provider verification |
| Vercel / GitHub | Existing hosting/deployment and repository status; no tracked Actions workflow |
| Stripe | Server SDK, signed webhook processing, finance and supported payout adapter; actual payout enablement/provider account state not verified |
| NATS | Configured affiliate/commission settlement and export adapters; external account/configuration not verified |
| OpenAI | Image/video moderation, media identity and avatar processing; key/model/mode dependent and potentially billable |
| Resend | Transactional email adapter with bounded requests; missing key/from returns undelivered |
| OneSignal | Browser push SDK and server notification delivery, subject to configuration and customer preferences |
| Google Maps / Fonts | Existing map links/embed route and font hosts; template map key does not prove paid Maps API activation |
| Uber | Existing universal ride links and first-party attribution; not evidence of a purchased ride API |
| Social destinations | Instagram, TikTok, Snapchat, X, OnlyFans and other validated external links; opening a destination is a separate third-party interaction |
| Unsplash | Remote demo-image references exist; not a monitoring or authentication integration |

The Stripe dancer checkout/portal routes currently return free-account information
and null URLs. A legacy price variable or subscription sync module must not be used
to infer that paid dancer signup should be restored. Adyen/other names in the payout
enum are unsupported adapters, not evidence of installed payment providers.

No Sentry, Google Analytics/gtag or Vercel Analytics instrumentation was found in
the scanned runtime sources. No active Postmark or VerifyMy runtime adapter was
found. Earlier roadmap mentions are not proof of current installed integrations.
This is an architecture inventory, not a complete live-browser cookie disclosure.

## 11. Caching, query and network behavior

- Root shell response: browser max-age 30 seconds, edge 60 seconds, stale-while-
  revalidate 300 seconds, with shell-version headers.
- Shared public dynamic policy: 10-second browser/edge freshness and 20-second
  stale-while-revalidate. Directory metadata uses 60/60/300 seconds.
- Following/personalized responses and credential refresh responses are private/
  no-store. Global API no-store headers coexist with deliberate public route
  cache policies; final deployed headers need verification.
- Selected static assets use one-year immutable caching. A changed asset must
  match its generated content hash for immutable caching; mismatched/unversioned
  requests use revalidation. Pretest/prebuild regenerate the shared hash manifest.
- Public dancer queries have existing bounds (200 per city, up to four times
  that for the all-city branch); profile media and shifts are capped at 50.
  Bounds prevent unlimited results but can also truncate growing directories.
- Public metric RPCs and batched media signing reduce repeated reads. Owner TV
  and admin review now also deduplicate and batch authorized paths in groups of
  at most 100, map results by path and preserve private one-hour expiry. Owner
  analytics and signing overlap. The raw 30-day analytics reader remains subject
  to backend row limits; live plans and peak concurrency were not measured here.
- Shared Supabase fetch budgets are 15 seconds for ordinary calls and 120 seconds
  for Storage; headers and body are covered. It does not replay mutations.
- Auth provider failures are translated to avoid implicit refresh retry loops.
  Notification calls have a 10-second deadline. Video moderation has its own
  timeout/retry policy that needs aggregate duration/cost review.
- Browser request recovery and warmup controls already exist. They are not a
  substitute for deliberate offline/slow-network and real-device verification.

## 12. Abuse controls, logging, health and scheduled work

`public-request-rate-limit.ts` uses HMAC-derived identifiers and the atomic
`consume_request_rate_limit` RPC. Missing RPC support activates a compatibility
path that counts/inserts internal `content_reports` records. That fallback is not
equivalent to an atomic limiter under concurrent requests and is logged. Verify
the atomic function is deployed before assuming full race protection.
Different endpoint families also have recovery/media/event abuse controls.

`safe-error-metadata.ts` allowlists error name/code/type/status/request ID and
omits raw messages, bodies and credentials. `api.ts`, auth/media/worker modules
and finance audit records provide existing diagnostics. There is no verified
central frontend exception collector, shared end-to-end correlation identifier,
or externally verified alert delivery in this baseline.

Health endpoints already exist:

- `/api/health` returns application liveness; it does not query the database.
- `/api/health/supabase` performs a bounded one-row database read and an Auth
  health call, returning minimal status rather than rows, credentials or stack
  traces. It does not verify Storage or real password-reset delivery.
- `/api/admin/monitoring` requires verified admin access for detailed diagnostics.

The Supabase health endpoint is publicly callable and performs uncached backend
work. Frequency/abuse protection is a review item; do not add frequent polling.

Existing Vercel cron configuration (UTC):

| Route | Schedule | Existing purpose |
| --- | --- | --- |
| /api/cron/image-moderation | Daily 09:00 | Pending image moderation retry processing |
| /api/cron/video-moderation | Daily 09:15 | Pending video moderation processing |
| /api/cron/dmca-restoration | Daily 09:30 | Eligible DMCA restoration processing |
| /api/cron/shift-checkins | Daily 09:45 | Expired shift reconciliation |
| /api/cron/finance | Daily 10:00 | Finance lifecycle automation |

Workers require the existing bearer `CRON_SECRET`, compared in constant time.
Several routes declare a 60-second maximum duration; workers have existing batch/
retry/claim logic and sanitized failure logs. The finance pipeline includes
transactional claims and provider-specific handling. This does not prove every
worker is safe against overlapping invocation, interruption or a provider response
lost after successful processing. No worker was invoked for this audit.

Cron entries do not prove that every scheduled invocation succeeded. Their logs,
stale-work recovery, alert routing, and existing provider/hosting allowances need
verification without activating a paid plan or increasing frequency.

## 13. Local validation baseline

Validation runs in the isolated checkout with dependencies matching the lockfile.
The production build receives no copied production environment file, has telemetry
disabled, and clears all demo-data postbuild flags.

| Check | Actual result for current delivery baseline |
| --- | --- |
| Pretest generators: shell SHA, compact CSS, static asset hashes | PASS, exit 0 |
| Full suite: `node --test --test-concurrency=2 tests/*.test.mjs` | PASS: 2,806 tests; no failures, skips, cancellations or todo; approximately 59 seconds |
| TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS, exit 0 |
| Lint: `node node_modules/eslint/bin/eslint.js . --max-warnings=0` | PASS, exit 0 |
| Production build: `npm run build -- --no-lint` via Node's npm CLI, including prebuild/postbuild | PASS, exit 0; standalone full lint above passed; postbuild reported LAYOUT_REVIEW_POPULATION_SKIPPED |
| Migration history guard, executed in prebuild | PASS; 132 frozen historical files; no SQL executed |
| Dependency advisory lookup: `npm audit --json --ignore-scripts` | PASS, exit 0: zero advisories in the patched lockfile |
| Existing baseline deployment | Vercel success for 25f63e9194caa7bf2fd91cdb6d48bbed5fcaa3d1 |
| Step 0 documentation commit deployment | Requires exact-commit verification before Step 1 |

The registry request initially failed when networking was restricted. On resuming,
the first completed lookup identified Next (critical), Sharp and js-yaml (high),
and qs (moderate). The separate incoming commit 43d851ba updates Next to 15.5.24,
Sharp to 0.35.4, js-yaml to 4.3.2 and qs to 6.16.0; the repeated advisory lookup
then returned zero. The original findings and dated upstream links remain in
`docs/security/2026-09-09/baseline-threat-model.md`. They describe an earlier
snapshot, not unresolved advisories in this lockfile. No exploit or automatic
audit fix was attempted by this task. Step 16 must review the then-current state.

Earlier snapshots also passed full validation, including 1,951 tests at 43d851ba.
Those historical results do not replace this resumed run. Detailed local logs are in
`work/hardening-step0-20260909-evidence/`; they are not a remote backup or CI artifact.

Concurrency is capped locally to limit memory pressure; no tests are excluded.
The package's typecheck script runs tests before tsc. Those components are run
separately to avoid executing the identical suite twice. The production build
retains type validation, compilation and lifecycle hooks; only its duplicate lint
pass is omitted after the complete standalone zero-warning lint check succeeds.
The npm JS CLI is invoked through Node to preserve Windows argument forwarding.

Existing tests execute policy/helper code and route handlers with mocked
dependencies, source/migration assertions, and captured PostgreSQL policies in
disposable PGlite instances with synthetic records. Authentication, recovery,
session ordering, input limits, uploads, visibility, authorization, financial
races, webhook safety, headers, logging and supply-chain restrictions are covered.

Known warnings and limits:

- The earlier dependency advisories were patched by an incoming independent
  commit. A zero-advisory registry result is not complete application security clearance.
- Node emits MODULE_TYPELESS_PACKAGE_JSON warnings for directly imported TypeScript.
  Changing module mode is outside Step 0.
- Next prints that build lint is disabled because the full standalone lint check
  already ran. No test or lint rule is excluded. A previous Windows wrapper
  forwarding issue was resolved for this run by invoking npm's JS CLI directly.
- No complete browser E2E harness is checked in. Incoming performance scripts
  provide read-only browser measurements, not signup/reset/authorization tests.
  No inbox, multi-device session, payment or Storage upload journey was executed
  by this session; provider browser inspection was read-only configuration review.
- SQL policy tests now include executable local PostgreSQL cases. Their captured
  schema/policy fixtures are not a complete live Auth/Storage/trigger/RPC replay
  and do not prove every production operation's authorization.
- A local build without provider credentials proves compilation and route
  generation, not live provider configuration or availability.
- This document changes no application behavior. No complete live product
  regression or production database mutation is claimed.

## 14. Prioritized risks for later isolated steps

The incoming dependency patch resolves the four registry advisories discovered
earlier in Step 0; the current lookup is recorded above. No exploitation or
provider mutation was attempted by this task. The table separates remaining
observed gaps from behavior that still requires runtime evidence. Historical
reports retain their original baseline/version context.

| Priority | Finding / evidence | Consequence and appropriate later step |
| --- | --- | --- |
| Ongoing security review | Incoming dependency patches clear the four known advisories in the current registry scan | Review reachability, supply chain and newly published advisories in Step 16; a clean registry scan is not security certification |
| Medium | Four duplicated migration prefixes span nine files | Reconcile deployed objects before new migration application; Steps 3 and 19 |
| High | No tracked GitHub workflow; main-branch API reports protection disabled and no required check contexts | No repository branch gate was observed; review rulesets and deployment enforcement in Step 17 |
| High | Captured-policy PostgreSQL tests now cover cross-user boundaries, but complete live auth/trigger/RPC isolation remains unproven; service-role routes bypass RLS | Extend actual environment/operation coverage in Steps 3-4 and 6 |
| High | Recovery integration depends on live Auth URL/template/email settings | Mocked success cannot detect every real broken reset link; Step 5 with isolated test identities |
| Medium | Existing six-character password minimum and disabled leaked-password rejection are documented owner choices | Preserve existing behavior; any stronger product policy requires review. Direct Supabase callers use provider policy, not MyDancr composition validation |
| High | Production-capable demo scripts remain attached to postbuild behind flags | Stale deployment flags could replay data operations; review configuration before future implementation deployments |
| High | Payout/redemption/export/worker workflows can span DB and external calls | Duplicate/recovery/partial-failure guarantees require focused tests; Steps 10, 13 and 15 |
| Medium | Large shell/dashboard/admin modules and separate browser surfaces | Increased coupling and missed regressions; targeted extraction only in Step 1 |
| Medium | Shell ignored by ESLint; no complete browser E2E harness | Green lint/tests leave interface behavior gaps; Steps 12 and 20 |
| Medium | JavaScript-readable session tokens and global inline-script CSP allowance | XSS prevention is essential; Steps 5 and 7, without an unplanned auth rewrite |
| Medium | Atomic limiter has compatibility fallback; health probe is uncached backend work | Concurrency/abuse protection depends on deployment state; Steps 9 and 18 |
| Medium | Buffered media responses and provider moderation retries | Memory, timeout and usage pressure; Steps 8, 13 and 21 |
| Medium | Finite directory caps and no current query-plan/load baseline; incoming mobile report records long tasks and TV bandwidth costs | Growth may truncate results or increase latency; Step 11 then evidence-led Step 21 |
| Medium | No verified exception alert delivery or restore drill | Failures may remain unnoticed and recovery time is unknown; Steps 14 and 19 |
| Low | Node/module-mode and provider runtime version consistency not established | Build reproducibility review in Steps 2/16/17 |
| Low | Generated CSS/hash artifacts are mandatory production build inputs | Preserve pretest/prebuild generation and output tracing; Steps 11-12/17 |

Recommended implementation sequence remains the user's numbered sequence.
Each later step must inspect its boundary, make only justified changes, test the
entire available suite/type/lint/build, commit separately, push and verify the
exact deployment before advancement. Database permission changes and risky
migrations require explicit production review; a successful code deployment does
not apply or approve a migration.

## 15. Deployment and cost controls

Existing `vercel.json` specifies Next.js, `npx --yes npm@11.19.1 ci` and
`npm run build`. No replacement pipeline, service, schedule, dependency or
monitoring subscription was added in Step 0. Existing automatic Vercel deployment
must be verified against the exact pushed SHA after each step.

No tracked GitHub Actions workflows means **zero repository-defined Actions
minutes were added by this step**. It does not establish the account's allowance
or usage from other repositories/provider settings.

Planning envelope for a later standard-Linux workflow, not an activated schedule:

| Assumption | Approximate monthly minutes |
| --- | ---: |
| 40 relevant change runs at 12 minutes | 480 |
| 4 weekly broader runs at 20 minutes | 80 |
| 30 lightweight daily checks at 2 minutes | 60 |
| 5 additional release verifications at 20 minutes | 100 |
| Total planning envelope | 720 |

This leaves 280 minutes below the requested 1,000-minute target. Estimates require
measurement on the actual standard Linux runner; repeated full suites and
duplicate push/PR runs would erode that margin. Later CI should use path filters,
cancellation, safe dependency caches, timeouts and targeted critical flows.
Documentation-only changes should avoid unnecessary expensive suites in ongoing
automation. Do not activate schedules before confirming included usage and charge
controls; this target is not spending permission.

Existing potential cost surfaces include Vercel build/function/transfer usage,
Supabase database/Storage/egress, OpenAI moderation, email/push providers, payment
transactions and configured NATS services. Their pricing/plan state was not
changed or verified. No new paid services, AI calls, production test traffic or
billing changes were introduced by this audit.

## 16. Delivery gate and open verification

The earlier concurrent-publishing pause was resumed by the user. The isolated
candidate now preserves the source baseline identified above. Only its own
documentation commit may be published after the matching checks finish; no
earlier validated snapshot may be force-pushed over another session's work.

Step 0 must be committed separately as
`chore: document current architecture and stability baseline`, pushed, and
verified before Step 1 begins. Keep unrelated pending styling and workspace
changes out of the commit.

Open provider/configuration evidence, without changing settings:

1. Exact Step 0 commit's GitHub ref and Vercel success.
2. Organization rulesets, production Node runtime and environment separation;
   preserve the verified absence of one-time maintenance flags.
3. Exercise authorization against the incoming dated Supabase metadata; reconcile
   missing/duplicate migration history without blind production replay.
4. Recovery email template/expiry and an isolated reset journey through login
   with the new password; the incoming Auth configuration snapshot alone does
   not establish delivery or one-time-link behavior.
5. Provider/cron failure logs and alert delivery, backup retention and restoration
   ownership, and included usage/spend controls.

Do not mark any later numbered step complete from this baseline document.
