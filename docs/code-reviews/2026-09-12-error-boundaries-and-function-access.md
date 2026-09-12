# Independent release review: error boundaries, dancer enrollment locks and function access

Reviewed on 2026-09-12 UTC from `D:\Codex\MyDancr-clean-2026-09-11`. This report completes the interrupted review carried over from the original **Code rabbit** task without accessing or changing either retired repository.

## Verdict and exact scope

**Approved within the scope and evidence limits below.** No new actionable defect was confirmed in the four reviewed releases, so no application correction or database migration was needed for this review.

The reviewed range is `060b2976d3e7856efb2cc0c9ce3c64c0732fb919..db9dbf0bd908d68843ce9f389c576a2ed18c02b6`:

| Commit | Reviewed change | Fresh exact-commit deployment status |
| --- | --- | --- |
| `fa3b140543c4c5092be431f43b1c3a37793123d2` | Public venue-signup error classification and administrative deletion warnings | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/EScVLL64y1i66sSgWigVkywGkMj5) |
| `2adc54ba92b64abfb504315f62084b0fbfd852f6` | Serialization of fresh and deferred dancer enrollment | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/FievemMRf2zF7mVqpyUfkHwKry6o) |
| `fcd8e58e53b5565abe3c6a19c190ff0028987b79` | Administrative finance aggregate-error responses | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/7TCJyAT7y1rC23jxaBDHxy6o6XxX) |
| `db9dbf0bd908d68843ce9f389c576a2ed18c02b6` | Read-only database function-security release checker | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/76VDnskiJEviDTd5uYFHb5xmVHAt) |

Except for the separately named moderation follow-on below, later commits, concurrent security/architecture/database work, and the entirety of `main` are not approved by this scoped verdict. The earlier gallery-history and cashier/webhook reviews retain their original narrower scope and historical evidence limits.

## Source and regression findings

- Venue account setup exposes only the helper's own `VenueRequestAccountUserError` messages. Unexpected dependency exceptions reach the shared API boundary; a forged class name is insufficient. Signup validation, duplicate handling, compensation limited to a newly created manager and recovery of an already-saved request remain intact.
- Administrative photo/social deletion returns fixed cleanup warnings with allowlisted diagnostic metadata. The change preserves the completed deletion, existing target predicates, storage retirement and attempted audit. It introduces no automatic retry.
- All five finance dispatcher paths that return aggregate errors pass through `successfulFinanceMutation`. Sanitization preserves the number of errors, counters, provider/disabled flags, null outcomes and `financeRefreshRequired`; it does not mutate worker results or repeat financial work. Stored overview/provider diagnostics remain separately scoped follow-up work.
- Fresh registration and deferred enrollment completion acquire the same transaction-scoped advisory lock keyed by dancer user ID before tag/enrollment row access. The atomic tap wrapper calls registration first; the dashboard derives the dancer ID from the authenticated active account. Neither HTTP caller holds a database row lock across RPCs. Removing only the added entry-lock blocks makes both replacement definitions match the captured predecessors exactly.
- The function checker uses a repeatable-read, read-only transaction, a statement timeout and explicit trusted-schema ordering with `pg_temp` last. It checks effective browser execution grants, reviewed signatures/definitions, privileged owner and service-role membership, API role capabilities, trusted-schema creation and reviewed definer search paths. Its success is a catalog access-control check, not an audit of every function's business semantics.

The fresh focused run passed **268 tests, zero failures/skips/cancellations**: 95 release regressions, 145 surrounding caller/error tests and 28 checker cases. The old lock baseline produced the expected **10 failures and 15 passes**; the deployed correction passes all 25 lock cases. The negative baseline is intentional regression evidence, not an unresolved failure of the release candidate.

The database fixture preserves the eleven target tables and twelve captured triggers; peripheral supporting tables are documented projections. These are native PostgreSQL-engine tests with synthetic records, including held-lock identity/lifetime, entry order, rollback, per-dancer separation, eligibility and the rule that deferred setup completion does not create Working Now. They are not independent hosted-session concurrency tests.

## Fresh production catalog verification

A metadata-only, repeatable-read, read-only transaction at **2026-09-12 04:16:41 UTC** confirmed **131 public functions, 99 security definers and 117 migration entries**. Migration `20260910172000`, `serialize_dancer_nfc_enrollment`, is installed.

All five related production definitions, security modes, search-path settings and effective API permissions match the locally reconstructed fixture plus tracked migrations:

| Function | Definition MD5 |
| --- | --- |
| `register_dancer_nfc_enrollment(uuid,uuid,uuid,jsonb)` | `dd876469ac66d123922e9da3fd4e33b3` |
| `finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb)` | `f382dae05f592ee9b34cdad4e6c4afe7` |
| `register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb)` | `ec438babea11a4e72938baad10474e2e` |
| `approve_dancer_venue_affiliation_from_nfc(uuid,uuid,uuid,jsonb)` | `bf4ce004c0490aa8df9c24fd9f9dcaa4` |
| `activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb)` | `55969db7996b137d4455dc1d9eaec463` |

Every listed function permits `service_role` execution and denies `anon`/`authenticated` execution. The wrapper remains security invoker with an empty search path and a three-second lock timeout; the other four remain definers with `public, pg_temp`. The normalized lock-migration source SHA-256 is `6001c96c8a7caaa5a828e2581f9ab6a79716d67559298ea7d73ce8e8fc8fa031`.

