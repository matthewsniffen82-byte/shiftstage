# MyDancr production reliability and security audit

Audit date: 2026-09-07. Phase: **0 — inspection and baseline validation only**.

Audited source: `7ac124e850c80f5b72fee8d621ca146919b93f50` on `origin/main`. Inspection began at `7da1a53c286c2b4ea547d7dc769a75bbb951a177`; the subsequent schedule-card styling/test change was reviewed and incorporated before final validation. Work was performed in an isolated checkout to preserve unrelated local work.

**Status:** the existing application has substantial regression and security coverage, but it does not yet have the requested automated production reliability system. No dependency, application behavior, database setting, infrastructure setting, paid service, or workflow was changed in this phase. The owner subsequently approved use of existing Vercel included credits for the phase deployments, with no overage or upgrades authorized. See the release addendum below. No later phase should begin before this phase's push is completed and verified.

## Scope and evidence limits

The audit inventoried tracked source, dependencies, scripts, configuration, API routes, tests, migrations, and operational documentation. At the audit baseline there are 853 tracked files, 112 API routes, 283 test files, and 120 SQL migration files. Environment **names and code paths**, rather than secret values, were inspected. The dependency lockfile and existing matching installed dependencies were reused; no package installation was needed.

Evidence distinctions used throughout this report:

- **Current source / executed locally:** code and commands inspected or run for this phase.
- **Current provider observation:** read-only GitHub/Vercel repository, deployment, and usage information inspected during this phase. The initial `7da1a53c` deployment was Ready, Production; both `7da1a53c` and final source baseline `7ac124e8` have successful Vercel GitHub statuses. This does not certify any future audit commit.
- **Prior operational evidence:** existing September 7 Supabase reports in this repository. Their historical observations are identified explicitly and were not re-run against production in this phase.
- **Unverified:** real email inbox delivery, provider configuration not inspected this phase, live multi-user authorization, real browser journeys, restoration, and future workflow runtimes. Passing source/mocked tests does not establish these outcomes.

No production passwords were changed, emails sent, user records written, workers invoked, migrations applied, or billing settings changed by this phase. No production credentials were supplied to the local validation commands.

## Architecture and existing protections

