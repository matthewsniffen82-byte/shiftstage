# MyDancr performance report — September 12, 2026

## 1. Executive summary

**FIXED:** Four measured bottlenecks were corrected and deployed: redundant venue authorization reads, pickup responses waiting for notification providers, feed recovery reacting to unrelated DOM changes, and repeated transformation of immutable homepage files. The UI, media encoding quality and authorization checks were preserved.

**VERIFIED FASTER:** Controlled before/after measurements show 83.3% fewer venue access queries, 96.8% fewer blocked-autoplay scan/play attempts under unrelated updates, and 86.3% less warm homepage origin work. Pickup acknowledgement now follows durable lead/inbox creation without waiting for external alert delivery. These are workload-specific results, not a claim that every page is 83–96% faster.

The initial comprehensive audit is recorded in [the audit and master findings](2026-09-12-audit.md). Targeted checks followed each fix. One final full verification covered the deployed application; only the affected video area received additional checks after concurrent video changes. All four performance fixes are committed, pushed and successfully deployed.

## 2. Initial bottlenecks

| Severity | Affected flow | Evidence and user impact |
| --- | --- | --- |
| HIGH | Venue dashboard | Six services independently loaded the same access context. Owners incurred 12 access queries; managers 24. Repeated dashboard refreshes multiplied database round trips. |
| MEDIUM | Pickup requests | The durable lead and venue inbox were saved, but the response still waited for external providers with 10-second per-call deadlines. Provider delays could delay confirmation. |
| MEDIUM | TV feed | A document-wide observer scanned/retried feed playback after unrelated DOM updates. A blocked-autoplay fixture produced 31 attempts for initial setup plus 30 unrelated updates. |
| MEDIUM, confirmed by benchmark | Homepage origin rendering | Each origin request reread and transformed invariant deployment files. Warm route work, including response body consumption, had a 54.06 ms median. |
| INFORMATIONAL | Media bandwidth and future scale | Three existing 15.09-second videos were 8.42–15.44 MB, approximately 4.46–8.19 Mbps. Large CSS/role bundles and bounded directory/analytics limits remain future scaling considerations. |

No critical performance finding was identified. Existing bounded feeds, responsive images, batched data fetching, scoped queries and cleanup were retained where the audit found no meaningful problem.

## 3. Fixed

| Change | Correctness boundary | Validation and delivery |
| --- | --- | --- |
| Share venue access reads inside the read-only dashboard GET | An explicit async request scope shares a promise only for the exact client and user. Each service still checks its required permission. Mutations and later requests get fresh authorization. | 55 focused tests and focused lint passed. Includes isolation, denied finance access, revocation and errors. Commit `36b8d584`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/3vWkLGx5cVXhLjovG6AbFBtGahxE). |
| Deliver pickup alerts after durable acknowledgement | Both routes use Next's response-lifetime `after` callback only after the transactional handoff succeeds. Replays do not reschedule alerts. Pending provider acceptance stays null. Existing synchronous helper callers retain their behavior. | 87 pickup, notification, privacy and authorization checks passed after integration. Commit `7c082852`, integrated/deployed in `de3d39bf`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/96SS9bPtjdnXFTmdxxfNsmphRNUX). |
| Restrict autoplay mutation recovery to inserted feed media | New feed elements/subtrees still trigger recovery. Media readiness, page return and manual pause semantics remain supported. | 34 focused recovery/resource/version tests and lint passed; live Chromium and WebKit checks passed. Commit `69222f1b`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/4iMgkMJqimkkbt33XK39ooF5ycqG). |
| Reuse the rendered production homepage artifact | Only immutable deployment files are retained per function instance. Every GET gets a fresh response body. Failed rendering clears the promise; development remains uncached. Public data freshness and HTTP/CSP headers are unchanged. | 18 route/CSP/cache/version tests and lint passed. Commit `6097ca8c`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/2h9UM8D1w99gfM2mZweFVCFchiVc). |

## 4. Video / media

**FIXED:** Recovery no longer scans the entire feed or calls play because unrelated page content changed. No encoding, image quality, branding or playback feature was removed.

The focused post-fix media pass verified one active player, two attached sources at initial playback, and at most three attached sources during rapid scrolling (active/previous/next). Hidden-page playback stopped; returning resumed it. Leaving TV released all feed players/sources. Profile playback, touch close, manual pause and detached-player release passed. At that point the existing policy gave the active video priority and warmed next-video metadata after active readiness.

