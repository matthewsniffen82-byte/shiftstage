# Step 28 — Scraping resilience and public projections

Status: implementation deployed and both committed database migrations independently verified; final manifest delivery remains pending.

## Confirmed boundaries

Public discovery intentionally exposes published stage names, profile IDs, city, public schedules, venue business information and approved media. Request limits cannot make that published information confidential. Database column grants also matter because browser clients can query the public data API directly without using application response mappers.

| Finding | Proposed correction |
| --- | --- |
| Venue ownership identifiers remained directly selectable because twenty related policies used them in ownership joins. | Replace only those qualified ownership comparisons with a stable actor-bound boolean helper, preserving the joins and every other predicate. Remove browser SELECT of owner_user_id. |
| Dancer account identifiers and review attribution were directly selectable on otherwise public profiles. Twenty-three related policies depended on user_id. | Apply the same boolean ownership pattern, then remove SELECT of seven account/workflow fields. |
| Approved public TV rows permitted whole-table SELECT across all 38 columns, including uploader identity, review notes and moderation details. | Replace browser table SELECT with sixteen explicit public column grants. Protect the remaining twenty-two columns without changing service SELECT or TV row policies. |

The two ownership helpers accept only a venue or dancer profile ID. They compare the current authenticated identity inside a fixed, empty search path and return a boolean. They accept no target account ID and have explicit role grants with PUBLIC EXECUTE removed. Anonymous, missing and unknown ownership return false. Administrator identity does not imply ownership. Existing same-row venue/profile policies remain byte-for-byte unchanged. Forty-three related policy clauses retain their exact roles, commands, joins and other predicates.

The resulting venue projection has nineteen public and eleven protected columns. Dancer profiles have thirteen public and nine protected columns. Newly protected dancer fields are user_id, created_at, updated_at, dmca_suspended_at, venue_approved_by_user_id, venue_approved_venue_id and identity_saved_at. Public profile status, display/artwork fields and venue_approved_at remain available. The existing security-invoker public_dancer_profiles view keeps its small published-profile projection and row eligibility.

TV retains id, dancer_id, venue_id, shift_id, caption, duration_seconds, width, height, status, venue_tag_status, venue_featured, published_at, expires_at, distribution_scope, like_count and is_pinned. It protects submitted_by, storage_path, storage_mime, file_size_bytes, consent_confirmed, rights_confirmed, review_notes, reviewed_by, submitted_at, reviewed_at, created_at, updated_at and all ten moderation workflow columns. Service-only playback/upload/review code keeps its existing access.

## Application compatibility

Public discovery, venue, profile and TV response mappers already use the server client and explicit public output fields. Customer saved-profile queries use only retained public fields. Venue ownership/team/private review workflows already authenticate and authorize the existing server client. Engagement notification recipient lookup likewise uses that client after its public-target checks.

Some dancer workflows used the request client to filter dancer_profiles.user_id. The proposed caller changes supply the existing authorized server client only for that own-profile lookup. Analytics, reports, ranking, reviews and deal metrics keep their remaining queries on the request client under row policies. Photo/avatar functions use their already supplied server client for the lookup. Shift editing retains the request-client own-shift read. Billing and crop preview authenticate the active dancer before the same exact-account server lookup. Caller-supplied profile/account identifiers do not select the owner. No new browser identity-lookup endpoint, broader customer read or moderation/financial write is introduced.

## What remains public

Existing public media and signed playback URLs can contain opaque account identifiers in their storage path. The TV upload convention includes the account and dancer IDs; playback/poster paths preserve that convention. This release does not relocate objects, rewrite paths, revoke historical links or promise account-ID anonymity. An opaque UUID is not a credential. Published media may be copied and cached, as explained in Step 27.

The application limits public directory results to 200 per city or 800 for explicit all-city browsing; published profile queries limit schedule/media collections. Existing public rate limits, request validation and short public cache windows remain active. These controls reduce inexpensive repeated work but do not prevent distributed scraping or copying published content. No CAPTCHA, provider WAF setting, paid bot service or crawler exclusion is newly configured. Resource ceilings and any remaining oversized related-query work belong to Step 29 after this release closes.

## Isolated evidence and limits

The current policy fixture captures 43 target policies, 82 existing policies, 42 table projections, 579 column definitions and 101 relevant effective column-access entries. Six account-lifecycle tables retain their full captured constraints/indexes/triggers; the other tables are typed policy-dependency projections with synthetic rows. This is policy and column-access coverage, not full business-schema coverage of all 42 tables.