| Area | Current implementation and evidence | Reliability implication |
| --- | --- | --- |
| Framework | Next.js **15.5.22**, React/React DOM **19.2.7**, TypeScript **5.9.3**, resolved from `package-lock.json` | Keep the current Next App Router architecture; do not rebuild the application. |
| Package management | npm, lockfile committed, `packageManager: npm@11.19.1`, `.npmrc` script restrictions and explicit install-script allowlist | Pin the same npm version in future Linux CI, including nested lifecycle commands. |
| Public application | `app/route.ts` serves the existing `outputs/index.html` shell; `src/lib/dancr/live-shell-script.mjs` externalizes its script; `src/generated/live-shell-version.ts` controls cache invalidation | The large legacy shell and React pages both need real browser coverage. A successful Next build alone does not exercise shell interactions. |
| React pages | App Router account, authentication, dancer, venue, and admin flows coexist with shell overlays | Test both navigation forms and their shared browser session transport. |
| APIs | 112 route files; major groups include admin (28), venue (21), dancer (20), public (13), customer (8), and cron (5) | Public, owner, venue-member, and admin boundaries need separate positive and negative coverage. |
| Supabase | `@supabase/supabase-js` / Auth client **2.108.2**; separate browser, anonymous server, verified-request, and server-only privileged clients | Never give browser tests or untrusted PR jobs the service-role key. |
| Auth / middleware | Custom bearer-token/localStorage session transport; verified server `getUser` / refresh; middleware refreshes API sessions, rather than using an SSR cookie adapter | Do not replace this with a generic Supabase cookie example. Preserve refresh delivery, same-user validation, and race guards. |
| Database | 120 migrations; grants, RLS, ownership checks, security-definer RPC restrictions, constraints, indexes, and atomic financial/publication operations | Repository checks are extensive; disposable database execution and historical migration reconciliation are still needed. |
| Storage | Server-managed paths, signed upload support, media validation, private originals and sensitive buckets; published dancer photos remain public | Public object URLs have different privacy semantics from profile visibility. Bucket changes require a reviewed compatibility migration. |
| Request limits | Bounded JSON/multipart inputs, account-recovery/public/media limits, hashing of request identifiers, atomic rate-limit RPCs | Compatibility fallbacks need explicit coverage and a readiness assertion that expected production RPCs exist. |
| Transport | Supabase Auth/database timeout 15 seconds, Storage 120 seconds; browser transport 45 seconds and media 180 seconds | Existing bounded requests and no automatic retries of mutations/token rotation protect against hangs and duplicate effects. |
| Error handling | `safe-error-metadata.ts`, safe public API error mapping, consistent outage handling and no-store auth responses | Extend this foundation; do not introduce raw exception, request, token, or response-body capture. |
| Headers | `next.config.mjs`, root CSP helper, API response helpers: HSTS, nosniff, frame restrictions, referrer policy, CSP, and permissions policy | Root shell hashes and restrictive API CSP already help; global Next CSP still allows inline scripts/styles and needs compatibility-aware review. |
| Deployment | Existing Git-linked Vercel project; `vercel.json` runs pinned npm installation and `npm run build` | Vercel can deploy a push independently of future GitHub test status unless a supported gate is deliberately configured. |
| CI/CD | No tracked `.github` workflows or browser-test configuration found | No repository-managed required CI checks or scheduled verification are currently installed. Remote branch/deployment protection settings were not certified. |
| Tests | Node's built-in runner, TypeScript transpilation fixtures, executable mocked route/session tests and source/SQL assertions | Reuse this suite. Distinguish executable behavior tests from static assertions and actual database/browser tests. |
| Monitoring | Existing Vercel runtime logs/observability and application console diagnostics; health routes and a read-only Supabase readiness script | No configured end-to-end alert delivery was verified. No centralized frontend exception or unhandled-rejection collector was found. |

## Authentication and password recovery: highest priority

Relevant sources include `app/api/auth/route.ts`, `app/auth/callback`, `app/account/reset-password`, `app/api/account/route.ts`, `src/lib/dancr/account-recovery.ts`, `src/lib/dancr/browser-session.ts`, `src/lib/supabase/request.ts`, `src/lib/supabase/session-transport.ts`, and `middleware.ts`.

Existing protections observed in source:

- Login, signup and password update preserve the exact password string. Signup does not accept arbitrary privileged role metadata. Venue/admin entry paths have separate server-side checks.
- Reset requests use neutral account-existence responses, bounded input and rate limiting. Provider delivery failures return an actual service error instead of falsely claiming success. Recovery uses a safe redirect destination.
- The callback supports the current implicit/token-hash recovery contract, prioritizes recovery navigation, removes credentials from the address bar, and handles invalid/expired links, storage failures and transient provider failures explicitly.
- A code-only PKCE callback without the originating verifier is **not** a supported cross-device recovery path. Preserve the configured confirmation-link contract until any deliberate PKCE migration includes verifier storage and tests.
- Password changes require a verified session and account lookup before the write. A successful password write remains successful if subsequent best-effort session revocation or notification fails; the response reports partial outcomes truthfully.
- Refresh results only replace the session that initiated the refresh. Logout, account switching, overlapping responses and expired sessions have regression coverage. JWT decoding schedules refresh; it is not sufficient authorization by itself.
- Authenticated responses and rotated-token headers must never be recorded by monitoring. Browser storage key `dancrAuthSessionV1` and `x-dancr-session-*` headers contain credentials.

The following remain **unverified in this phase**: a real dancer signup email, delivered verification link, delivered password-reset email, actual generated redirect destination, expired/used-link behavior against the provider, password update followed by login with the new password, and a second-device recovery journey. Existing mock tests are not a substitute.

