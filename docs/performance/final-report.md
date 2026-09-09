# MyDancr performance hardening — final report

This report covers the fifteen-step performance pass. Each step was kept separate, validated and deployed before the next began. The final release is the commit containing this report; its own exact hash, deployment URL and final verification results are supplied in the delivery manifest and final handoff. Historical deployment evidence and raw measurements are retained under `.codex-delivery/performance-hardening-20260909/` outside the application source tree.

## Completed work

| Step | Implementation and verified outcome |
| --- | --- |
| 1 | Audited the Next/React and classic home-shell architecture, routes, bundles, CSS/fonts, images/video, Supabase/API paths, caches, analytics and lifecycle behavior. Added repeatable source, browser and API/range measurement tools; recorded 28 baseline samples. |
| 2 | Split seven optional dashboard modules and warmed required tools during private loading. Matched customer JavaScript transfer fell 339,945 → 249,273 bytes (26.7%); total initial data fell 13.6%, with 30 → 27 requests. |
| 3 | Added responsive hashed WebP hero variants, corrected image sizing/contain behavior, introduced 96/160px avatar variants, and limited high priority to genuine first-visible images. Kept original/watermarked media and focal information. Matched initial data fell 17% home, 14% profile and 20.6% venue feed. |
| 4 | Prioritized the active video, limited next-video warmup to metadata after the first frame, restricted distant sources/posters, paused hidden/offscreen playback, preserved manual pause and same-element resume, and canceled unused sources. Matched cellular startup fell 2,069 → 912 ms (55.9%); Wi-Fi initial TV data fell 29.7%. |
| 5 | Reused at most sixteen Intl formatter configurations while keeping dates fresh. Startup formatter constructions fell 179 → 3; six-filter synchronous work fell 176.55 → 98.25 ms (44.4%). Preserved timezone/DST behavior and existing incremental feeds. |
| 6 | Batched private owner/admin media signing in bounded 100-item chunks, deduplicated paths, and ran independent authorized workspace work concurrently. Owner fixture signing calls fell 50 → 1; admin calls 100 → 1. Database query counts and authorization boundaries stayed unchanged. |
| 7 | Propagated request cancellation through fetch, body reading and retry waits; canceled obsolete city/video metadata requests and retained valid in-flight work. Stale-request fixture fell from two pending requests after leaving TV to zero; live abort/return-to-playback checks passed. |
| 8 | Generated content-versioned static asset URLs and applied immutable caching only to matching hashes. Mutable/obsolete paths revalidate; private data remains no-store. Six warm home runtime-script network requests fell to zero; warm profile requests fell six → four. |
| 9 | Applied lossless build-time CSS whitespace compaction while retaining inline delivery and exact cascade order. Main CSS fell 908,266 → 718,398 raw bytes (20.9%), with all 3,486 CSSOM rules unchanged. Font swap/preconnect and visible styling were preserved. External CSS/preload experiments were rejected after mixed or slower cold paint. |
| 10 | Deferred the server OpenAI SDK import until a moderation request actually needs it. Initial loaded TV server code fell 587,486 → 488,823 bytes (16.8%). Required moderation, credentials, models, prompts and fail-closed behavior remain; no production latency gain is claimed from the import fixture. |
| 11 | Audited timers/listeners/observers/subscriptions/object URLs and media references. Added a twenty-second deadline and deterministic cleanup to both local video metadata readers. Stalled readers now release their URL, source, handlers and timer. Six repeated media journeys stayed bounded. |
| 12 | Tested six mobile configurations. Fixed the profile viewer's trapped stacking context and notice inset so touch-close works in portrait and landscape. It improved from blocked in six of six baseline configurations to working in six of six. Native fullscreen behavior remains separate. |
| 13 | Verified existing progressive, optimistic and retry states with held-response/error fixtures. Preserved the verified-identity dashboard gate and current Follow/Following/Favorite/Saved wording. No extra spinner or speculative loading UI was added. |
| 14 | Repeated 28 full-route samples plus three post-security customer samples; checked APIs, range delivery, video bounds, memory cycles, styles and dashboard roles. Added host CPU reporting and recorded timing regressions/limits honestly. |
| 15 | Added final route/security regression coverage and a stricter detached-video check. That check found and corrected a profile video retaining its source after close. A stable React ref cleanup now releases that exact node without disrupting mounted playback. Full release checks and deployed regression results accompany the final delivery manifest. |

