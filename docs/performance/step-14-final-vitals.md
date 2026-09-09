# Step 14 — final performance comparison

Step 13 was pushed at `18750534540127b9fafb07cc787d717a91e45740` and reached Vercel success. All 2,937 tests, TypeScript, lint, migration guard and production build passed. Both deployed held-response/retry scenarios and all three dashboard roles passed. Production loading behavior was intentionally maintained.

## Method and attribution

The final audit repeats Step 1's seven public routes and synthetic customer dashboard with three cold cellular samples each, plus diagnostic Wi-Fi/slow-network home and TV runs. The same Chromium viewport, CPU/network throttling, six-second initial sampling window and five-second scroll journey are used. API writes are suppressed. Customer private responses are synthetic; authentication/database latency is not inferred from that fixture. Field INP and physical-phone performance remain unmeasured.

The runner now records aggregate host CPU busy percentage over each journey without installing a watcher or changing application timing. Heavy shared-host contention is retained in the artifacts, not hidden by selecting favorable samples. Step 1 did not record this host metric, so final timing deltas are observations under nonidentical host conditions rather than controlled causal estimates. Per-step matched resource and startup comparisons provide stronger attribution.

Concurrent application/security releases were preserved throughout this campaign. Immediately before these final samples, `8e2f7242` added compact profile actions and another small stylesheet/request. Source size changes from those independent features, hardened validation, and newer media content must not be attributed solely to this performance pass. Public TV media now includes larger files than Step 1. The retained Step 9 implementation is compact **inline** CSS; the rejected external-CSS/preload experiments do not contribute their discarded warm-transfer claim to final results.

## Final measurements

All 28 samples completed with no JavaScript errors, failed critical requests or reported stalled events. `final-measurements.json` contains all route/profile medians, API observations, request counts, heap/scroll samples and caveats. Initial data means bytes at the fixed six-second cutoff, not eventual total media consumption.

| Cellular route | LCP before → after (ms) | FCP before → after (ms) | TTFB before → after (ms) | CLS before → after | JS before → after (bytes) | Initial data before → after (bytes) | Requests before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | 2,404 → 1,820 | 2,404 → 1,820 | 96.8 → 125.7 | .025 → .028 | 255,255 → 257,197 | 1,115,432 → 913,213 | 42 → 43 |
| Working/discovery | 1,956 → 1,964 | 1,956 → 1,964 | 101.6 → 117.9 | .039 → .052 | 255,157 → 256,951 | 921,197 → 795,005 | 35 → 36 |
| Venue feed | 2,464 → 1,780 | 2,464 → 1,780 | 90.6 → 118.5 | 0 → 0 | 255,154 → 257,171 | 899,796 → 701,566 | 41 → 42 |
| Dancer profile | 3,212 → 2,680 | 2,184 → 2,272 | 122.5 → 115.4 | 0 → 0 | 159,281 → 160,245 | 362,479 → 313,381 | 31 → 31 |
| Venue page | 2,060 → 2,368 | 2,060 → 2,368 | 356.1 → 599.1 | .030 → .038 | 255,214 → 257,282 | 1,093,020 → 817,851 | 48 → 49 |
| TV | 7,252 → 7,412 | 2,116 → 2,364 | 234.7 → 278.7 | .004 → .014 | 254,976 → 257,727 | 2,428,064 → 2,126,016 | 56 → 37 |
| Login entry | 1,680 → 3,352 | 1,680 → 3,228 | 79 → 110.1 | 0 → .002 | 255,162 → 257,170 | 901,898 → 788,558 | 34 → 35 |
| Customer fixture | 1,944 → 3,028 | 1,428 → 2,124 | 87.5 → 109.6 | .009 → .001 | 339,378 → 250,124 | 670,224 → 566,268 | 30 → 27 |

Initial data reductions are 18.1% home, 13.7% discovery, 22.0% venue feed, 13.5% dancer profile, 25.2% venue page, 12.4% TV, 12.6% login entry and 15.5% customer fixture. Dashboard JavaScript is 89,254 bytes / 26.3% lower. Public JavaScript grew roughly 1–3 KB across intervening security/features and this campaign; it is not claimed as reduced. The independent profile stylesheet adds one request to shell pages; TV still initiates 19 fewer requests overall.

