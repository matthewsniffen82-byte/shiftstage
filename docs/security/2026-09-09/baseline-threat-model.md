# MyDancr security baseline and threat model — 2026-09-09

## Scope and delivery contract

This is Step 1 of the requested 32-step production hardening pass. Source baseline: `bb14ecd162af1594c1b031d8aeb38442bbe114d6`. This commit changes audit documentation only. It does not claim that the hardening mission is complete.

Each subsequent numbered step must inspect current code, make only its own changes, run security coverage and the entire available suite, lint, TypeScript checks and production build, inspect the diff, commit, push to main, and verify the exact commit's Vercel success and application health before the next step. No paid service, credential rotation, destructive production test, or test account provisioning is included without the necessary safe environment and access.

The review inventories 116 API route files, 330 test files, 126 migration files and 82 distinct public tables created in migration history. These are source counts, not a claim that 82 tables currently exist: migrations also rename and retire objects. See the route and database inventories beside this report.

Evidence classifications used here:
- **Observed**: current source, registry advisory, or a limited live read directly supports the statement.
- **Conditional risk**: a control gap exists but exploitability depends on environment or a missing prerequisite.
- **Not verified**: requires provider settings, catalog access or disposable authenticated fixtures that this baseline did not obtain.

## System and trust boundaries

The public discovery shell in `outputs/index.html`, Next pages, customer/dancer/venue dashboards and admin UI run in untrusted browsers. All browser fields, identifiers, role claims, URL parameters, media, analytics events and forwarded headers are attacker-controlled until independently checked.

Next API handlers run on the existing Vercel deployment. They authenticate bearer tokens through Supabase Auth and use database account roles. A server-only service-role client performs necessary privileged work; its callers must establish ownership and permissions before bypassing RLS. Authentication is not authorization.

Supabase Auth, Postgres/RLS/functions and Storage are separate boundaries. Browser access to Supabase must remain secure independently of UI controls and Next handlers. Private media may be disclosed by a signed URL even if its bucket is private; signing requires its own authorization.

External boundaries include Stripe, OpenAI moderation, transactional email, OneSignal, NATS/affiliate integrations, maps and ride links. Webhooks are untrusted until verified. Media decoding with Sharp/FFmpeg is a native-code boundary. Git/npm/Vercel/Supabase operator access forms the deployment and supply-chain boundary.

Protected assets include account credentials and tokens; legal names and contact information; verification and moderation materials; unpublished profiles and schedules; private affiliations; customer activity; venue membership; admin privileges; payment/commission records; media provenance; service credentials; database/storage capacity; and public-site availability.

Likely actors are anonymous bots and scrapers, credential-stuffing attackers, malicious registered customers or dancers, hostile venue team members, compromised administrators/providers/dependencies, and clients replaying or altering legitimate requests.

## Prioritized findings

Severity below describes the risk supported by current evidence. Advisory severity is retained separately where production reachability remains uncertain. No successful production compromise was attempted or observed.

| ID | Severity | Evidence and implication | Delivery area |
| --- | --- | --- | --- |
| DEP-01 | CRITICAL advisory; production exploitation unverified | Locked Next 15.5.22 is affected by two newly indexed upstream advisories. One concerns Windows-hosted servers; production is deployed through Vercel, while this workstation is Windows. The other concerns AVIF image optimization. No Next Image imports or custom remote image allowlist were found in the reviewed source, but that alone does not prove the built-in optimizer unreachable. | Step 23; inspect media boundary in Step 13 |
| DEP-02 | HIGH | Locked Sharp 0.35.3 contains the affected libheif dependency. Image upload normalization processes authenticated user-controlled bytes, including HEIC/HEIF. Signature checks and re-encoding do not protect the decoder itself against a vulnerable native library. No exploit file was used. | Step 23 |
| DEP-03 | HIGH dependency advisory; build scope | js-yaml 4.3.1 is marked dev-only in the lockfile and has an upstream CPU-exhaustion advisory. No public YAML parsing endpoint was identified. | Step 23 |
| DEP-04 | MEDIUM dependency advisory | qs 6.15.3 has upstream parsing/DoS advisories and is in the production dependency graph. Direct application imports were not identified; trace its consumers before claiming endpoint reachability. | Step 23 |
| DB-01 | MEDIUM operational risk | Four migration version prefixes are duplicated across nine files. A migration ledger keyed by version cannot alone establish which SQL is deployed. Some historical tables are intentionally renamed/retired. Current REST schema and selected probes are useful but cannot establish every policy, function body and grant. | Steps 3 and 19 |
| ABUSE-01 | MEDIUM | DMCA notice throttling selects cf-connecting-ip/x-real-ip ahead of the hosting platform's trusted IP header, and uses count-then-insert checks. The route's source permits a caller-selected bucket on hosts that forward these headers. No rate-limit exhaustion or notice submission was performed. | Step 11 |
| ABUSE-02 | MEDIUM conditional | The shared limiter has an atomic RPC but falls back to a non-atomic count/insert path if the function is missing. The function is currently present in the live REST schema; fallback exploitation is not established in the current deployment. | Step 11 |
| CSP-01 | MEDIUM defense gap | The root shell uses script hashes, but the general Next-page CSP still permits inline scripts. This reduces defense against an injection on those pages; it is not evidence of an XSS vulnerability by itself. | Step 15 |
| MEDIA-01 | MEDIUM conditional | Stored-video validation invokes the decoder before validating the allowed container bytes. Child processes have bounded runtime/output and no shell, but no explicit protocol allowlist is supplied. An isolated local playlist probe produced zero network requests and failed decoding; SSRF was not demonstrated. | Step 13 |
| SECRETS-01 | LOW operational coupling | Several HMAC purposes use the service-role credential as a fallback signing secret. The key stays server-side, but a future database-key rotation can invalidate unrelated artifacts. No compromised credential was identified by this baseline. | Step 2 |
| BUILD-01 | LOW | The local npm installation warns that strict-allow-scripts is an unknown project setting. The deployed install command pins npm 11.19.1; effective lifecycle-script enforcement needs verification with that exact npm version. | Step 24 |
| PRIVACY-01 | LOW conditional | Public profile eligibility treats absent visibility fields as visible after approval, and a legacy missing-column fallback remains. The live schema has is_public and anonymous hidden-profile probes returned no rows. Missing-schema behavior should fail safely without weakening existing visibility controls. | Steps 26–27 |