Prior reports (`supabase-production-follow-up.md`, `supabase-operational-verification.md`) record a production Site URL of `https://www.mydancr.com`, an exact `/auth/callback` redirect, a `.ConfirmationURL` reset template, Resend SMTP, a one-hour access token, and prior session settings. Those are historical observations, not fresh configuration certification. They also identify duplicate DMARC records as a delivery configuration issue; that is not proof of the cause of any particular failed email.

Planned verification must use designated disposable accounts and a local mail inbox in an isolated environment first. Real provider/inbox smoke tests need a designated address, verified test environment and cost approval before sending anything. Never reset a real user's password to prove a test works.

## Supabase, migrations and data protection

The current code already includes the September 7 access-boundary and atomic-operation repairs. `supabase-production-follow-up.md` records previous critical/high findings as repaired. This audit does **not** reclassify those historical defects as newly confirmed live vulnerabilities.

Current-source protections include restrictive public projections/column grants, exclusion of legal names and private metrics, explicit outer venue correlation, server-controlled content writes, restricted RPC execution, signed storage operations, ownership validation, and atomic financial redemptions. API authorization is essential because service-role operations can bypass RLS; both route guards and database policies must be tested.

Migration replay is not yet safe as an unattended test setup. Four version identifiers are duplicated:

| Version | Files sharing the version |
| --- | --- |
| `202606280001` | `add_venue_user_role`, `shift_location_checkins` |
| `202608040001` | `public_media_watermarks`, `qr_finance_operations` |
| `202608080001` | `multi_offer_club_deals`, `mydancr_tv_thirty_second_feed_distribution`, `separate_venue_receivables_and_dancer_payouts` |
| `202608180001` | `bitsafe_payout_provider`, `fix_dancer_profile_commission_at_fifty_percent` |

Historical files include data transformations and retired integrations. Do not rename versions, mark all migrations applied, or replay the entire history against production to resolve this. Compare the ledger with actual definitions, then create a reviewed **disposable test baseline** or reconciled migration strategy. No local Supabase configuration, Docker runtime, `psql`, or Supabase CLI was available in the inspected environment.

The required database test matrix is anonymous, authenticated non-owner, owner, unrelated venue member, same-venue member, and admin where supported. Verify both denied reads/writes/deletes and permitted operations. Include direct database access, public projections, Storage paths, role escalation and server-side RPCs. Static SQL matching alone cannot prove policy behavior.

`scripts/check-supabase-readiness.mjs` already performs read-only checks for Auth, required schema/RPCs and protected/public projections. Its current privileged credential is unsuitable for untrusted PR jobs. A future private/manual check should use the least privilege practical, print only named checks and statuses, and never expose credentials to a general agent.

Prior operational evidence reports daily database backups, no enabled PITR, no completed restore drill, and no verified Storage-object recovery. These remain operational gaps; database backups alone do not establish media recovery. The prior inactive Club Deal constraint exception must be preserved. No production data repair or restoration was attempted here.

## Scheduled jobs, integrations and environment boundaries

Five existing Vercel jobs run daily in UTC: image moderation at 09:00, video moderation at 09:15, DMCA restoration at 09:30, shift check-ins at 09:45, and finance at 10:00. Cron authorization uses a constant-time bearer-secret check and fails closed when the secret is missing. These workers can change data, send notifications, invoke AI, or affect financial processing. **They must not be invoked as health checks or duplicated by GitHub schedules.**

The postbuild script `scripts/manage-layout-review-postbuild.mjs` can run demo population/synchronization when explicit flags and production confirmation markers are present. The local build printed `LAYOUT_REVIEW_POPULATION_SKIPPED`. Current live environment flags were not re-certified in this phase. Future CI must prevent these mutation flags from entering test builds; production configuration must be reviewed without revealing values before relying on a build as a read-only operation.

