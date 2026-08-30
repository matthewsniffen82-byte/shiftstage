# MyDancr production security hardening: Phase 0 audit

Date: 2026-08-29
Baseline commit: `5fa5263b039fe8df98d63aa0d1681d07529adfe5`
Scope: read-only repository, deployment, and live health discovery before incremental security changes

## Executive summary

The source audit did not confirm a critical credential exposure, a privileged credential in a browser module, a missing RLS-enable statement on an application table, an unbounded API request body, or a known npm dependency advisory at this baseline.

MyDancr already has substantial security controls: server-validated Supabase sessions, explicit admin and route authorization checks, RLS migration coverage, private sensitive storage buckets, bounded request bodies, server-side upload inspection, signed webhook verification, security headers, rate limits on several high-risk public actions, and transactional/idempotent financial workflows.

The highest-priority residual risk is production assurance. The repository contains 106 ordered Supabase migrations, but the documented workflow applies them manually through the Supabase SQL Editor. This checkout has no Supabase project configuration, migration deployment job, or database connection that can prove the production database is at the repository's expected schema and policy state. The successful `/api/health/supabase` response proves connectivity, not migration, RLS, storage-policy, or function-grant parity.

The first implementation step should strengthen and test the complete server-only credential boundary without changing behavior. No Step 1 code is included in Phase 0.

## Method and limitations

Phase 0 used only non-mutating inspection:

- repository and route inventory;
- Git branch, remote, and recent delivery history inspection;
- deployment configuration and documentation review;
- environment-variable name comparison without printing secret values;
- secret-reference and client-import searches;
- API authentication, authorization, body-bound, and service-role inventory review;
- cumulative Supabase schema, RLS, policy, storage, function, and grant inspection;
- upload, URL, redirect, XSS, injection, financial, webhook, rate-limit, and error-boundary searches;
- `npm audit --json` and `npm audit --omit=dev --json`;
- read-only production health checks and exact-commit deployment status.

This audit did not connect directly to production Postgres, Supabase Storage metadata, Supabase Auth configuration, Vercel environment-variable values, Stripe, Resend, OneSignal, NATS, or provider dashboards. It did not perform active privilege-escalation, race, upload, or denial-of-service attempts against production. Those checks belong to their numbered implementation steps and the final safe adversarial test.

## Delivery and environment map

- Repository: `matthewsniffen82-byte/shiftstage`
- Audited local branch: `codex/neutral-ride-button-20260829`
- Audited `origin/main`: `5fa5263b039fe8df98d63aa0d1681d07529adfe5`
- Hosting: Vercel, Next.js build command `npm run build`
- Production delivery: pushes merged to `main` trigger Vercel; pushing and deployment are not separate actions
- Exact baseline deployment: GitHub combined status `success`, Vercel context `success`
- Production health at audit time:
  - `https://www.mydancr.com/api/health`: HTTP 200
  - `https://www.mydancr.com/api/health/supabase`: HTTP 200