The dependency scan reports four vulnerable packages: one critical, two high and one moderate. This is a failing security baseline to remediate, not a clean dependency result. Package changes are reserved for the user's requested dependency step; no automatic audit fix or major upgrade was run.

Primary upstream references, checked 2026-09-09:
- [Next Windows-hosted RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36): fixed in 15.5.24 / 16.3.3.
- [Next AVIF optimizer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4): fixed in 15.5.24 / 16.3.3.
- [Sharp libheif advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c): fixed in Sharp 0.35.4.
- [js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
- [qs comma parsing advisory](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) and [qs isBuffer advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).

## Threat coverage and existing controls to preserve

| Threat / surface | Existing protection inspected | Remaining validation |
| --- | --- | --- |
| Account takeover, enumeration, credential stuffing, signup/recovery spam | Bounded auth bodies, login/reset throttles, neutral reset response, exact password handling, Supabase getUser validation, safe local return paths | Provider password/email settings, expired/reset replay fixtures, throttle effectiveness and approved admin bootstrap |
| Token leakage, session theft/fixation/replay | Server-only privileged client, public-key validation, no-store token responses, explicit bearer auth, bounded refresh transport, stale-session regression tests | Browser session storage and recovery lifecycle; avoid a casual authentication rewrite |
| IDOR, broken access control, role escalation | requireAdmin checks DB role and active state; venue access checks DB membership and permission; owner-scoped updates and atomic functions; signup trigger separates trusted app metadata from public roles | Disposable User A/User B/venue/customer/admin tests and live policy parity |
| Admin compromise and destructive actions | Every inventoried admin route directly invokes authentication and requireAdmin; explicit mutation methods; financial and venue audit trails; sanitized denial logging | MFA/provider settings, bootstrap-secret lifecycle, coverage and integrity of all audit events |
| Unauthorized Supabase access / misconfigured RLS | Every historical public CREATE TABLE has an ENABLE RLS statement in migration history; corrected visibility, venue correlation and legal-name grants are present in source | Current catalog SELECT/INSERT/UPDATE/DELETE policies and actual cross-user fixtures; source text is not execution proof |
| Storage overwrite, traversal, sensitive documents | Private verification/original/moderation/video buckets; server-controlled media paths; signed upload slots; server-only image writes | Actual storage policies for every verb and object prefix; revocation/deletion behavior; signed-URL expiry |
| Malicious image/video files | Byte sniffing, native decode/re-encode, image pixel/byte limits, video byte/duration limits, moderation, private originals, random names, subprocess deadlines | Vulnerable native dependency updates; pre-decoder validation, explicit decoder capabilities and resource bounds |
| SQL/command injection | Supabase query builder and explicit RPC parameters; no identified browser-supplied raw SQL; FFmpeg uses argument arrays without a shell | Latest SECURITY DEFINER bodies, fixed search_path, grants, dynamic SQL and decoder-contained secondary resources |
| XSS / HTML injection | React escaping, social protocol/host validation, shared escaping around legacy HTML templates, root script-hash CSP; one static layout script sink | Trace each dynamic legacy template and URL sink; no custom HTML sanitizer proposed |
| CSRF / state-changing requests | Privileged APIs require an explicit bearer header, no permissive credentialed CORS; signed NFC cookie is a deterrent, not authentication | All GET semantics including signed cron routes; any cookie-only state change must be separately evaluated |
| SSRF / open redirects | Fixed maps destination, safe local return paths, safe social URLs, public-origin configuration, same-site share QR allowlist; QR generation does not fetch the encoded URL | Media decoder network behavior, integration destinations and redirect-following behavior |
| Bots, scraping, spam, fake activity | Event/report/auth/media throttles; bounded fields and relationships; public profile filters; discovery caps and caching | Public-read request cost, enumeration, shared account/IP limits, direct Supabase Auth exposure |
| DoS / excessive API and provider usage | Bounded streaming JSON/multipart readers, Supabase transport deadlines, video timeouts, media quotas, public directory caps | Expensive unthrottled reads/QR rendering, nested query bounds, concurrency and rate-limit races |
| Webhook spoofing / replay | Stripe raw-body signature verification with five-minute tolerance, size cap, supported-event allowlist and idempotent provider-event claims | Retry/concurrent-event fixtures, event ordering, provider configurations |
| Private contact/location/schedule exposure | Public response mapping and approval/visibility filters; legal-name column denied anonymously; private account endpoints require auth | Public payload field-by-field review, non-public timestamps/relationships, visibility/cache lifetime, hidden media URLs |
| Error and log disclosure | Generic public error policy, stable typed errors and sanitized metadata; health endpoints report limited status | Remaining exception sites and operator logs; never log raw tokens, passwords or verification data |
| Clickjacking, MIME confusion, unsafe CORS | Live frame-ancestors none, nosniff, HSTS and referrer/permissions policies; no ACAO on sampled same-origin responses | All page/API variants and preflights; tighten CSP without breaking required integrations |
| Secrets / supply chain / build exposure | .env files ignored, server-only service client, build-time public-key validation, locked dependencies, pinned production npm command, production postbuild mutation gate | History/artifact scans; provider permissions/protected branches; exact lifecycle-script enforcement; source-map artifacts |

No GitHub Actions workflows were found in tracked source. That does not verify GitHub branch protection, secret scanning, repository collaborators, Vercel project settings or organization access. No paid infrastructure recommendation is necessary to establish this baseline.

## Read-only live observations

Checked 2026-09-09 against the configured MyDancr production services:
- Root page, /api/health and /api/health/supabase returned HTTP 200.
- Account, admin approvals/monitoring, dancer dashboard and venue team APIs returned 401 without authentication.
- API responses used no-store and a deny-by-default CSP. Root CSP contained script hashes rather than unsafe-inline scripts. HSTS, nosniff, frame protection and referrer policy were present. No wildcard CORS header appeared on those responses.
- Supabase Storage listed ten buckets. Verification documents, venue ownership proofs, moderation temporary/review files, original images and videos were private. Public buckets were dancer photos, venue cover images, venue logos and venue QR images. Image buckets have 10 MiB limits and explicit image types; private videos have a 75 MiB limit and MP4/WebM/QuickTime types.
- A service-authenticated OpenAPI schema read returned 81 relation definitions and 154 paths. Only schema/bucket metadata was retained; no credentials or customer records were logged.
- Anonymous one-row-limited queries returned zero rows for accounts, venue membership, approval reviews, hidden profiles, unapproved profiles and disabled profiles. This does not distinguish an empty table from a blocking policy and does not prove authenticated isolation.
- Anonymous selection of dancer legal names and recovery events was rejected with permission errors. No private field values were retrieved.
- The shared atomic rate-limit RPC appears in the current REST schema. It was not invoked during the read-only baseline.

## Test scope and limitations

The existing suite mixes runtime unit tests, mocked service tests, source assertions and historical audit assertions. A passing source assertion is not a live RLS test. Existing historical review documents remain historical evidence, not fresh proof.

No production account was created or modified. No media was uploaded, no financial action or email was triggered, and no security limit was exhausted. A disposable staging Supabase project and test accounts were requested; no staging credentials or current policy-catalog session had been supplied at this baseline.

A local decoder-only probe used a temporary non-video input and an HTTP listener bound to loopback. The decoder rejected it and made zero requests. This rules out only that fixture on the installed Windows binary; it does not establish Linux decoder isolation.

Baseline validation and the delivery record are maintained in execution-ledger.md. Step 2 must not begin until the Step 1 commit is pushed, its exact Vercel status is success, and the deployment is healthy.
