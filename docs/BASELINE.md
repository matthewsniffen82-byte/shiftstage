# MyDancr production recovery baseline

## Baseline identity

| Item | Value |
| --- | --- |
| Baseline date | September 15, 2026 (America/Los_Angeles) |
| Full baseline application commit SHA | `288ef989c9e1a490f01ab97746ec2ab88ea9b113` |
| Archival branch | `baseline/stable-2026-09-15` |
| Annotated tag | `mydancr-baseline-2026-09-15` |
| Tag message | MyDancr known-good production baseline - September 15 2026 |
| Production and original development branch | `main` / `origin/main` |
| Remote repository | `https://github.com/matthewsniffen82-byte/shiftstage.git` |
| Production site | `https://www.mydancr.com` |
| Validated runtime | Node.js 24.21.0; npm 11.19.1 |

The branch and tag preserve the exact application commit that was already on
`main` when this task began. This document is delivered in a separate,
documentation-only descendant on `main`. The archival branch is a recovery point
and must not be used for normal development.

**Qualification:** the production application is deployed, builds successfully,
and passed the bounded smoke checks below. The complete automated suite is not
green: 22 existing tests fail. The requested archive preserves this state; it
does not certify that every feature or a complete database restore is fault-free.

## Repository preservation

- Initial local `main` and fetched `origin/main` both resolved to the full SHA above.
- There were no tracked modifications, staged changes, hidden skip-worktree entries,
  or assume-unchanged entries at the start.
- There were 45 untracked JPG attachments under `.codex-remote-attachments/`.
  No application references to that directory were found. They are local task
  attachments, remain untouched, and are not part of the application archive.
- Ignored application-path files were generated shell JavaScript/CSS and local
  Supabase CLI metadata. Their source, generators, schema files, assets, package
  lockfile, and deployment configuration are tracked. Build output and installed
  dependencies are intentionally excluded.
- `.env.local` is ignored. `.env.example` is tracked. No credentials, database
  passwords, service-role keys, JWT secrets, customer records, or media backups
  were added to Git.
- Existing build hooks regenerated local files without a substantive Git diff.
  Their line-ending-only changes were restored. Application source, behavior,
  dependencies, UI, migrations, and production database settings were not changed.

## Build and test results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Failed in its embedded complete test suite: 9,731 tests; 9,709 passed; 22 failed; 0 skipped/cancelled |
| `node node_modules/next/dist/bin/next typegen` | Passed |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed; run separately because the npm script stops on test failure |
| `npm run lint` | Passed with `--max-warnings=0` |
| `npm run build` | Passed; 164 application route entries compiled |
| Public-build security scan, included in build | Passed: 300 files, including 276 text files |
| Postbuild population hook | `LAYOUT_REVIEW_POPULATION_SKIPPED`; no data population ran |
| `npm run db:check-migrations` | Passed integrity checks; current full replay remains unverified as explained below |
| Read-only Supabase readiness script | All 63 checks passed using securely supplied existing configuration |
| Exact application commit deployment | Vercel `success`; production health reported the full baseline SHA |
| HTTP smoke check of the local production build | 15/15 requests returned HTTP 200 |
| Public media range reads | Video and poster both returned HTTP 206, with video/mp4 and image/webp respectively |

The `typecheck` script invokes the same `node --test tests/*.test.mjs` command as
`npm test`; the complete suite was run once. The 19 affected test files were also
rerun in an isolated `git archive` checkout of the same commit: 168 passed and the
same 22 failed out of 190 tests. No tests were edited or disabled. The video
presentation comparison specifically differs on Windows CRLF versus LF output;
the other failures were not assumed to be harmless platform differences.