Home's sampled interaction maximum improved 704 → 496 ms, but this is not field INP and remains above 200 ms. Venue-feed scroll frames above 50 ms improved 8.939% → 3.365%; TV increased 6.522% → 9.360%. All measured CLS medians are below .1. The LCP goal is not met on every route.

## Regression investigation and limits

Host CPU medians were 81.2–100% across cellular routes (99.6% TV; 100% login). Login's unchanged hero was the LCP element in all three samples; longest main-thread tasks ranged 1,478–2,229 ms while it delivered fewer bytes. Customer LCP ranged 2,224–3,796 ms despite the smaller bundle. These timings show loaded-host variability, not proof that bundle splitting increased latency. The earlier matched Step 2 comparison improved customer LCP 2,192 → 1,804 ms. The final route timings are retained honestly, not replaced with favorable earlier measurements. A quiet-host and physical-device follow-up remains necessary for a clean timing comparison.

TV's LCP was its active video's poster/frame. Cellular startup improved 2,096.9 → 1,216.3 ms in the final observation, while navigation-to-playing was 8,675.4 → 8,055.1 ms; the initial shell/feed work is still material. In the stronger matched Step 4 comparison, cellular startup was 2,069 → 912 ms and Wi-Fi data fell 29.7%. Final single-run Wi-Fi/slow TV data fell 19.8%/78.8%, but content and sampling cutoffs make those diagnostic observations, not controlled causal gains. Short-run dropped-frame counters were zero; they reset on released players and do not prove no frame was ever dropped. Waiting events remain and include initial buffering.

The twelve direct API probes all returned 200. Median complete response times were cities 71.6 ms, discovery 73.1 ms, venues 206.2 ms and TV 65.1 ms. Discovery's first cold response took 2,469 ms and returned 344,191 decoded bytes versus roughly 270 KB at Step 1; later cached responses took 71–73 ms. Current content/payload and uncached origin work remain bottlenecks. No query-plan access was available to justify speculative indexes, security changes or broader public caching. Venue-page redirect TTFB varied 599–1,163 ms in two final samples, contributing to its slower paint.

All three bounded video range probes returned 206 and showed `moov` at byte 32 before `mdat`. Current 1080×1920 samples were 8.4–14.4 MB for 15.09 seconds: high bitrate still constrains cellular playback. The live resource journey retained at most three sources/posters, one playing video, no playing video while hidden and zero sources after leaving TV. Six repeated city/scroll/exit cycles also passed the bounded-resource assertions. Existing MP4 quality and security gates remain intact; a carefully measured rendition/transcoding project is a separate recommendation.

This step adds host-load reporting and durable final measurements rather than a speculative late runtime change. Complete tests, TypeScript, lint, migration guard, production build, an independent push/deployment and live verification precede Step 15. The later `9d1b3c3e` and `efff5a5d` profile-surface/accessibility updates are preserved and validated; they change a small stylesheet and accessible labels, not the shell script or measured media policy.

The independent `a777507f` security release then added private-page script nonces and no-store headers. It is also preserved, with a fresh complete validation and deployed dashboard compatibility check. The 28-sample cohort predates this security-header release; its unchanged public shell/media measurements remain the recorded cohort, while private-page results are not presented as measurements of the new nonce policy.

The final build inventory (`final-source.json`) records dashboard route chunks at 907,107 raw / 222,575 gzip-estimated bytes, versus 1,241,845 / 307,723 in Step 1 (26.95% raw and 27.67% gzip reduction). The classic home script is 1,178,717 raw / 236,896 gzip-estimated bytes versus 1,168,674 / 234,878 originally; its remaining parse cost is not hidden. Source inline CSS stays unchanged because compaction is a build/delivery transform. All 2,965 release tests, TypeScript, lint, migration guard and production build passed. A post-build host probe still measured 99.4% CPU busy, so a purported quiet-host timing rerun was not claimed.
