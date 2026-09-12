# Independent review: sessions, diagnostics, media runtime, data integrity and TV recovery

Reviewed on 2026-09-12 UTC in `D:\Codex\MyDancr-clean-2026-09-11`, continuing the [provisioning, access and video-capacity review](2026-09-12-provisioning-access-and-video-capacity.md).

## Verdict and scope

**Approved within the exact scope and evidence limits below.** No new actionable defect was confirmed in the seven initially scoped releases. A separate TV recovery defect was reproduced during this review; its follow-up fix is reviewed and approved below. This report records an independent source review, fresh regression checks and read-only production verification; it does not introduce a runtime correction or migration.

| Commit | Reviewed change | Independently verified deployment |
| --- | --- | --- |
| `5d5fdb936c3d42b2f8e487e228cd9e2db0658ec2` | Minimize security logs and reject unsafe diagnostic metadata | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/G3yt7ici7r13co6xCtsj8vkmrN8e) |
| `8725ca85a8d696f50baacc314eff6194dab36fd9` | Bind refreshed credentials to one browser-session snapshot | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5rkPQiZyeDQ1LBSkkF3LeaWVZAFH) |
| `bc4812b7b41550f59c2f803219a7db0f94fcd51a` | Stabilize TV playback while scrolling | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5EfZuEMZ6o1KSiPHaZH3z9nRzxxX) |
| `c5d3ddc91178c81df1c884050d401682b81603eb` | Enforce active NFC capacity across write paths | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/AoyhjPbTF8sU5hFLrKeLqYccrJjR) |
| `77ea0eb48d3de3a1b65c87fdca8e5754fb6d1579` | Pin verified FFmpeg binaries and require a patched Node runtime | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/9G1hPeQD5qRiySQxey5ttcksnRLD) |
| `b0f3ac2950b934793c07c9b63a32ecbf849727e1` | Reject malformed refresh claims and sales-agent input | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5JHGBMZtCdFFkMstAtWrehtYvvJ5) |
| `fce8a233375642ad900c932ccde33bf25a79b864` | Serialize sales-agent hierarchy writes and snapshot referral ancestry | [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/4ondUm8kLiD6NQ9FBgwGrFMuJvZN) |

Earlier review verdicts retain their original scope. The video/NFC checksum closure `ad0208a5` was reviewed previously and is reconfirmed here. Later CI, browser-review and other queued changes are preserved and included where necessary in final branch validation, but are not independently approved by this seven-release verdict.

## Source findings

**Sessions and input.** Refresh persistence now derives account metadata and checked credentials from the same serialized storage snapshot, then compares that snapshot again before saving. A rejected refresh preserves a newer sign-in, logout or push identity. Successful refresh retains the captured account fields and existing cleanup behavior. The compare is not a lock across browser tabs and does not prove a fully atomic cross-tab credential store. Browser storage remains an untrusted source for authorization.

The refresh scheduler now rejects decoded null, array and primitive JWT payloads without throwing or calling the provider. Middleware forwards malformed credentials to normal authentication; decoding does not authorize a user. The administrative agent route authenticates an active administrator before consuming input, rejects invalid status/depth/non-text optional fields, and returns typed 400 errors for invalid audit notes and reconciliation outcomes. Numeric and canonical string depths 3/5 remain accepted. The verified actor, valid payloads, audit notes, single mutation and handling of uncertain delivery remain intact.

**Diagnostics.** Metadata extraction tolerates throwing getters, revoked proxies and malformed statuses without coercing arbitrary objects. Tokens exclude slashes, colons, whitespace and oversized values; nested transport codes remain useful. A token-shaped value is not semantically certified non-sensitive, so this is a bounded diagnostic format rather than a universal redaction guarantee. The reviewed call sites remove raw search/profile identifiers and moderation payload/category details, retain counts and allowlisted request metadata, and preserve retry classification, attempts, delays and successful results. Signed image URLs and storage paths are not added to those logs. No historical diagnostic cleanup or provider request is introduced.

**TV playback.** Non-selected players are paused before the incoming clip starts, including backward transitions where DOM order previously started the incoming player first. Existing source-bearing neighbors can be retained while the selected video buffers. The shared TypeScript and live-shell policies agree; data-saver release behavior, bounded neighboring sources, playback position, manual pause and rejection of stale play completions remain intact. The fresh source-harness checks cover transition ordering and rapid reversals. The original release's mobile browser journey remains historical evidence, not a new independent device/performance measurement in this review.