| Integration | Actual code/infrastructure role | Test and cost boundary |
| --- | --- | --- |
| Supabase | Auth, Postgres, RPCs and Storage | Reuse local/disposable fixtures; no new hosted project, branching, PITR or compute add-on without approval. Live probes consume existing quotas. |
| Vercel | Existing production hosting, builds, functions, logs and five cron jobs | Builds and requests are metered. Do not add drains, extra monitoring, higher limits or paid protection features automatically. |
| Stripe | Existing invoice/webhook and conditional payout paths; SDK 16.12.0 | Mock provider calls and signatures locally. Never use live money movement or alter billing to test. Do not resurrect obsolete dancer subscriptions. |
| NATS | Conditional commission settlement API/affiliate portal integration | Leave activation and licensing untouched; use fixtures for settlement states and idempotency. |
| OpenAI | Existing image/video moderation and related server calls; SDK 5.23.2 | Mock all automated test calls. No live AI API usage, model upgrade, or additional moderation schedule is authorized by this audit. |
| Resend | Existing transactional email and prior documented Supabase SMTP setup | Local inbox/provider mocks first; no new sending service or unsolicited email tests. |
| OneSignal | Existing notification delivery and opt-in browser SDK in `src/lib/dancr/customer-push.ts`, scoped push worker | Mock permission/subscription/provider boundaries; do not activate or expand a plan or send real notifications. |
| Other browser integrations | Google Fonts, outbound Maps/Uber/social actions; QR image service and legacy external image references where used | Test URLs/behavior with fixtures; a CSP allowance or example environment key alone does not prove an SDK is active. Avoid external navigation/request storms in E2E. |
| Retired services | Yoti, VerifyMyContent and Bitsafe removal/decommission migrations remain in history | Do not reinstall, re-enable or test obsolete flows as if they were current features. |

Environment review covered public site/Supabase settings, server-only Supabase credentials, admin/signup guards, cron and request-hashing secrets, Stripe/webhook/payout gates, OpenAI moderation settings, Resend/OneSignal settings, conditional NATS settings, and demo/postbuild controls. `src/lib/env.ts`, `src/lib/server-env.ts`, `.env.example`, `next.config.mjs` and call sites define these boundaries. Public Supabase configuration is validated to reject secret/service-role keys. Production values were not copied into this checkout or report. Example keys for legacy Stripe/Maps functionality do not establish live use.

## Highest-risk user journeys and test gaps

| Journey | Existing protection | Required additional evidence |
| --- | --- | --- |
| Dancer signup → verification → login | Role/provisioning/input/auth regression tests | Browser flow, disposable Auth user, captured local verification email, duplicate and invalid signup cases |
| Reset request → email → callback → new password → new login | Recovery, exact-password, redirect, session and partial-success regressions | Real local Auth/mail lifecycle; expired, invalid and reused links; cross-device/provider smoke only when safely configured |
| Session expiry / logout / account switch | Refresh race and response-order tests | Browser reload, multiple tabs, stale requests and provider outage recovery |
| Profile edit / publish / visibility / schedules | Owner/role/publication/shift route tests and SQL assertions | Real browser interactions and disposable database positive/negative access cases |
| Photo/video upload and playback | Format, size, decompression, ownership, moderation and playback regressions | Browser upload/player/error cases using small synthetic media; private-object and public-URL semantics |
| Dancer/venue discovery and detail | Loading recovery, public projection, card and action tests | Mobile browser rendering, missing/slow media, bounded network work and outbound action URLs |
| NFC/QR/deal/referral | Signed/authorized actions, attribution and atomic financial tests | Isolated valid/invalid/duplicate/concurrent actions and cross-venue denial; no production redemption |
| Admin/venue financial and moderation actions | Active-role guards, validation, webhook verification and idempotency | Unrelated-user denial and mocked provider failures; production money movement excluded |

## Risk register

No new **confirmed critical production vulnerability** was established by this bounded phase. This is not an absence-of-vulnerabilities guarantee. Exposed protected data, broken authorization, widespread auth failure and production unavailability must be classified CRITICAL/HIGH if subsequently observed.