- Database/Auth/Storage: one production Supabase project is documented
- Database delivery: migrations are documented as manually applied in order through Supabase SQL Editor
- Preview/staging: no separate Supabase staging project or verified preview-database workflow is documented in this repository
- Automated checks: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`
- Scheduled jobs: Vercel cron routes for image moderation, video moderation, DMCA restoration, shift check-ins, and finance

No repository GitHub Actions workflow was found. Later steps must use the existing main-to-Vercel workflow and must not trigger a second deployment after a successful push deployment.

## Application attack surface

### Runtime and route surface

- Next.js 15 application with 109 API route handler files
- no Next.js middleware file
- no server-action marker found; mutations are implemented through route handlers and service/database functions
- public discovery, dancer, venue, customer, agent, admin, finance, moderation, support, notification, event, NFC, deal, DMCA, auth, health, webhook, and cron surfaces
- Supabase browser client uses only the public URL and anon key
- request-scoped Supabase client validates access tokens with `auth.getUser`
- service-role client is used for server-controlled work

Because there is no global authorization middleware, security depends on each route's explicit guard plus database RLS. Existing inventory tests reduce this risk, but every new or renamed route must continue to be classified fail-closed.

### Data and database surface

- 106 SQL migrations
- 78 application tables detected in cumulative migration history
- all 78 detected application tables have an RLS-enable statement in migration history
- 187 `create policy` statements detected across cumulative migration history
- 124 `SECURITY DEFINER` occurrences; the current-definition scan did not identify a definer function missing a controlled `search_path`
- a later migration revokes browser-role execution of security-definer trigger and event-trigger functions

Six RLS-enabled tables have no direct `create policy` definition in the migration history and therefore fail closed to browser roles unless reached through an authorized server/database function:

- `account_recovery_events`
- `age_verification_sessions`
- `payout_provider_oauth_states`
- `venue_dancer_affiliation_events`
- `venue_dancer_affiliations`
- `venue_dancer_verification_tokens`

That pattern appears intentional for internal or function-mediated records, but production state and every legitimate flow must be verified during Step 4.

### Authentication and authorization surface

- Supabase Auth for signup, login, refresh, recovery, and account provisioning
- server route helpers validate sessions instead of treating local storage as an authentication boundary
- database signup trigger restricts public signup metadata to customer and dancer roles; admin and venue roles require trusted service-role app metadata
- admin routes are expected to call `requireAdmin`
- cron routes authorize before constructing the service-role client
- Stripe webhook verifies the provider signature
- ordinary private routes use request-scoped authentication
- 11 public service-role exceptions are explicitly allowlisted by a regression test and require individual abuse/validation review

### Media and storage surface

- image validation limits raw uploads, detects JPEG/PNG/WebP signatures, checks dimensions and pixel bounds, decodes with Sharp, re-encodes sanitized output, and applies final size limits
- media request throttling exists for authenticated image and video actions
- verification documents, moderation temporary/review media, venue ownership proofs, TV videos, and media originals are configured as private buckets
- approved dancer photos and public venue assets are intentionally public
- TV uploads use signed upload URLs, user/dancer-owned paths, size/type/dimension/duration bounds, stored-object checks, private delivery, and moderation processing
- recent migrations remove direct browser write grants for server-managed dancer, TV, venue, and verification media; production parity must still be proven

### Financial and attribution surface

- NFC redemption issuance and confirmation run in database transactions
- redemption rows are locked with `FOR UPDATE`
- expiration and state transitions are checked inside the transaction
- unique redemption/revenue/commission constraints are present
- advisory transaction locking serializes dancer monthly commission counters
- provider calls use idempotency keys, and webhook events are idempotently recorded
- payout reservation and ledger state include duplicate/concurrency safeguards

These are strong source-level controls. Step 9 still requires authorized, safe concurrent tests against a non-production or isolated test dataset before production verification.

### Browser and input surface

- CSP, HSTS, clickjacking, MIME-sniffing, referrer, permissions, opener, and related headers are configured globally
- API responses receive `Cache-Control: no-store`
- CSP blocks objects and script attributes, restricts frames, and currently permits inline scripts and styles
- the single `dangerouslySetInnerHTML` use renders a source-defined Android device-class bootstrap; no user input reaches it
- no application `eval()` or `new Function()` use was found
- auth callback return paths reject external origins and encoded authority separators
- stored social and DMCA URLs are normalized to HTTP/HTTPS
- Google Maps redirects construct a fixed Google origin and encode the address as a query parameter
- all detected JSON, form, text, and raw API body consumers use bounded readers

### Third-party and secret surface

Server-side integrations include Supabase, OpenAI, Stripe, Resend, OneSignal, NATS, Google Maps, ffmpeg, and payout-provider adapters.

No committed high-entropy credential pattern was found, no client component directly references `process.env`, and no `NEXT_PUBLIC_` privileged credential name was found. The audit did not reveal a credential value requiring rotation.

## Prioritized findings

### Critical

No confirmed critical finding was identified from the repository and authorized read-only production checks.

### High

#### H1. Production Supabase security state is not reproducibly verifiable

The repository has 106 migrations, while the setup documentation describes manually applying only the earliest migrations through the SQL Editor. There is no checked-in Supabase project configuration, automated migration job, migration ledger verification command, or documented staging database. Therefore the codebase cannot prove that production has the latest RLS policies, storage-policy revocations, function grants, signup-role restrictions, and transactional security changes.

Risk: a secure repository state can coexist with an older or partially applied production database state.

Required handling: before Step 4 modifies any policy, establish the exact production migration ledger and a safe apply/rollback/verification workflow. If the target cannot be proven, stop rather than apply migrations by assumption.

#### H2. The explicit server-only regression boundary covers too few privileged modules

`src/lib/supabase/admin.ts` and `src/lib/stripe.ts` import `server-only` and are covered by the privileged-client boundary test. At least 17 additional service modules or route modules reference privileged credentials or secret-derived controls without the same explicit module marker and full import-graph classification. No current client import was found, so this is a future-regression boundary weakness rather than a confirmed browser leak.

Risk: a later client import or refactor could pull a secret-bearing module toward the browser boundary before review.

Required handling: Step 1 should classify every privileged module, add `server-only` to reusable server modules where compatible, expand import-graph regression tests, and verify built browser artifacts contain no privileged names or values.

### Medium

#### M1. Environment configuration has drift and coupled secret fallbacks

The source references production controls not represented in `.env.example`, including `CRON_SECRET`, `DANCR_ACCOUNT_RECOVERY_SECRET`, `DANCR_PUBLIC_RATE_LIMIT_SECRET`, `DMCA_RATE_LIMIT_SALT`, and `VENUE_CLAIM_CODE_SECRET`. Some request-identity HMAC functions fall back to `SUPABASE_SERVICE_ROLE_KEY` when a dedicated secret is absent.

Risk: incomplete environment provisioning can silently couple unrelated security controls to the service-role key, complicate rotation, and make configuration review unreliable.

Required handling: Step 1 must inventory actual Vercel variable presence without printing values, document every production variable, introduce dedicated secrets safely, and avoid removing compatibility fallbacks until the deployed environment is proven ready.

#### M2. Public service-role routes rely on a manually maintained exception inventory

Eleven public routes intentionally construct a service-role client for auth, recovery, anonymous signals, deal/NFC events, reports, DMCA, and venue onboarding. A test requires these exceptions to remain explicit, and many already have validation/rate controls.

Risk: a future exception could perform privileged work with insufficient per-action authorization or abuse controls.

Required handling: Step 6 must review each exception's authentication intent, allowed fields, record ownership, error output, and abuse controls. Step 10 should add or strengthen database-atomic limits where simple count-then-insert throttles can race.

#### M3. Sensitive server queries still use wildcard projections

Fifteen `.select("*")` uses remain in finance, payout, image-moderation, and cron code. They are currently server/admin paths rather than confirmed public leaks.

Risk: schema growth or response refactoring can expose fields that were never intentionally selected.

Required handling: Step 11 should replace wildcard projections on sensitive tables with explicit field allowlists and add response-shape tests.

#### M4. CSP still permits inline scripts and inline styles

The deployed policy includes `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`. The only `dangerouslySetInnerHTML` use found is a static internal bootstrap, and script attributes are blocked.

Risk: allowing inline script weakens CSP's mitigation value if an HTML injection bug is introduced elsewhere.

Required handling: Step 12 should evaluate a nonce/hash-compatible CSP using actual Next.js output and required integrations. It must be deployed and tested incrementally to avoid breaking mobile rendering or application bootstrap behavior.

#### M5. Global authorization depends on route-by-route discipline

There is no middleware authorization layer. Existing tests classify service-role routes and verify common boundaries, but route-local checks remain the primary application boundary above RLS.

Risk: a new route can be insecure if it is omitted from the relevant inventories.

Required handling: Steps 3, 5, and 6 should produce a complete route/operation authorization matrix and make the automated inventory fail for any unclassified sensitive route.

### Low

#### L1. The public Supabase health route bypasses the shared server-only admin client

The health route directly reads `SUPABASE_SERVICE_ROLE_KEY` and performs a REST probe. Its client response is generic and covered by a disclosure test, but provider error bodies are written to server logs.

Required handling: Step 1 should place it behind the same explicit server-only boundary; Step 14 should confirm logged provider errors cannot include sensitive row data or excessive internals.

#### L2. Security setup documentation is stale relative to migration history

`docs/supabase-setup.md` documents the first migrations but not the full ordered migration set or a parity check.

Required handling: update operational documentation only within the security step that establishes the verified migration workflow.

#### L3. The npm script allowlist configuration produces an npm compatibility warning

`npm audit` reports zero vulnerabilities across 418 dependencies, but npm warns that the project-level `strict-allow-scripts` option will stop working in the next major npm version.

Required handling: Step 16 should verify the intended supply-chain enforcement remains effective with the project's pinned npm/runtime versions before changing configuration.

## Existing controls to preserve

Later steps must preserve these verified source-level boundaries:

- no privileged `NEXT_PUBLIC_` variables;
- server session validation with Supabase Auth;
- role creation restrictions in the auth bootstrap trigger;
- route inventory checks for service-role usage;
- admin and cron authorization before privileged clients;
- bounded request readers and generic API errors;
- RLS on all detected application tables;
- controlled `search_path` on security-definer functions;
- private verification, moderation, ownership-proof, TV, and original-media storage;
- server-side image byte/signature/dimension validation;
- signed Stripe webhook verification;
- database locking, uniqueness, expiry, and idempotency for redemption and payout paths;
- production security headers and API no-store behavior;
- current zero-advisory dependency baseline.

## Incremental implementation order

Each numbered step must be isolated. The next step may start only after the current step passes the full test/typecheck/lint/build gate, is committed, pushed to `origin/main`, reaches exact-commit Vercel success, and passes production smoke/regression verification.

1. **Secrets and client/server boundaries:** expand server-only classification, close environment-contract drift, verify browser bundles, and confirm dedicated secret provisioning without printing or rotating credentials silently.
2. **Authentication and sessions:** test signup/login/logout/reset/refresh/expiry and cookie/token handling with server authority.
3. **Authorization and IDOR:** build a resource-operation ownership matrix and test cross-user, cross-dancer, and cross-venue identifiers.
4. **Supabase RLS:** first prove the production migration ledger; then test every table with authorized and unauthorized identities before any policy deployment.
5. **Admin security:** independently verify every privileged route, RPC, and destructive operation; add safe audit events where absent.
6. **API routes and server actions:** classify all 109 route handlers, especially the 11 public service-role exceptions, and enforce schemas/field allowlists.
7. **Input, XSS, injection, and URL security:** regression-test stored fields, redirects, protocols, dynamic queries, and rendered URLs.
8. **Media and storage:** verify production buckets/policies, ownership, byte signatures, object metadata, file bounds, signed URL scope, and deletion authorization.
9. **Deals, scans, referrals, and commissions:** run isolated replay and concurrency tests against transactional database functions and provider idempotency paths.
10. **Rate limiting and abuse defense:** inventory high-risk actions and move race-sensitive limits to atomic storage where needed while preserving normal use.
11. **Scraping and data exposure:** define public fields, replace sensitive wildcard projections, and bound pagination and expensive queries.
12. **Security headers:** tighten CSP carefully with preview/production page and integration verification.
13. **Webhooks and integrations:** verify signatures, timestamp/replay windows, idempotent claims, and duplicate processing for every provider callback.
14. **Errors and logging:** standardize production-safe errors and structured security events without credentials, tokens, or private documents.
15. **Database functions and RPCs:** re-audit execution grants, caller authorization, `search_path`, and RLS interaction using the verified live schema.
16. **Dependencies and supply chain:** preserve the zero-advisory baseline with targeted updates and verify install-script allowlisting.
17. **Application-level denial-of-service resilience:** bound queries, fan-out, media processing, analytics, and cron workloads.
18. **Final adversarial test:** safely exercise the authorized test matrix without production flooding or destructive denial-of-service behavior.

## External security actions

No credential value was found exposed or committed, so Phase 0 does not declare a credential-rotation incident.

Before Step 4, external production evidence is required for:

- the Supabase project identity;
- the applied migration ledger through the expected latest migration;
- current RLS enablement and policies;
- current storage bucket privacy and object policies;
- current RPC/function execution grants;
- a safe staging or transactionally controlled verification method.

If those facts cannot be established from an authorized connection, Step 4 must stop and report the required action rather than guessing or applying SQL blindly.

## Phase 0 conclusion

Phase 0 changes documentation only. It makes no runtime, UI, environment, database, storage, auth, or provider change. Step 1 has not started.