The separately authorized Supabase task changed current delivery to checked application photo/video/poster URLs. Each request rechecks authorization and streams private, no-store bytes; dynamic dancer/profile/feed metadata is also no-store. This deliberately adds origin/database work and prevents browser/CDN reuse when revisiting protected content. It must not be reversed as a speed optimization. Venue artwork and city metadata retain their existing cache behavior. A concurrent presentation fix retains posters until a video frame is presented, without starting extra media downloads.

The subsequent user-requested fix for black neighboring cards, `d0545de0`, prepares playable data for immediate neighbors in both directions after active readiness, keeps inactive previews visible and releases distant sources. Data-saver/very-slow-connection behavior still restricts warmup. This is a responsiveness/bandwidth tradeoff: it retains at most three video sources, but it is more eager than the original metadata-only neighbor policy. It must not be reported as a reduction in video download bytes.

The final production video journey passed first play, eight rapid forward/backward transitions, visibility changes and leaving TV. Every sampled visible card had a loaded preview or presented frame; at most one video played and three had sources. Hidden state retained one paused source; leaving TV released all. This closes the earlier mismatch where a concurrently updated test was run against the older deployment. The matching implementation and test passed after deployment; the full audit was not repeated.

All three final 1 MiB video probes returned 206, valid ranges, MP4 fast-start order and private/no-store headers. Twelve responsive-image probes returned the requested 96/160/320-pixel widths with preserved aspect ratios; three browser hero checks loaded only the correct responsive asset. Viewed screenshots retained the intended layout and image quality.

Six repeated city/feed journeys at `4454150a` had zero detached sourced/playing videos. JavaScript heap was 2.66 MB initially and 4.14 MB after the final feed return, similar to the initial audit's 2.70 → 4.15 MB. Final DOM/listener counts remained close to the first feed state. The later neighbor-loading release passed its source/playback cleanup journey. This shows bounded resources in the exercised journeys, not a measured reduction in decoder/native memory or proof about arbitrarily long sessions.

## 5. Supabase / database

**FIXED / VERIFIED FASTER:** Owner access reads decreased from 12 to 2 per dashboard aggregation; manager reads from 24 to 4. This is request-local sharing, with no cross-user or cross-request authorization cache.

No indexes or database migrations were added by these performance fixes. Source/migration review found indexes supporting the observed city/status, dancer/venue schedule, media publication and engagement query patterns. Public discovery uses explicit projections and parallel/batched requests; parent and embedded collections are bounded. Pilot analytics paginates and limits its time window; counts and finance aggregates stay server-side. No active Realtime subscription was found.

The focused database pass completed 77 tests covering query windows, fetching, cache boundaries, cancellation, byte budgets and access scope. Initial media-signing fixtures confirmed one batch for 50 dancer videos and one batch for 100 admin videos. The final privacy implementation constructs checked application preview URLs without provider signing batches: 50 dancer videos still use three database queries, 100 admin videos one, and both use zero Storage signing requests. Media-byte requests subsequently perform fresh authorization checks. Workspace signing savings do not imply lower total database load across the new media-delivery architecture.

Production query plans, database-wide statement statistics and real authenticated dashboard timings were not measured. No speculative index was added to compensate for that limitation.

## 6. Frontend

**FIXED:** Immutable homepage transformation now happens once per warm production instance. Unrelated DOM updates no longer cause feed recovery work. No new dependency, blanket memoization, global state system or server/client rewrite was introduced.

Initial architecture: Next.js 15.5.24 / React 19.2.7, App Router, Node runtime; the homepage serves an HTML shell with deferred extracted/minified JavaScript. Profile pages use server rendering with interactive media. Heavy dashboard upload/edit tools already load dynamically. Auth refresh remains serialized, private APIs remain no-store, and analytics does not gate core actions.

Final source/build inventory at `dfba2f62`: 155 route entries (two new protected media routes), still 52 client component entries. Dashboard route plus listed shared JavaScript changed from 910,313 to 910,889 raw bytes and 223,458 to 223,692 gzip bytes. The source shell grew from 2,555,089 to 2,567,134 bytes across all concurrent changes; source CSS from 1,234,683 to 1,241,070 bytes. The same four font families and swap behavior remain. There is no meaningful bundle reduction to claim, and no dependency was added by this performance task. Large shell/CSS separation remains an optional follow-up rather than a speculative rewrite.

## 7. Mobile