| ID | Severity | Finding and evidence | Recommended response |
| --- | --- | --- | --- |
| H-01 | HIGH | No repository-managed CI/deployment gate. A Git push can trigger Vercel before future independent checks finish. | Design a supported release gate that validates the exact deployable SHA. Verify branch/deployment protection capabilities before claiming enforcement. |
| H-02 | HIGH | No real browser or disposable Supabase/Auth/mail integration suite. Current passing mocks cannot prove password-reset delivery/lifecycle. | Add efficient browser and isolated Auth/mail tests, with password reset as the first complete critical path. |
| H-03 | HIGH | Duplicate historical migration versions; no ready disposable database baseline. | Reconcile history read-only and review a safe local fixture strategy. Never auto-replay or repair the production ledger. |
| H-04 | HIGH | No verified alert delivery for frontend failures, API outages or failed existing cron jobs. | Extend existing safe logging; add bounded collection/health checks and actionable failure summaries without a new paid service. |
| H-05 | HIGH | Restore and Storage-object recovery remain unproven in prior operational reports. | Plan a restore drill into an isolated, approved destination; explicitly estimate any storage/compute cost first. |
| H-06 | HIGH | Public photo object URLs may remain reachable after profile privacy changes; documented existing bucket behavior. | Treat visibility and object confidentiality separately. Obtain review for a compatible private-media migration; do not flip the bucket or break existing media. |
| M-01 | MEDIUM | Dependency audit exits nonzero: `qs` 6.15.3, transitively through Stripe, has two moderate advisories. Reachability/exploitability in MyDancr was not established. | Review a compatible patched resolution and run security/provider regressions in the dependency-security phase. Do not hide the audit failure. |
| M-02 | MEDIUM | Recovery/public rate limits have missing-RPC compatibility paths; count-then-insert is not the same atomic guarantee as the intended RPC. | Test the fallback and require expected RPC availability in private readiness checks; avoid accidental fallback during production drift. |
| M-03 | MEDIUM | Public Supabase health route performs uncached upstream work and exposes a component label; no Storage check. | Add bounded lightweight probes and minimal public status in Phase 6; keep diagnostics private and cap probe load. |
| M-04 | MEDIUM | Safe error helper exists, but console call sites include account/role/context fields; no comprehensive telemetry redaction boundary. | Minimize identifiers and sanitize all proposed error capture. Exclude tokens, headers, bodies, private media and unnecessary PII. |
| M-05 | MEDIUM | Shared Next CSP permits inline script/style execution for current compatibility. | Inventory nonce/hash feasibility before changes; add executable XSS/redirect/upload tests while preserving working pages. |
| M-06 | MEDIUM | Large public shell and no measured browser/network/bundle performance budget; build summary does not include all externalized shell weight. | Baseline actual route/network behavior; test missing media, request deduplication, pagination and lazy loading without redesign. |
| M-07 | MEDIUM | Prior report identified duplicate DMARC records; actual SMTP delivery and present DNS disposition not checked here. | Owner/provider review and a designated email delivery test. Do not edit DNS or assume the cause of an auth failure. |
| M-08 | MEDIUM | Production postbuild flags can enable data-writing demo scripts. Local no-op is proven; current live flag configuration is not. | Verify flags safely before release and add CI safeguards. Never execute population to make tests pass. |
| M-09 | MEDIUM | A one-run-per-commit design exceeds the Actions target even at two minutes per relevant commit at the observed commit volume. Actual push/PR frequency was not measured. | Measure candidate frequency and agree a batching/budget strategy before enabling hosted per-change checks. See estimate below. |
| L-01 | LOW | `typecheck` reruns the complete Node suite; separate CI test/typecheck jobs would duplicate work. | Split command responsibilities while preserving a complete local/release validation command. |
| L-02 | LOW | Host default npm is 11.13.0 while the project pins 11.19.1; Node emits module-type warnings for some fixtures. | Use the pinned runtime consistently; address warnings without relaxing script restrictions. |
| L-03 | LOW | Some older architecture documentation describes retired subscription/verification behavior. | Update operational docs against current call sites; avoid resurrecting removed product features. |

Dependency references: [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) and [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g). The audit reports **one affected dependency**, not two separate affected packages.

## Validation executed in Phase 0

The initial `7da1a53c` baseline passed all 1,603 tests, lint, TypeScript and the production build. The subsequent audited `7ac124e8` baseline adds one existing UI regression test. The final results below were executed against that baseline.