The tracked function-security SQL independently passed against production at **04:17:06 UTC**, reporting four intentional anonymous interfaces and seven authenticated interfaces, with read-only mode on and no application functions invoked. No production migration, grant, account, tap, dashboard finalization, notification, file or financial action was used as a mutable test fixture.

## Health, preservation and evidence limits

Fresh public health, Supabase health and city discovery returned HTTP 200. The delivered homepage version and live-shell script matched the local reviewed assets; anonymous private access returned 401 with `no-store`. These checks verify shared assets and service responses, while the exact-commit Vercel statuses above establish each historical web release's deployment. The health script's commit label alone is not proof of all server code currently serving that commit.

All **30 read-only readiness checks** passed. The migration guard passed **159 files**, retaining all **142 frozen historical files**. Its `replayReady: false` is the existing quarantine for historical version collisions; the check neither replays migrations nor repairs the remote ledger.

This review does not claim fresh historical row/storage preservation fingerprints, hosted parallel-session tests, provider fault injection or a complete authorization audit of all 131 functions. Historical preservation evidence remains in the release ledgers; current catalog verification establishes the installed definitions and access, without reconstructing earlier data state.

Remaining stored provider diagnostics and NATS results remain Security Step 21 work; the bounded moderation writer correction is covered separately below. Sticker capacity, retired venue-claim lock order, trigger review and DMCA lifecycle concerns retain their existing Supabase Step 13/14/15/17/19 assignments. None of those separately recorded follow-ups is silently closed by this report.

Local evidence is stored outside the repository at `D:\Codex\MyDancr-validation-2026-09-11\code-rabbit`: `focused.log`, `old-lock-baseline.log`, `catalog.sql`, `catalog.json`, `source-proof.json`, `function-security.json`, `readiness.json` and `production-health/health.json`. These outputs contain no retrieved private application row contents or secret values. The initial 6,166-test setup result and the original interrupted review's 240 checks are historical evidence; they are not counted as fresh runs here.

## Separate follow-on: moderation retry diagnostics

**Approved for `7c8f5be2520f5b871405058ce5cc7294a5735a5b` only**, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/BcYeSiC7ENJq3spBCfrbYBjvamvZ). This security release arrived during the report's serialized delivery queue and received an additional independent review. The intervening demo scheduling commit `87863f2dda46db18c58c859eb0be9e96adb9722c` is preserved and excluded from this code-review verdict.

The worker previously persisted truncated exception text in `last_error_message`. The correction stores its existing fixed `moderationErrorCode` classification instead and removes the unused raw-message helper. Inspection of that classifier confirms all returns are fixed strings. The two remaining diagnostic writers both use authored classification codes. Attempt counters, retry limits/timing, lock release, version guards, responses and private recovery-source retention are unchanged. This is a bounded correction to future writes, with no SQL or historical record rewrite.

An independent run passed **all 95 moderation lifecycle tests**. An external copy of the new test harness using the exact prior source at `87863f2d` failed **all 32 new privacy cases**. No repository source was changed to run the negative control. The source and test SHA-256 values were recorded and matched the committed release exactly before publication.

A separate read-only SQL check at **2026-09-12 04:27:53 UTC** confirmed RLS is enabled on `image_moderation_records`, authenticated users retain column SELECT, the owner-read policy is `user_id = auth.uid()`, and the administrative policy uses `is_admin()`. Aggregate-only counts found zero nonempty `last_error_code` and `last_error_message` fields. No diagnostic contents, account identifiers or stored images were retrieved. The same catalog/access and zero-count results were independently reconfirmed after deployment at **04:33:24 UTC**, with public health and anonymous private-access checks also passing. This closes the targeted writer finding; it does not establish that all stored provider diagnostics elsewhere are sanitized or approve later Step 21 changes.

Evidence: `moderation-review.log`, `moderation-old-source.log`, `moderation-source-proof.json`, `moderation-catalog.sql` and `moderation-catalog.json` in the same external evidence directory. The 95 tests are separate from the earlier 268-test focused run, for **363 focused checks across the two scoped reviews**.

## Report delivery validation

The report release retains the application source at `7c8f5be2520f5b871405058ce5cc7294a5735a5b` and changes only this Markdown document. With the source frozen, this task independently completed:

- **6,201 automated tests**, zero failures, skips or cancellations (04:32:38–04:36:05 UTC).
- Full uncached ESLint with zero warnings (04:32:56 UTC).
- Production build (04:37:04–04:37:44 UTC), including the migration guard and generated assets; the postbuild receipt is `LAYOUT_REVIEW_POPULATION_SKIPPED`.
- Standalone TypeScript after the build, with incremental output disabled (04:39:15 UTC).
- Restored local production-preview health, Supabase health, city discovery, served-asset matching and anonymous private-route denial.

The earlier supplemental 6,169-test run passed, but another task began editing during it. It is not used as the final frozen-source validation. The 6,201-test run above supersedes it for report delivery. Build-generated version files have no content diff and are excluded from the report commit. No unrelated file is staged.

Final validation receipts are `delivery-tests-result.json`, `delivery-lint-result.json`, `delivery-build-result.json`, `delivery-typescript-result.json` and their corresponding logs, plus `local-health/health.json`, in the external evidence directory. The report-only commit is subject to the repository's push and exact Vercel-success gate; the final task response records that delivery separately so this report does not claim its own future deployment before it occurs.