**FIXED:** Fewer unnecessary scans/play retries reduce client work when autoplay is blocked. Existing single-player behavior, offscreen cleanup and touch controls are retained.

The final six-case matrix passed all eight phases per case: Android Wi-Fi/cellular/slow, iPhone-sized Chromium cellular, and iPhone WebKit portrait/landscape. These cover profile playback, touch close, directory filters, venue navigation, back, login/signup form opening, rapid feed scrolling and exit cleanup. There were no uncaught application errors. After the later neighbor-loading change, targeted slow-Android and WebKit iPhone journeys passed again, with no application errors or resource-bound failures.

Chromium device emulation and desktop WebKit exercise mobile layout/browser behavior; they do not establish physical Android/iPhone thermal, memory or decoder performance. No field INP or real-device claim is made.

## 8. Measurements

| Controlled measurement | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Owner dashboard access queries | 12 | 2 | 83.3% fewer access queries; identical permission decisions. |
| Manager dashboard access queries | 24 | 4 | 83.3% fewer access queries; scoped to one read request. |
| Blocked-autoplay scans/play attempts with 30 unrelated DOM updates | 31 | 1 | 96.8% less work in the reproduced scenario. |
| Warm homepage render + response body, median | 54.06 ms | 7.43 ms | 86.3% less origin work in the local actual-route benchmark. |
| Deployment file reads across 21 homepage calls | 42 | 2 | Same 1,189,035-character response body. |
| Cold homepage render | 68.63 ms | 74.85 ms | No cold-start improvement claimed. |
| Pickup response while provider is pending | Held open | Acknowledged after durable handoff | Controlled scheduler fixture, no real notification or invented production latency. |

The one final 18-run route pass, at the deployed `4454150a` revision, produced these medians:

| Flow | Initial → final LCP | Initial → final JS transfer | Initial → final recorded total transfer |
| --- | ---: | ---: | ---: |
| Homepage | 1,888 → 1,472 ms | 204,958 → 205,805 B | 864,658 → 938,730 B |
| Working Now | 2,216 → 1,384 ms | 204,790 → 205,654 B | 746,557 → 787,292 B |
| Clubs | 1,576 → 1,428 ms | 204,712 → 205,180 B | 652,993 → 655,055 B |
| Dancer profile | 3,104 → 2,172 ms | 162,139 → 162,652 B | 317,656 → 348,957 B |
| TV | 4,208 → 4,016 ms | 205,314 → 206,180 B | 2,750,253 → 13,328,781 B* |
| Login entry | 1,644 → 1,336 ms | 204,706 → 205,275 B | 728,507 → 763,784 B |

Final sampled CLS was 0–0.007; all 18 runs had no uncaught JavaScript error or critical document/script/API failure. Paint results are observations, not attributed speedups: baseline host CPU utilization was roughly 57–87%, versus 23–31% in the final samples. Concurrent code, content order and delivery changed too.

*TV's encoded-byte counter includes browser networking read-ahead and cannot be treated as a clean 4 Mbps delivered-throughput measure. The apparent increase was investigated with four bounded range controls and two isolated metadata controls. Range downloads delivered exactly 1,048,576 bytes in about 2.81–2.92 seconds. A metadata video recorded about 6.30 MB encoded while delivering 1.15 MB through the throttled data stream, with the same result with and without API interception. The discrepancy was preserved in the evidence rather than called a bandwidth improvement or silently discarded. No video bandwidth reduction is claimed.

TV loadstart-to-playing median increased from 576.8 to 1,596.3 ms at this checkpoint. New protected media adds authorization and an origin hop. Final protected range headers took 664–1,046 ms in the unthrottled probes. Source bitrate and the additional delivery work remain constraints. Three later TV-only samples after the neighbor-loading change measured 1,556.3 ms startup and 4,052 ms LCP, with no application/critical request errors. That small difference does not establish a material startup improvement. The final five-second scroll samples had a median 1.07% of frames exceeding 50 ms; this is a short lab sample, not a physical-device smoothness guarantee.

Route lab conditions: three cold Chromium runs per route, 393 × 852, DPR 2, 4× CPU, 4 Mbps down / 1 Mbps up, 100 ms latency. API writes were suppressed. Initial transfers were sampled six seconds after load, followed by a five-second scroll. Redirected route metrics refer to the final document. These are lab samples, not field Core Web Vitals. Concurrent public-profile, desktop navigation, security and media delivery changes prevent attributing all paint/transfer differences to this performance work.

## 9. Final full performance review