| Check | Result | Scope / limitation |
| --- | --- | --- |
| Complete Node suite | **PASS: 1,604/1,604**, zero failed/cancelled/skipped/todo | `npm test`; approximately 16 seconds including command startup. |
| Lint | **PASS** | `npm run lint`, `eslint . --max-warnings=0`; approximately 19 seconds. |
| TypeScript | **PASS** | `npm run typecheck`; reran all 1,604 tests and `tsc --noEmit --incremental false`; approximately 29 seconds. |
| Optimized production build | **PASS** | `npm run build`; approximately 54 seconds. Demo population skipped; no production credentials. Shared Next First Load JS 102 kB, middleware 36.1 kB; these are not total shell/page network weights. |
| `npm audit --json` | **NONZERO: one moderate dependency** | No high/critical findings returned; `qs` advisories above. No fix applied in this audit-only phase. |
| Limited tracked-text secret heuristic | No matches for the inspected private-key/live-secret patterns | Not a comprehensive secret scanner, historical scan, or credential-rotation review. |
| Live email / browser E2E / database RLS suite | **NOT RUN** | No designated test account/inbox or isolated database/browser foundation. |
| Production health / worker execution | **NOT RUN in this phase** | Avoid new metered probes and production effects; previous operational evidence is separately identified. |

Existing dependency directories matched the audited lockfile. Local validation used Node 24.16.0 and existing npm installations; no new dependencies or tools were installed. All final checks used cached npm 11.19.1, with its existing command shim on PATH for lifecycle commands. An initial final-baseline typecheck attempt failed during its pre-hook because the audit command put the npm package's internal `bin` directory on PATH instead of the cache's `.bin` shim directory. Correcting that local command resolved the setup error; the subsequent complete typecheck passed without application changes. Earlier default npm 11.13.0 emitted an unknown-config warning; Node also emits module-type warnings for some test fixtures. These are recorded rather than suppressed. Build generation artifacts are not intended audit changes and are excluded from the documentation commit. Local logs are kept outside the tracked checkout.

## Actions usage and cost assessment

### Observed activity, not a small-project assumption

The first-parent history at the initial audit baseline, using `git log --first-parent --since=2026-08-08T00:00:00Z`, contained **1,092 commits**, approximately **1,084 affecting code/configuration**, over roughly the preceding month. The latest incorporated commit adds another code change. Even two hosted minutes for each of the initial 1,084 relevant commits would consume **2,168 minutes**, before schedules, browser tests, retries or runner setup.

Consequently, an unconditional per-commit hosted suite cannot honestly be estimated below 1,000 minutes at that volume. **Commit count is not push count or workflow-run count**: a push can contain multiple commits, and no historical workflow runtime baseline exists in this repository. Measure actual candidate frequency before claiming normal usage fits. Path filtering, caching and cancellation help, but cancellation savings cannot be guaranteed for distinct completed runs. Do not omit critical checks and continue deploying merely to meet a usage target.

The repository was observed to be **public**. Standard GitHub-hosted runner compute for public repositories is currently free, but the owner's under-1,000-minute target still applies. Artifact/cache storage and any future repository visibility change need separate review. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). No paid runners or increased storage allowance are proposed.

### Conditional proposed budget

This is a design estimate, **not an installed schedule or a measured guarantee**. It requires agreement to batch development into no more than about 60 hosted release/PR candidates per month. Each change remains subject to local validation; every deployable candidate must pass the applicable hosted gate. Do not run the same candidate suite on both PR and push unnecessarily.

| Proposed work | Runs/month | Incremental Linux minutes/run | Minutes/month |
| --- | ---: | ---: | ---: |
| Relevant candidate lint, typecheck, unit/integration, security and build | 60 | 7 | 420 |
| Critical Auth/access/media browser extensions | 20 | 6 | 120 |
| Lightweight daily read-only smoke | 31 | 1 | 31 |
| Weekly comprehensive browser/database/security suite | 5 | 20 | 100 |
| Additional important-release verification only when not already covered | 4 | 10 | 40 |
| Subtotal | | | **711** |
| Retry/setup variance reserve, 20% rounded up | | | **143** |
| Conditional total | | | **854** |