**Runtime and native decoder.** The installer verifies approved HTTPS redirect destinations, exact archive size/digest, named extraction members and the extracted binary's separate size/digest before replacing the executable. A failed download cannot replace the previous binary or pass subsequent binary verification. The path wrapper stays pinned at 5.3.0 with its downloader denied; installation/validation reject binary overrides and unsupported platforms. All **428 non-root lockfile package entries remain unchanged** compared with the parsed predecessor lockfile. The reviewed change is root installation/runtime metadata and native executable selection, rather than a blanket npm dependency upgrade.

The Node 24.18.1 floor includes the published [July security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases), following the [June fixes](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases). The selected FFmpeg 8.1.2 branch includes fixes listed by [FFmpeg](https://ffmpeg.org/security.html). FFmpeg links [BtbN's builds](https://ffmpeg.org/download.html), and the pinned [August 31 release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27) supplies the named Windows/Linux x64 variants. These observations support the chosen patch boundary; they are not a claim that a binary pin eliminates supply-chain risk or future advisories.

At **07:50:06 UTC**, GitHub's publisher release metadata independently matched both committed archive sizes and SHA-256 pins. This verifies the selected published artifacts without independently rebuilding them. Fresh local verification used portable **Node 24.21.0**, leaving the global runtime unchanged. The installed Windows executable matches **144,442,368 bytes** and SHA-256 `19121c4a9dece4780f33e6cfc2ba58e36347d4c64f0df4efc05a6959a8191aa6`; its synthetic H.264 smoke check passes. Linux execution and archive-install integration retain the original release's evidence boundary. No new independent Linux runtime instance, clean package installation or exploit attempt was exercised here.

**NFC capacity.** The new invoker trigger counts active tags after insert or a relevant venue/status change, takes a per-venue transaction advisory lock, and rejects a count above 25. Same-slot updates and inactive rows do not consume another active slot. Repeatable-read additions are explicitly rejected; read-committed counting occurs in a separate statement after acquiring the lock. Provisioning, enable, rotation, direct writes and multirow transitions use the same enforcement. Existing secrets, ownership, disabled/revoked history and transaction rollback behavior remain intact.

**Agent hierarchy and attribution.** A before-statement trigger takes one bounded transaction lock for insertion or changes to sponsor, status or depth, before row validation and upsert row locking. It retains existing cycle, domain, founder, role and deletion controls. Both attribution writers capture up to five ancestors in one recursive statement, anchored by the locked signing agent. The single snapshot avoids combining ancestors from successive statement snapshots without adding an extra reader graph lock to the venue-approval trigger sequence. Signer checks, effective-time ordering, historical attribution, audit insertion, rates and allocations remain unchanged.

The native database fixtures cover the real target schemas and captured trigger/function definitions, with explicitly projected supporting account/venue/request tables. The hierarchy fixture omits unrelated venue-approval triggers. Lock identity/lifetime, rejection/rollback, roles, cycles, capacity and ancestry cases support the implementation review; they do not establish independent hosted multi-session concurrency or a complete approval lifecycle. Empty production agent tables are not evidence that future concurrent agent activity is safe.

## Independent regression evidence

**470 unique focused tests passed**, with zero failures, skips or cancellations: 418 targeted session/logging/TV/runtime/database checks and 52 separate real-media cases covering formats, watermarks, posters and storage receipts with the verified executable.

Exact committed predecessor sources were also run through the new release harnesses in external directories:

| Regression group | Previous source: expected failures / passes | Corrected source |
| --- | --- | --- |
| Browser refresh | 6 / 7 | 13 pass |
| Malformed refresh scheduling | 2 / 7 | 9 pass |
| Sales-agent input | 38 / 21 | 59 pass |
| TV playback ordering | 2 / 1 | 3 pass |
| Diagnostic boundaries | 55 / 42 | 97 pass |

These **103 expected predecessor failures** reproduce the release regressions. The 181 passing corrected cases are corroborating reruns of cases already counted above, not additional unique coverage. The external harness initially needed a larger Git-output buffer for the historical TV shell; that reader setup issue was corrected without changing application source. No synthetic request reached a production provider or business RPC.

## Fresh production and source protection

The repeatable-read, read-only catalog at **07:36:53 UTC** and function-security gate at **07:36:57 UTC** confirm **133 public functions, 99 security definers, 62 public/Auth trigger attachments and 120 migration entries**. Four intentional anonymous and seven authenticated function interfaces remain. The gate invokes no application functions.

| Reviewed function | Live definition MD5 | Access and execution mode |
| --- | --- | --- |
| `enforce_active_venue_nfc_capacity()` | `93ad88652a30d0a5d3bfdf50b0b1bd6a` | Invoker; no direct anon/authenticated/service execution |
| `lock_sales_agent_hierarchy_writes()` | `617c9b6db6feca12d31346092ecbb5fe` | Invoker; same direct execution denial; three-second lock timeout |
| `assign_admin_venue_sales_agent(...)` | `5b90232f8c2996747f2adae61b628a8c` | Definer; service execution only among the API roles |
| `attribute_approved_venue_agent_referral()` | `a7ea3b1ba3310b7815e69fec5c370610` | Definer; no direct API-role execution |

A separate read-only capture at **07:49:02 UTC** compared both native fixtures with production. All twelve comparisons passed for relation ownership/RLS/CRUD grants, columns, constraints, indexes, policies and existing trigger attachments. This covers their four distinct target tables; the two newly installed attachments are checked separately below.

All four functions retain owner `postgres` and their reviewed search paths. The new NFC attachment is enabled `AFTER INSERT OR UPDATE OF venue_id, status`, for each row. The graph attachment is enabled `BEFORE INSERT OR UPDATE OF sponsor_agent_id, status, commission_depth_limit`, for each statement. Compared with the prior review's 05:54:54 UTC catalog, **129 existing public function metadata entries remain unchanged**, the two reviewed attribution definitions change, and the two new invoker functions account for the count increase.

At **07:41:18 UTC**, aggregate-only inspection found **20 tags, all active; maximum three per venue; zero over-capacity venues; zero sales agents and zero attributions**. No tag secret, account identifier, agreement text or private row content was retrieved. The default isolation remains read committed.

All **162 migration files are frozen**, preserving the preceding 161 entries and original manifest metadata. Independently altered external copies of the video, NFC and hierarchy migrations are each rejected specifically as changed historical SQL. Their committed source SHA-256 and ledger MD5 match production. In particular, the hierarchy source is SHA-256 `59657015126a4436b952acd841991ad3e41f5a47780df4f58e0a6ee00aa21d02` and MD5 `205805513808cddb8e908f7af9470f48`. Its source is protected in its first commit; the fresh ledger check separately establishes actual application. The previous applied-source protection gap does not recur in this release. Historical version collisions remain quarantined; no replay or ledger repair occurred.

Independent public probes at **08:20:20 UTC** passed for the root and source-version headers, exact application-script and stylesheet digests, application/Supabase health, city discovery and anonymous monitoring denial with `no-store`. These seven probes check current serving assets and public behavior; exact-commit deployment is established separately by the Vercel status records.

Historical preservation receipts remain evidence of their original releases. This review does not reconstruct their earlier 24-table fingerprints, certify all business constraints or rewrite the retained inactive constraint exception. Hosted concurrency, complete role matrices, real provider activation, timestamp/lifecycle work and remaining delivery fencing retain their separately documented scopes.

## TV incident reconciliation

During the release queue, the user reported TV showing Unavailable and Retry failing until a hard refresh. This review treats recovery separately from the previously reviewed playback-ordering change. The original failing request was not captured, so the user-specific trigger remains unproven; the tests establish the reproduced code paths. Exact-source inspection confirms that the service worker already discarded explicit request cache modes before the seven-release scope; its last prior change was `73454557727f1e322abf5eb9f757ab4ddbbb1ec4`.

The recovery design addresses a challenged API request, stale HTTP data and a retained DOM key after the feed has been replaced by a loading/error message. Vercel documents that challenged API routes require a browser challenge session, so repeating a fetch does not establish that session. The candidate offers a user-triggered document reload for the specific challenge response, preserving the current origin, city, venue/video selection and fragment. Ordinary retries request fresh data; private document navigation still uses `no-store`. [Vercel challenge behavior](https://vercel.com/docs/vercel-firewall/firewall-concepts#challenge)

At **08:47:42 UTC**, an independent rerun of the incident task's ten tests reproduced **seven failures and three passes** against exact `def7ef5f` source; a frozen candidate passed all ten. A separately authored service-worker harness reproduced five failures against the prior worker and passes all ten cases against the candidate, including public cache-mode preservation, private navigation and non-GET pass-through. These overlapping harnesses are reported separately, not added to the original 470 unique focused cases.

At **08:50:36 UTC**, all eleven normalized candidate file hashes matched the incident task manifest, and the generated shell/script versions matched their source/artifact bytes. This evidence uses simulated responses and browser objects. It does not prove that every real device completes Vercel verification, and it does not change firewall settings or establish a bypass. The frozen candidate hashes and logs are recorded in `tv-recovery-controls.json`, `tv-recovery-before.log`, `tv-recovery-candidate.log`, `sw-cache-before.log` and `sw-cache-candidate.log`.

The incident task's recorded 393 x 852 browser fixtures reach synthetic-clip playback after both challenge/reload and transient-failure/Retry. Their results and recovery screenshots were inspected for this review and retained in `tv-browser-evidence`. The fixture serves the raw shell with intercepted requests, does not contact production, and blocks service workers; worker behavior is established separately by the harness above. This is recorded fixture evidence, not a fresh independent run on the user's phone or against a live Vercel challenge.

**Approved follow-up:** `4cffa0ca81b34e43de867b6c70c8f01e9a2350cb`, [successfully deployed](https://vercel.com/ai-movie-jobs/shiftstage/DKinN4xjQv4D8dt4Mzc6fLhxCkar). At **09:03:28 UTC**, independent comparison confirmed that all eleven committed files exactly match the reviewed normalized hashes and that no additional file entered the commit. The exact-commit Vercel status was independently confirmed at **09:07:39 UTC**.

The incident task's delivery receipt records four bounded public GETs at **09:08:59 UTC**: root, script and service worker return 200 with the reviewed hashes; the public TV feed returns 200, `ok` and 22 videos. No challenge was observed. Its separate release receipt records 6,861 passing tests and the configured production build. These are the incident task's delivery observations; this report's own final branch validation is recorded separately below.

## Report delivery

The report release retains application source at `4cffa0ca81b34e43de867b6c70c8f01e9a2350cb` and changes only this Markdown document. With that source frozen, this task ran the complete canonical `verify:release` gate in the shared checkout from **09:11:35 to 09:16:47 UTC**, using portable Node **24.21.0** and pinned npm **11.19.1**:

- **6,861 automated tests passed**, with zero failures, skips or cancellations.
- Dependency audit, registry signatures, native runtime verification and generated-asset checks passed.
- Route type generation, standalone TypeScript and full lint passed; lint reported zero warnings.
- The production build and migration guard passed. Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`.
- All **30 read-only readiness checks** passed at **09:12:14 UTC**.

The earlier isolated 6,843-test gate on `def7ef5f` passed at 08:42:14 UTC, but subsequent checker and TV corrections changed the base. It is retained as historical evidence in `pre-incident-gate.log` and `pre-incident-gate-result.json`; the complete run above supersedes it for this report's delivery.

Only the finished report is staged. The unrelated user screenshot remains preserved and untracked. No production business mutation, firewall setting change, support message or local preview restart was performed by this review. Final pre-commit evidence is in `delivery-gate.log`, `delivery-gate-result.json`, `readiness.json` and `readiness-result.json`. Push, exact-commit Vercel success and subsequent bounded live checks are recorded in the external delivery receipt after they occur.

Evidence is retained outside Git at `D:\Codex\MyDancr-validation-2026-09-11\code-rabbit-security-and-integrity`: `focused.log`, `native-media.log`, `negative-controls.json` and its logs, `catalog.json`, `function-security.json`, `ledger.json`, `database-proof.json`, `fixture-schema-proof.json`, `runtime-proof.json`, `publisher-archive-proof.json`, `source-scope-proof.json`, `reviewed-deployments.json` and `pre-delivery-health.json`. The TV follow-up adds `tv-recovery-controls.json`, `tv-candidate-manifest-proof.json`, `tv-committed-source-proof.json`, `tv-deployment.json`, `tv-live-receipt.json`, `tv-release-receipt.json` and `tv-browser-evidence/`. Synthetic predecessor sources and migration edits exist only in external copies. This report records pre-commit validation; its exact commit/deployment and subsequent health proof are retained in the external delivery receipt and final task response.