Application deployment evidence:
[Vercel success for the archived SHA](https://vercel.com/ai-movie-jobs/shiftstage/FUfWcf16dQP8Tz8NA8ZS1nN1MMLQ).
Full local logs and read-only audit receipts are outside Git at
`D:/Codex/MyDancr-validation-2026-09-15/known-good-baseline/`.

## Major features and smoke coverage

All listed code paths are present and compile. HTTP checks exercise public reads
and page responses; they do not certify complete authenticated user journeys.

| Feature | Existing implementation / evidence |
| --- | --- |
| Authentication | `app/api/auth/route.ts`, `app/auth/callback/route.ts`, account UI; account page and Supabase Auth health returned 200 |
| Dancer profiles | `app/dancers/[slug]/page.tsx`, public dancer API; directory, a profile, and API returned 200; 14 Las Vegas dancers returned |
| Schedules / Working Now | `app/api/dancer/shifts/route.ts`, check-in route, `app/tonight/page.tsx`, live shell; Tonight returned 200 and public schedule projection check passed |
| Venue pages | `app/venues/[slug]/page.tsx`, public venue API; directory, a venue, and API returned 200; 17 Las Vegas venues returned |
| Video/media | TV pages/API, dancer photo/video routes, upload/moderation code; TV reads passed and public video/poster range responses returned 206 |
| Club Deals | Venue deal API, `ClubDealCard`, claim/pass/redemption routes; compiled and public deal projection check passed |
| Going signals | `app/api/customer/going/route.ts` and existing profile/live-shell actions compiled |
| Directions / rides | Customer directions API, `UberRideButton`, rides, transportation and pickup routes compiled; pickup page returned 200 |
| Admin | Admin page and all existing admin API routes compiled; page returned 200 |
| Supabase connectivity | Both application/Supabase health endpoints returned 200; readiness, catalog, storage and migration reads succeeded |
| Mobile/responsive UI | Existing live-shell styles, responsive profile/media CSS and `GlobalMobileBottomNav` compiled; automated UI assertions were run, with failures listed below |

No login/signup, email send, purchase, ride request, schedule change, Going signal,
admin mutation, or production data modification was performed for the smoke check.
A manual browser/device visual pass was not performed in this task.

## Existing validation issues

These failures are preserved and require a separate repair task. They are not
classified as minor or dismissed merely because the production build succeeds.

| Test file | Failed assertions / observed issue |
| --- | --- |
| `brand-color-system.test.mjs` | Token load order; form-field styling / expected stylesheet URL (2) |
| `cors-boundaries.test.mjs` | Public performance route exported methods absent from reviewed inventory (1) |
| `customer-saved-persistence.test.mjs` | Venue-save state after concurrent saved-list refresh (1) |
| `dancer-dashboard-control-center.test.mjs` | Expected billing/status visibility source assertion (1) |
| `dancer-discovery-header-layout.test.mjs` | Directory controls / expected stylesheet URL (1) |
| `dancer-media-identity-moderation.test.mjs` | Public TV projection source assertion (1) |
| `dancer-media-pins.test.mjs` | Test references undefined `page` (1) |
| `dancer-photo-luminosity.test.mjs` | Expected responsive image markup (1) |
| `home-mobile-feed.test.mjs` | Expected Home TV feed rendering source (1) |
| `home-tv-card-experience.test.mjs` | Expected Home TV card rendering source (1) |
| `profile-actions-compact.test.mjs` | Expected profile CSS import (1) |
| `profile-media-card-feed.test.mjs` | Expected profile media CSS import (1) |
| `public-loading-runtime.test.mjs` | Test runtime lacks `homeTvFeedPageAbort`; also reports asynchronous rejection (1) |
| `shift-form-save-recovery.test.mjs` | Test runtime lacks `offerPushNotifications` (2) |
| `site-aesthetic.test.mjs` | Expected stylesheet URL; close-control focus styling (2) |
| `video-moderation.test.mjs` | Demo auto-approval source and durable-decision assertions (2) |
| `video-playback-control-neutrality.test.mjs` | Expected stylesheet URL (1) |
| `video-resource-ref.test.mjs` | Transpiled presentation function comparison: Windows CRLF versus LF (1) |

## Supabase baseline and migration status

Production project: `hfmzwadzabmgxkjzmqun`. A repeatable-read, read-only catalog
transaction completed at `2026-09-15T20:47:38.614819Z`. It inspected schema metadata,
grants, RLS, functions, triggers, storage configuration and migration history.

- Production contains 93 public tables, 2 views, 178 public functions, 162
  application/Storage policies, 82 application-function triggers, 644 constraints,
  and 307 public indexes. All indexes were valid and ready. Of these indexes,
  168 are standalone; the rest support constraints.
- All inventoried table/view, function, policy, trigger and standalone index names
  occur in the checked-in schema baseline or subsequent migration SQL. This is
  coverage verification, not a proof of complete current catalog equivalence.
- The repository contains 191 migration files. The production ledger contains
  149 versions; every production version has a local file. There remain 39 local
  historical files without ledger versions and 4 historical version-collision
  groups. They are quarantined historical material, not a deployment queue.
- `supabase/baselines/20260914040900_application.sql` covers 182 historical files.
  Its manifest, schema hash, catalog query, normalizer and two prior independent
  PostgreSQL recovery rehearsal receipts passed the existing integrity guard.
- Nine forward migrations follow that cutoff, through
  `20260915180000_guest_pickup_chat.sql`. All nine are recorded in production.
  Eight have matching normalized repository/ledger SQL hashes and names.
- **Ledger discrepancy:** the guest-pickup migration has the expected version/name,
  but its stored statement text loses five dollar-plus-quote pairs and collapses
  ten double-dollar function delimiters. Its ledger text is not a valid replay
  source. Read-only inspection confirmed all four introduced live function bodies
  exactly match the repository bodies, and both live guest hash check constraints
  retain their expected anchored expressions. Neither history nor live schema was
  changed. Preserve the repository SQL; reconcile the ledger separately after review.
- Guard results: `baselineReplayReady: true`, `historicalReplayReady: false`,
  `forwardMigrationsRequireValidation: true`, `replayReady: false`. The combined
  baseline plus nine forward migrations was not newly rehearsed in this task.

### Storage and external configuration

All ten live bucket configurations passed the readiness checks. The schema
baseline records bucket configuration and application Storage policies:

- Public: `venue-cover-images`, `venue-logo-images`, `venue-qr-codes`.
- Private: `dancer-photos`, `dancr-image-moderation-review`,
  `dancr-image-moderation-temp`, `dancr-media-originals`, `mydancr-tv-videos`,
  `venue-ownership-proofs`, `verification-documents`.
- Image/document buckets have 10 MiB limits; the TV video bucket has a 75 MiB limit.
  MIME restrictions are preserved in the schema baseline and checked by readiness.

The repository has no complete Supabase project `config.toml`. Managed Auth and
Storage platform objects, roles/owner privileges and required PostgreSQL
extensions remain platform prerequisites. Dashboard configuration, SMTP
credentials, secret environment values, database rows, Auth users, Storage object
bytes, and provider integrations are not reproduced by Git alone.

Existing documentation records the canonical production site/callback URLs,
Resend SMTP, email-confirmation settings, session limits and MFA configuration.
Those Dashboard settings were not freshly audited here. Existing operational
reports also describe daily backups, unverified Storage restoration, historical
constraint/account exceptions, email-DNS follow-up, and pending historical
Storage signed-link revocation. Their current disposition was not re-certified.

Use [migration safety and recovery instructions](supabase-reliability/migration-safety.md),
[Supabase setup](supabase-setup.md),
[architecture/configuration audit](supabase-reliability/README.md),
[operational verification](supabase-operational-verification.md), and
[hardening follow-up](supabase-hardening-audit-2026-09-12.md).
No missing production configuration was silently invented or applied.

## Returning to this baseline

Save unrelated local changes before switching revisions. Fetch and verify the
archive:

```sh
git fetch origin --tags
git rev-parse mydancr-baseline-2026-09-15^{commit}
git rev-parse origin/baseline/stable-2026-09-15
```

Both commands must resolve to
`288ef989c9e1a490f01ab97746ec2ab88ea9b113`.
For inspection, use `git switch --detach mydancr-baseline-2026-09-15`.
For recovery work, create a new branch instead of developing on the archive:

```sh
git switch -c recovery/from-2026-09-15 mydancr-baseline-2026-09-15
npm ci
npm run build
```

Use Node 24.21.0 / npm 11.19.1 and restore the intended environment's secrets
through its secret configuration. Revalidate before promoting recovery work to
`main`, then verify Vercel success and health for that exact deployment commit.
Return to normal development with `git switch main`.

Checking out this tag does not restore database contents, storage media, Auth
users, or external provider configuration, and does not roll back Supabase.
For schema reconstruction, use the isolated replay preparation workflow in the
linked migration-safety document and validate the forward migrations in a
designated disposable environment. Do not replay the historical directory or
reset/repair the production ledger as part of checking out this baseline.