Estimates include ordinary setup within each job allocation; multi-job billing rounds each job separately and must be measured. Avoid unnecessary sharding and extra setup jobs. Use standard Linux only, locked dependency caching within existing limits, path filters, concurrency cancellation, bounded tests and job timeouts. Keep daily checks independent of full dependency/browser installation. Do not upload browser traces, screenshots or sensitive payloads by default; use sanitized failure summaries and tightly bounded diagnostic retention if later approved.

If each observed relevant commit becomes a separate completed candidate run, this budget is **not achievable as proposed**. The release strategy is an owner decision before activation, not an assumption that changes have already become less frequent. Track actual usage after initial approved runs, forecast the rest of the month, and defer additional scheduled work or releases safely rather than deploy unchecked. No workflow should invoke paid AI, live moderation, payout processing, migrations, package publishing or recursive commits.

### Costs that require approval or verification

| Service/activity | Why it would be used | Cost/usage exposure | Free or lower-impact alternative |
| --- | --- | --- | --- |
| Existing Vercel builds for the requested 14 phase pushes | Required production delivery | Metered existing Pro service. The observed initial deployment took 1m27s; 14 comparable builds are about 20 minutes of build wall time before retries. Wall time is not billed CPU time; a reliable incremental dollar estimate/zero-overage guarantee was not established. | Keep reviewed commits local until included-credit use is approved; change publication cadence only with owner agreement. |
| GitHub standard Linux Actions | Automated candidate/scheduled verification | Public runner compute is currently free; actual minute target still needs batching. Storage, private visibility or larger runners can change cost. | Existing local validation, no artifact uploads, no increased cache limits, and fewer duplicate candidate runs. |
| Production health/browser probes | Detect actual outages | Existing Vercel/Supabase requests, CPU and egress; normal proposed daily probes are small but not zero. | Local mocks first; bounded daily probes only after usage is accepted. |
| Hosted Supabase staging, branches, restore destination, PITR | Real isolated provider/restore testing | Could create new compute/storage/add-on charges. **Not installed or activated.** | Local disposable Postgres/Supabase with synthetic data; local setup availability must be resolved first. |
| Email, push, AI, payments and payout tests | Provider-level integration confidence | Existing providers may bill requests/messages or cause real-world effects. | Local mail capture and mocked provider boundaries; narrowly approved test-mode probes only. |
| New monitoring/logging/browser service | Optional hosted alerting or diagnostics | Subscription, ingestion, retention or credit-card activation may cost money. **None installed or recommended for immediate activation.** | Repository tooling, existing sanitized logs, GitHub check summaries and existing notifications. |