The corrected native core passed 553 cases: 344 before/after role/view comparisons across eight identities; direct selection, filtering and sorting denial for thirty newly protected columns under anonymous and authenticated roles; composite-row denial; service-column preservation; actor-bound helper behavior/security; unchanged parent policies and unchanged seeded records. Pre-change assertions require actual visible rows for the sampled disclosures. Tests use one isolated PostgreSQL connection, so they do not certify hosted multi-connection scheduling or Supabase Auth token issuance.

The first combined deployment batch reported 589 cases with 560 passing and 29 failures. All native core cases passed; a missing statement terminator in the injected rollback test SQL caused twenty-seven child failures and their two parent failures. The exact-source success/replay cases passed. The separator is corrected in the draft; the expanded rollback suite and caller tests must pass before release. No failed or unrun check counts as delivery evidence.

## Release conditions

Rebase onto the independently completed Supabase lifecycle foundation and architecture timeout release. Fresh read-only catalogs must confirm exact target policies, raw ACLs and all existing function/trigger definitions before applying either migration. Each deployment transaction rejects drift and replay, preserves unrelated catalog objects, existing public-table fingerprints and Auth metadata, and records only its exact committed source. Independent postflight must verify the columns, helper fingerprints/grants, policy bodies, preserved records and exact ledger entries. Freeze the two migration checksums only after that verification.

Complete tests, standalone TypeScript, zero-warning lint, dependency/signature checks, generated-file checks, the production build, configured artifact inspection, exact commit/push/Vercel success, public/readiness checks, matching refs and both preserved screenshots are required. A fully validated and deployed manifest followup closes this step before Step 29 starts.

## Draft validation progress

The corrected ownership deployment parent and its 22 subcases completed in the bounded batch at 2026-09-12T14:33:46Z; that overall batch hit its enforced twelve-second limit during TV validation and is recorded as incomplete. The separate TV deployment suite then passed all 17 cases at 14:36:07Z. At 14:48:59Z, the strengthened 553-case policy core, 25 new caller cases, 13 existing free-billing cases and one external native-postcondition capture passed together (592 checks). The capture is evidence preparation and is not an added repository regression test. Unexpected SQL errors are rejected rather than accepted as matching denials, and positive own-profile, invoice, media, shift and earning visibility is required.

A comparison with the independent 14:38:26Z production catalog subsequently identified a fixture gap: its older effective-access capture represented CRUD but omitted existing service TRUNCATE, REFERENCES, TRIGGER and MAINTAIN permissions. The three deployment-target fixture tables now include those captured privileges and assert their complete raw ACLs. This changes no production permission and requires a fresh native capture and full validation. All source, record and deployment checks still remain before delivery.


## Rebased isolated release validation

The candidate is rebased to architecture commit `a519813ea8211a440e695f62858bbc2896f09846`, independently deployed at 2026-09-12T15:10:16.842Z, and includes the independently closed Supabase lifecycle foundation. The two uncommitted migration filenames were advanced to 20260912150921 and 20260912150922 because that foundation froze a later historical version; their SQL bytes did not change. The first canonical attempt was explicitly interrupted before test completion for this version correction and is not counted as a passing release.

After the correction, all 821 focused checks and a fresh native-postcondition capture passed at 2026-09-12T15:15:20.815Z, including complete captured service ACLs and the expanded schema/default-privilege/enum rollback checks. The full isolated release completed at 2026-09-12T15:23:05.583Z: **8,672 tests**, no failures, skips or cancellations, all eight canonical gates, standalone TypeScript, zero-warning lint, dependency/signature checks, generated-file checks, production build and public artifact inspection. The 624 new regression cases comprise 553 policy/access cases, 26 ownership deployment cases, 20 TV deployment cases and 25 caller cases. Source identities and unrelated screenshots are checked before shared integration and publication. Configured build inspection, exact deployment, fresh production preflight, both guarded committed migrations, independent postflight and the fully validated manifest followup remain required.


## Preflight fixture correction

Implementation `3e2456128cf78408bf8c2db45247ae85852c7297` reached exact Vercel success. Fresh read-only preflight at 2026-09-12T15:31:14.336389+00:00 rejected native fixture differences before preparing or applying any SQL: venue coordinates require numeric(9,6), TV duration requires numeric(7,2), and TV table SELECT must not be represented by invented per-column grants. All 43 target policies, raw relation ACLs and other compared target fields matched. The isolated fixture now asserts all ninety captured deployment-target column types and raw ACLs. Its two SQL source files are unchanged. Full release validation and exact deployment of this fixture correction are required before fresh preflight and either database application.