The complete release gate at `8972775e`, containing all four performance fixes, passed **9,431 tests with zero failures or skips**, route type generation, standalone TypeScript, full lint and production build. Runtime/native/generated-asset checks also passed. After the coordinated media implementation, **1,779 selected compatibility tests**, route type generation, TypeScript, lint, production build and the public-build scanner passed. Subsequent publication/reactivation changes received their targeted role/lifecycle checks. These groups overlap and their counts are not added into one total.

The final full browser review began at `4454150a`; its exact Vercel deployment succeeded, and live homepage/script hashes matched the local source. Eighteen route samples, six mobile configurations, six memory cycles, three synthetic dashboard roles, profile playback, directory filters/navigation, twelve public API reads, three video ranges, twelve image transformations, three hero sizes, fifteen public document routes and four private-API denial checks passed. Dashboard checks validate rendering/chunk loading with synthetic responses, not real private database latency. Favorites/follows, schedules, analytics and pickup correctness also remain covered by the reused automated checks; no production mutation or real provider message was sent.

The final source review retained server/client and auth boundaries, bounded feeds and analytics queries, scoped media resources, subscription/timer cleanup, async analytics, conditional third-party scripts, existing typography/CSS and static-asset cache policies. No new bottleneck introduced by the four performance fixes was confirmed. The separate privacy implementation has documented latency/cache costs, and the user-requested video presentation work is included with targeted post-deployment checks.

A fresh production build at `dfba2f62`, including the later video and notification changes, passed compilation, lint/type validation and public-build security scanning (274 files). The two updated read-only performance probes passed focused lint. The current-source bundle inventory and targeted media follow-up are complete. The expensive general suite was reused across the coordinated tasks, not restarted after each fix.

The final video release `d0545de0` also passed 72 focused tests and its exact [Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/2nj5VRqeBc142DwFrQueQDt9wWLN). Its ten-case deterministic Chromium presentation fixture passed; Windows WebKit could not decode that synthetic fixture, while the real-media WebKit journeys above passed. These distinct results are not conflated with physical iPhone verification.

Raw measurements, screenshots and local receipts are retained in the ignored `.next-perf-audit-20260912` directory. The shared full-release receipt is `D:/Codex/MyDancr-architecture-audit-2026-09-12/final-release.json`; coordinated media validation is documented in [the Supabase report](../supabase-hardening-audit-2026-09-12.md). Production records, credentials and provider signed URLs are not committed with this report.

## 10. Manual action required

The four performance changes require no Supabase migration, Vercel setting, media re-encoding or third-party configuration. The coordinated media task already applied its private-bucket/publication migrations and accepted CDN purges; no additional performance setting is required.

**MANUAL ACTION REQUIRED — separate media privacy follow-up:** Supabase support must revoke historical direct Storage signed links. The current checked application delivery is active, but older unexpired provider links remain a documented limitation. The [prepared support request](../supabase-storage-link-revocation-request.md) has not been sent. This performance task did not rotate keys, send the request, or claim that historical links were revoked.

## 11. Remaining bottlenecks

- Existing high-bitrate videos can saturate a 4 Mbps mobile link even when only one video plays. Source samples ranged from 4.46 to 8.19 Mbps. The recovery fix does not reduce these bitrates.
- The large shared shell/CSS and role dashboard remain material payloads. The audit did not establish a small, safe extraction that warranted a rewrite during this task.
- Checked media and dynamic account-visible metadata deliberately incur fresh origin/database work. New application URLs provide immediate visibility checks; shared caching would undermine that contract.
- Query plans and real private dashboard latency remain unmeasured; synthetic checks prove query count and correctness, not production database throughput.

The final review did not justify another general optimization cycle. Faster initial paint was observed under lighter host load, but media startup and aggregate bandwidth cannot be claimed universally faster after the separately requested privacy and neighbor-loading changes.

## 12. Optional future improvements

**OPTIONAL FUTURE IMPROVEMENT:** Evaluate adaptive/lower-bitrate renditions using real mobile buffering data and visual comparisons. Preserve the source and appropriate quality; this is a separate media pipeline decision, not an automatic infrastructure addition.

**OPTIONAL FUTURE IMPROVEMENT:** Use field measurements to decide whether shell/CSS separation or deeper role-specific dashboard splitting warrants the implementation cost. Revisit directory/analytics limits when real volume approaches existing bounds. No Redis, queue service, replacement framework, new CDN or speculative virtualization is proposed for the current findings.