## Release record

Every hash in the first fourteen steps below was pushed to `origin/main`, reached **Vercel success**, and received production verification before the next step began. Steps 4 and 9 required multiple small releases within their own step; they were not combined with another step. The final handoff supplies the self-referential Step 15 release identifiers after deployment.

| Step | Full commit hash | Exact Vercel deployment |
| --- | --- | --- |
| 1 | `d93ecffe5808efa849fc09cc0f0cb428cd0b8c1e` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/HwxUkNVjXgKbRaexJuXQuRped5sQ) |
| 2 | `ac9ea442c1ff9f7f649d36446c25efe5583dae32` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/GeAFzWFHbNtyJyTtktXCJXny217W) |
| 3 | `8e12a9e95778a6889d1baa729aec71dd4dd86fe5` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/GFZQwYjUHRop42BJjdauGBxwjemc) |
| 4 implementation | `78067bf7b2895f4b8068860b4d0ccc18ac15a0a3` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/FaJDnCj1UZyRCGFvBhPxgUE5PQoP) |
| 4 verification | `518107a86da2f4cc79e01175a47f8f9cba8fff6c` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/GDeuyxQDLLMQ5ngnbM6iUkwrJaxv) |
| 5 | `b9ca4140fae0b14f656a87fa4bff21a7974ea679` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/F6aMciXAAQtpJrGN4XwJvEqdU3ye) |
| 6 | `d62c04e52de86c22d3e7ed0ee1713cfafd47d9a6` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/81P2nPTKPvYNjcobK4E51ngrjAta) |
| 7 | `d2383163be446be1382d99cbee94c8babb37a28f` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/5cpXqrqABfv9vA47Z5XB3aX22CTz) |
| 8 | `3f14c63342850cf6ec060007f6fe3b4b561839f1` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/3CRniT2G4FpxrMYKKQ2WtwaVat42) |
| 9 external CSS experiment | `eb75d8436d5c9c662358cd4ea906fd367da688fc` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/5RUBWHEkXtL5tAFiVkkUhGw6vS1P) |
| 9 static CSS experiment | `ac451c674a64af33753cf2d1c178b1bea285ca94` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/9m85W4QjCyXQspm1b8tabAomcgMx) |
| 9 preload experiment | `bd70d9fa57e3a2acab72709ac8679a09c7f1159a` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/jjaqxKc3LqFQFmTYoNypzN4xENsu) |
| 9 retained inline compaction | `25f63e9194caa7bf2fd91cdb6d48bbed5fcaa3d1` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/iXGjRceT8PYVjEs7WvPnHideYssz) |
| 10 | `9cfa154ec8438e65b5df69fab55f99a01d7a7b84` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/59YtDi7wtQyLFaLrMrW3q6JvR1qH) |
| 11 | `3b589b18bd0a756159fefb397a70e25eea8ae183` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/2ipeQZWLZK95eADtL5Soax3F3yvz) |
| 12 | `a57946ce35d7d1544917ee3d041179ddccb934d4` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/22iLfeGj1YKJ5ELXJExrmtBD4v2m) |
| 13 | `18750534540127b9fafb07cc787d717a91e45740` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/8dTxLtRxTJjaFiNBa51XRxwAdtCZ) |
| 14 | `1878d946e3fa9f5d5472ce3383a9540778adbf7a` | [Success](https://vercel.com/ai-movie-jobs/shiftstage/D78WBPJ7FsEfn3haw4RFLPvgYmqH) |
| 15 | Final release hash in delivery manifest | Final deployment in delivery manifest |

## Baseline versus final measurements

Three cold-cache Chromium cellular runs per route: 393×852, DPR 2, 4× CPU slowdown, 4 Mbps down/1 Mbps up and 100 ms configured latency. Initial transfer is sampled six seconds after load. Private customer responses are synthetic, not measurements of production authentication/database latency. Field INP and physical-device results are unavailable.

The final full cohort encountered 81–100% host CPU contention, unlike an unrecorded host baseline. Independent feature/security releases and public media content also changed. These final timing deltas are observations, not clean causal estimates. All samples are retained. Customer values below use the later three deployed samples with nonce security headers; the full earlier cohort remains in `final-measurements.json` and the later fixture is in `final-customer-measurements.json`.

| Cellular page | LCP ms before → final | FCP ms before → final | TTFB ms before → final | CLS before → final | JS bytes before → final | Initial bytes before → final | Requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | 2,404 → 1,820 | 2,404 → 1,820 | 96.8 → 125.7 | .025 → .028 | 255,255 → 257,197 | 1,115,432 → 913,213 | 42 → 43 |
| Working/discovery | 1,956 → 1,964 | 1,956 → 1,964 | 101.6 → 117.9 | .039 → .052 | 255,157 → 256,951 | 921,197 → 795,005 | 35 → 36 |
| Venue feed | 2,464 → 1,780 | 2,464 → 1,780 | 90.6 → 118.5 | 0 → 0 | 255,154 → 257,171 | 899,796 → 701,566 | 41 → 42 |
| Dancer profile | 3,212 → 2,680 | 2,184 → 2,272 | 122.5 → 115.4 | 0 → 0 | 159,281 → 160,245 | 362,479 → 313,381 | 31 → 31 |
| Venue page | 2,060 → 2,368 | 2,060 → 2,368 | 356.1 → 599.1 | .030 → .038 | 255,214 → 257,282 | 1,093,020 → 817,851 | 48 → 49 |
| TV | 7,252 → 7,412 | 2,116 → 2,364 | 234.7 → 278.7 | .004 → .014 | 254,976 → 257,727 | 2,428,064 → 2,126,016 | 56 → 37 |
| Login entry | 1,680 → 3,352 | 1,680 → 3,228 | 79 → 110.1 | 0 → .002 | 255,162 → 257,170 | 901,898 → 788,558 | 34 → 35 |
| Customer fixture | 1,944 → 3,124 | 1,428 → 1,980 | 87.5 → 142.5 | .009 → .009 | 339,378 → 250,011 | 670,224 → 566,374 | 30 → 27 |

Initial data fell 18.1% on home (202,219 bytes), 13.7% discovery, 22.0% venue feed, 13.5% profile, 25.2% venue page, 12.4% TV, 12.6% login and 15.5% customer. Customer JavaScript fell 89,367 bytes (26.3%). Public JS grew roughly 1–3 KB; an independently introduced profile stylesheet adds one shell request. No general public-JS reduction is claimed.

Built dashboard route chunks fell 1,241,845 → 907,107 raw bytes (26.95%) and 307,723 → 222,575 gzip-estimated bytes (27.67%). The classic home script remains large: 1,168,674 → 1,178,717 raw bytes; 234,878 → 236,896 gzip estimate. Source estimates differ from actual browser transfers. The final small video-ref cleanup adds only its lifecycle helper to the profile bundle; these full source/transfer cohorts precede that detach-only correction.

Subsequent independent paused-account recovery and profile-button styling releases were also preserved and revalidated. Their version changes, like the detach correction, are not retroactively assigned the earlier cohort's exact byte/timing values. The final deployment regression checks current functionality and resource cleanup.

Home's sampled interaction maximum fell 704 → 496 ms, still above 200 ms and not field INP. Venue-feed frames over 50 ms fell 8.939% → 3.365%; TV rose 6.522% → 9.360% on the contended host. All final CLS medians are below .1. LCP is not below 2.5 seconds on every route. Login, customer and TV final timings remain explicit limitations; the stronger earlier matched customer comparison improved LCP 2,192 → 1,804 ms.

## Video, image, API and resource results

- Final cellular first-video startup was 2,096.9 → 1,216.3 ms (42.0% observed reduction); navigation-to-playing was 8,675.4 → 8,055.1 ms. The matched Step 4 comparison is stronger evidence: 2,069 → 912 ms startup (55.9%). Its slow-network first-card starts improved zero of three → three of three. Waiting still occurs; no universal buffering elimination is claimed.
- Final diagnostic single-run TV data was 10,869,847 → 8,721,576 bytes on Wi-Fi and 5,096,921 → 1,079,456 on the slow profile. Content, timing cutoffs and host contention limit attribution. Matched Step 4 Wi-Fi data fell 29.7%. Released-player counters reset, so reported zero dropped frames is only a short-run lower bound.
- TV retains at most three nearby sources/posters and one playing video; hidden pages pause, and leaving TV releases all sources. The final profile correction also clears the detached original player's source. Six browsing cycles retained no detached playing/sourced videos; exit listener counts stayed at 280 and nodes stabilized after warmup. About 4.17 MB exit heap/4.27 MB final TV heap is consistent with prior cycles, not proof of zero leaks over unlimited use.
- The 45,754-byte PNG hero now has 10,590/19,778/34,786-byte WebP variants at 480/800/1280px. Small avatar variants were 85–92% smaller in matched probes. Correct dimensions, responsive selection, watermarks, focal positioning, first-visible priority and below-fold lazy loading remain. Final sampled visible images had no broken loads or HTTP failures.
- Twelve final API probes returned 200; median complete times were cities 71.6 ms, discovery 73.1 ms, venues 206.2 ms and TV 65.1 ms. Discovery's uncached first response took 2,469 ms and returned 344 KB decoded; later cached reads were 71–73 ms. These are not claimed as a matched database-latency improvement. The measured database-path improvement is bounded signing calls (50/100 → one), plus cancellation of stale frontend requests.
- Three current video range probes returned 206 and showed fast-start `moov` before `mdat`. Videos were 1080×1920, 8.4–14.4 MB for about fifteen seconds. Existing range delivery/fast-start was already correct; no codec quality reduction or paid infrastructure was introduced.
- CSS compaction retained every rule; the discarded external-CSS experiment's 59% warm-document transfer gain is **not** claimed for the final inline implementation. Required fonts, analytics, push enrollment, moderation and verification integrations remain. Initial public client traces contained no third-party JavaScript; required integrations already load on demand.

## Regression coverage and remaining work

Validation includes the complete automated test suite, TypeScript, lint, migration guard and production build for each release. Final safe checks cover public routes, account aliases, private-data denials/CSP, discovery and city/filter controls, profiles, venues, Back, forms, images, video lifecycle/rapid scrolling, loading error/retry, CSS equivalence and three synthetic dashboard roles. Six mobile configurations include Android/iPhone-sized Chromium under Wi-Fi/cellular/slow conditions and portrait/landscape WebKit. These are simulated devices; WebKit is the desktop port, not a physical iPhone.

The final integrated local release passed all 2,990 automated tests, TypeScript, lint, migration guard and production build. Its post-deployment result and exact release identifiers are recorded with the final handoff, rather than claiming a deployment before it happens.

Runtime/database tests cover auth/session rotation, signup/recovery, callbacks, follow/save persistence, notification preferences, schedules, Working Now, visibility/moderation, upload validation, analytics and authorization. Real production signup emails, account login/logout, uploads, admin edits and financial events were not submitted without credentials. No claim is made that those live mutations were exercised end to end. Unrelated user work and concurrent security/database/feature releases were preserved.

The desktop WebKit runner sometimes labels canceled old-document TV/TV-count requests as access-control page diagnostics. These are retained and classified only when the exact canceled request, navigation phase and inspector stack match and no window error/unhandled rejection occurred. All unmatched diagnostics and runtime errors still fail. A landscape baseline occurrence and its repeat are documented; it is not presented as a successful HTTP response or silently discarded.

Remaining bottlenecks are the large classic home bootstrap, high-bitrate video sources, slow uncached discovery/venue work, a roughly 344 KB discovery payload, and a possible row-cap issue in thirty-day raw TV analytics aggregation. Production query plans and real-device/field measurements were unavailable. A quiet-host repeat and physical iPhone/Android testing should precede precise timing promises.

Potential paid-infrastructure recommendation: evaluate a small mobile rendition ladder and adaptive streaming/transcoding using existing FFmpeg/Storage first, with measured compute/storage/egress budgets. A dedicated video CDN or managed transcoder may help if that cannot meet the target, but requires separate cost approval. No vendor, subscription or recurring charge was created.

Intentionally avoided: speculative indexes without plans, weaker RLS, public caching of private data, longer stale windows for Working Now/moderation, broad feed virtualization without evidence, indiscriminate memoization, reduced media quality, a wholesale shell rewrite, blanket third-party removal, unnecessary font preloads, new spinners, and the external CSS/preload approach that worsened cold rendering. The pass improves measured resource usage and several matched timings while preserving working behavior; it does not claim that every speed target has been achieved.