The corrected fixture passed all 821 focused checks and fresh native capture at 2026-09-12T15:34:13.865Z. Its exact ownership and TV targets then matched the independent read-only production preflight with zero differences. The full configured correction gate completed at 2026-09-12T15:42:01.000Z: 8,672 tests, zero failures/skips/cancellations, all eight canonical gates, configured artifact inspection and postbuild TypeScript. Both migration SQL sources remain byte-identical to the first deployed commit. The correction must reach exact deployment success before renewed preflight and any SQL application.


## Deployment history quoting correction

The corrected fixture commit `0fc3612ac237ef2470cdf8807858393ae0b1feec` deployed successfully. The first bounded ownership application was rejected with SQL syntax error 42601 at 2026-09-12T15:49:37.512Z: captured historical ledger SQL contained twelve occurrences of the fixed outer DO delimiter. Independent read-only verification at 15:52:40Z confirmed zero Step 28 migration entries, unchanged target and unrelated metadata, all 83 table fingerprints unchanged, and unchanged Auth metadata. Neither privacy migration was applied.

Both deployment wrappers now choose a PostgreSQL dollar delimiter absent from every embedded input. Native regressions seed prior ledger SQL containing the original delimiter, two candidate delimiters, quotes and backslashes, then require exact-source success, rollback/replay protection and preserved historical bytes. The old wrappers failed 43 of 48 cases with this realistic ledger fixture. Both committed migration SQL files remain unchanged. The corrected wrappers require fresh full release validation and exact deployment before a renewed preflight and an explicitly verified retry.


The delimiter correction passed all 823 focused checks and a fresh native capture at 2026-09-12T15:54:45.340Z, including all 48 ownership/TV deployment cases. Separate isolated parsing of both generated wrappers with the complete 127-entry production history reached the intended catalog-drift guard, confirming that historical SQL remains data. The configured full release gate completed at 2026-09-12T16:03:08.295Z: 8,674 tests, no failures/skips/cancellations, all eight canonical gates, configured artifact inspection and postbuild TypeScript. The two added historical-ledger cases bring this step to 626 new regressions. The two migration source files remain unchanged. Exact correction deployment, renewed preflight, individually verified application and manifest closure remain required.


## Applied boundaries and pending manifest closure

Implementation `8875091e974d48e87c33b11fb543ba1d7bf27d2d` reached [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/6WFjVJGkbK3sBheJk9kZMw4NDebA) before either committed migration was applied. Independent read-only postflight at 2026-09-12T16:13:01.636648+00:00 verified the exact two ownership helpers, all 43 policy bodies, nineteen public venue fields, thirteen public dancer fields and sixteen public TV fields. Both deployment phases preserve unrelated metadata and ledger entries, all 83 existing public-table fingerprints and Auth metadata. All 58 readiness checks pass. The two exact applied sources are now frozen in the 171-file migration manifest. Existing public media URL identifiers and cache/copy limitations remain explicit. The full manifest-followup checks, commit/push and exact successful deployment still precede Step 29.


## Step 28 implementation release and followup validation

Implementation `8875091e974d48e87c33b11fb543ba1d7bf27d2d` reached [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/6WFjVJGkbK3sBheJk9kZMw4NDebA). All eight health/anonymous-denial checks, fifty-eight database readiness checks and four public projection checks passed; the homepage rendered without browser warnings or errors. Both committed SQL sources passed independent catalog, row-fingerprint and Auth-metadata preservation checks. The checksum followup passed all **8,674 tests**, zero failures/skips/cancellations and all eight canonical gates at 2026-09-12T16:21:29.198Z, plus configured artifact inspection and postbuild TypeScript. Only the two evidence documents and two verified migration-manifest entries change. Exact followup commit/deployment closure remains required before Step 29. No live account, upload, moderation, financial or provider action was used as a test.


## Step 28 final delivery

Step 28 closed at 2026-09-12T16:28:32.314Z as `32d77f5cf2c48ede662ba5e943433b77a8361349`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/BHFjZkQ9fvBvTu77z34HxcRjz33X), matching clean local/tracking/remote main and both unrelated user screenshots preserved. All 8,674 tests, all eight canonical gates, configured artifact inspection and postbuild TypeScript passed. Eight health/anonymous-denial checks, fifty-eight readiness checks, four public projection checks and the rendered homepage passed. Both SQL sources were independently verified and their hashes frozen in the 171-file manifest. The documented fixture and wrapper-delimiter corrections remain in the external receipt; the successful ownership SQL application was attempt two after independent proof that the rejected first attempt changed nothing. No migration is replayed by this record.
