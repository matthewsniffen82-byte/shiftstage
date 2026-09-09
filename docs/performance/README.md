# MyDancr performance hardening

This work follows the requested 15-step order. Every step gets its own complete validation, commit, push, successful Vercel deployment, and production verification before the next step starts. No paid services, redesign, relaxed security, or production test-account mutations are part of this pass.

## Measurement protocol

`scripts/performance/mobile-baseline.mjs` uses an existing Playwright installation (set `PERF_PLAYWRIGHT_MODULE` if it is outside the repository). It does not add a runtime dependency. The default is three cold-cache Chromium mobile runs on the production origin, at 393 × 852 CSS pixels, DPR 2, 4× CPU slowdown, 4 Mbps down / 1 Mbps up, and 100 ms latency. Wi-Fi and slower-device/network profiles are also supported. Tests and builds must finish before timed runs begin.

The runner records LCP, FCP, navigation TTFB, session-window CLS, sampled interaction latency, long tasks, resource transfers, API durations, image dimensions, video load/play/wait/stall events, decoded/dropped frames, a five-second scroll sample, and browser heap/DOM counters. It strips URL query strings from network artifacts and suppresses API writes to avoid changing production accounts or creating test engagement. The age gate is marked accepted in the disposable browser context. No real account credentials are read or stored.

Use `PERF_ROUTES` (JSON array), `PERF_RUNS`, `PERF_PROFILES` (`wifi,cellular,slow`), `PERF_BASE_URL`, and `PERF_OUTPUT` to repeat a subset. `scripts/performance/summarize.mjs` accepts one or more result files and writes medians to `PERF_SUMMARY`. `scripts/performance/source-inventory.mjs` records source sizes, compression estimates, route inventory, and built route chunks.

For a customer rendering-only sample, set `PERF_CUSTOMER_FIXTURE=1` and use `/dashboard/customer`: a disposable browser session and synthetic empty private responses are supplied, and the summary labels this fixture explicitly. This is never a measure of production authentication or private database latency. `scripts/performance/api-media-probe.mjs` separately checks public API timings and at most three 1 MiB media prefixes, without retaining signed URLs.

### Interpretation limits

- These are browser lab measurements, not field Core Web Vitals or measurements on physical phones. Sampled interaction latency is **not field INP**; a route with no measured interaction reports null.
- Redirected URLs report paint/TTFB for the final document and transferred bytes for the complete navigation. A signed-out dashboard redirect does not measure authenticated dashboard loading.
- Initial transfer is measured six seconds after the page load event; progressive media can continue after that cutoff. Request count includes initiated requests. HTTP transfer sizes and gzip source estimates are different quantities.
- Video startup is first `playing` minus first `loadstart`; navigation-to-playing includes routing, fetching, rendering, and player startup. `waiting` includes initial buffering. Released players reset decoded/dropped counters, so final counters are a lower bound for the whole journey.
- Short-scroll heap growth is not proof of a leak. Dedicated repeated-navigation/media lifecycle checks belong in Step 11.
- Dynamic production content, server warmup, network variability, and host scheduling affect timings. Use medians and deterministic source/request comparisons; do not claim improvements from a single favorable run.

## Release record

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Audit, measurements, optimization plan | Pushed `d93ecffe`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/HwxUkNVjXgKbRaexJuXQuRped5sQ); live health, private access rejection and mobile samples verified |
| 2 | Initial JavaScript and load overhead | Pushed `ac9ea442`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/GeAFzWFHbNtyJyTtktXCJXny217W); all three role smoke checks and live health passed |
| 3 | Responsive image delivery | Pushed `8e12a9e9`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/GFZQwYjUHRop42BJjdauGBxwjemc); image selection, live health and nine mobile samples verified |
| 4 | Mobile video loading and playback | Pushed `78067bf7`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/FaJDnCj1UZyRCGFvBhPxgUE5PQoP); live resource/profile journeys, health and nine mobile samples verified; verification-only follow-up records the corrected profile fixture and results |
| 5 | Feed rendering and scrolling | Pushed `b9ca4140`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/F6aMciXAAQtpJrGN4XwJvEqdU3ye); live filter work reduced 44%, counts/focus/scroll and three role journeys passed |
| 6 | Supabase and database access | Pushed `d62c04e5`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/81P2nPTKPvYNjcobK4E51ngrjAta); private signing requests reduced 98–99% in loader fixtures; live API/media/role and access-boundary checks passed |
| 7 | API/network requests | Pushed `d2383163`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5cpXqrqABfv9vA47Z5XB3aX22CTz); obsolete requests cancel on navigation; normal profile/video journeys and live API/health checks passed |
| 8 | Safe resource caching | Pushed `3f14c633`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/3CRniT2G4FpxrMYKKQ2WtwaVat42); version headers, warm cache reuse, three roles and public playback verified |
| 9 | CSS, fonts, rendering | Final `25f63e91` pushed; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/iXGjRceT8PYVjEs7WvPnHideYssz); lossless inline CSS compaction, home/venue paint and transfer improved; external-delivery experiments rejected after cold-load checks |
| 10 | Third-party overhead | Pushed `9cfa154e`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/59YtDi7wtQyLFaLrMrW3q6JvR1qH); initial public TV server code reduced 16.8%, 2,859 tests and live API/media/role checks passed |
| 11 | Memory/resource lifecycle | Pushed `3b589b18`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/2ipeQZWLZK95eADtL5Soax3F3yvz); 2,879 tests/checks, bounded metadata resources and six live browsing cycles verified |
| 12 | Mobile matrix | Pushed `a57946ce`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/22iLfeGj1YKJ5ELXJExrmtBD4v2m); 2,923 tests/checks, six deployed mobile configurations, profile touch-close/lifecycle and three roles passed |
| 13 | Perceived loading | Pushed `18750534`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/8dTxLtRxTJjaFiNBa51XRxwAdtCZ); 2,937 tests/checks, two loading/retry scenarios and three roles passed |
| 14 | Final vitals comparison | 28 repeat measurements plus API, video and memory verification recorded in `step-14-final-vitals.md` / `final-measurements.json`; release validation in progress |
| 15 | Regression and production validation | Pending |

The final report will list each pushed commit and verified deployment, measurements, intentional exclusions, and remaining infrastructure recommendations. Detailed execution artifacts are retained outside tracked application files in the delivery archive.