Vercel documents automatic Git builds in [Builds](https://vercel.com/docs/builds). [Spend management](https://vercel.com/docs/spend-management) must not be assumed to provide a verified zero-charge boundary for this project; automatically pausing a production team can itself cause an outage. No budget, auto-pause, plan or billing setting was changed. Private account billing details are intentionally omitted from this public repository report.

## Recommended implementation, strictly phase by phase

| Phase | Safest implementation direction | Completion evidence required |
| --- | --- | --- |
| 1 — foundation | Retain Node tests; separate unit/integration commands; add a compatible open-source browser harness only after local/runtime cost review. | Real behavior tests run; no empty success commands or silently skipped required checks. |
| 2 — critical journeys | First implement isolated signup/recovery/login lifecycle, then profile/media/venue and existing NFC/QR/deal paths. | Executed positive/negative browser flows with synthetic fixtures and mocked paid integrations. |
| 3 — Supabase | Review migration history; create safe disposable grants/RLS/Storage tests and route ownership tests. | Anonymous/owner/other-user/admin matrix; reviewed migration impact if any change is needed. No automatic production application. |
| 4 — security | Resolve/review the dependency finding; add free secret/dependency and executable authorization/input/redirect/upload checks. | Actual scanner and regression output; no suppressed findings or weakened controls. |
| 5 — observability | Extend safe metadata with bounded frontend/backend diagnostics and explicit redaction; reuse existing infrastructure. | Tests proving credentials, PII, media and raw provider payloads cannot enter diagnostic reports. |
| 6 — health | Minimal public status; bounded internal diagnostics and low-frequency safe dependency probes. | App/Auth/database and feasible Storage checks, with no writes and explicit request/cost budget. |
| 7 — performance | Measure shell/page/media/network behavior; add lightweight size/request/loading regression safeguards. | Reproducible baselines and regressions without UI changes or needless quality reduction. |
| 8 — quality gates | Agreed release cadence, path/concurrency/cache/timeouts, critical-path selection and exact-SHA deployment enforcement where supported. | Workflow validation plus observed gate behavior; configuration limitations stated honestly. |
| 9 — schedules | One bounded daily smoke and one weekly comprehensive suite, avoiding existing worker execution. | Projected usage under target with accepted assumptions; activation only after cost uncertainty is resolved. |
| 10 — diagnosis | Sanitized reports with check, feature, severity, environment, component, reproduction and next action. | Real induced fixture failures produce useful reports without tokens or personal data. |
| 11 — maintenance workflow | Document monitor → detect → diagnose → reproduce → prepare → test → review risk → deploy → verify. | Clear approval boundary for production data, permissions, migrations, billing and paid services. |
| 12 — usage safeguards | Document actual workflows, disable controls, usage review, estimates and safe budget response. | No recursive jobs, excessive schedules, uncapped retention or unchecked releases at budget exhaustion. |
| 13 — readiness | Run all applicable checks and explicitly verify isolated password recovery end to end. | Passing/warning/manual-action report, exact commit/push/deployment evidence; remaining provider-only gaps disclosed. |

Each phase must be inspected, implemented, validated, committed, pushed and verified before the next begins. The owner's explicit safety and cost stops take precedence over automatic delivery. Phase 0 does not authorize fixing the dependency, installing test tools, enabling schedules, changing deployment controls or modifying production.

## Decisions required before proceeding

1. **Resolved:** the owner approved use of existing Vercel included credits for the mandatory phase deployments. No overage or plan upgrade is authorized; stop before exhausting the approved allowance.
2. Before hosted automation is activated, verify the push/PR candidate cadence and agree a strategy that can fit the requested minute target. The observed commit count alone does not establish workflow frequency, and one completed run per commit would exceed the estimate.
3. Resolve local disposable database/browser availability. Any new hosted test/restore destination requires a separate cost decision.
4. Designate a disposable provider-test account/address if real email/provider verification is requested after isolated tests. Preserve real accounts and credentials.
5. Review outstanding email DNS, Storage confidentiality/recovery, migration-ledger and deployment-protection items with the appropriate account owner. No sensitive configuration values should be pasted into logs or public reports.

This report establishes a source and local-validation baseline. It does not claim the requested production reliability system, live email recovery, live RLS matrix, or future under-budget automation is complete.

## Phase 0 release addendum

The audit-only commit was rebased onto `dc92aaba` after reviewing the intervening follower-count and profile-style changes. No dependency, server, Auth or database changes were present in that intervening diff. The release baseline has 1,608 Node tests; the full suite, lint, TypeScript and optimized production build passed again. The postbuild hook printed `LAYOUT_REVIEW_POPULATION_SKIPPED`. The existing `qs` dependency audit finding remains open.

Read-only Vercel review confirmed that the project environment list contains none of `DEMO_UPCOMING_SYNC`, `LAYOUT_REVIEW_POPULATE`, `LAYOUT_REVIEW_SYNC_DEALS` or `LAYOUT_REVIEW_SYNC_SCHEDULES`; the Shared tab reports no linked variables. No secret values were revealed. This resolves the immediate build-flag verification gap in M-08 at the time of review; it does not prevent future configuration drift. Included credit remained available at review; private billing amounts are omitted. This review did not modify provider settings.
