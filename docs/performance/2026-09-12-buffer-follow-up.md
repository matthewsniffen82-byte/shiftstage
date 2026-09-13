# Playback buffer follow-up

This sequential pass starts at `9406af1e`, building on the existing audits and delivery fixes. It preserves the existing UI, media quality, protected/no-store delivery and data freshness. Raw local evidence is in the ignored `.next-speed-followup-20260912` directory.

## Step 1: give the playing video startup bandwidth

Two fresh production cellular samples (393 × 852, DPR 2, 4× CPU, 4 Mbps down, 100 ms latency) reproduced a remaining bottleneck: the next clip began downloading with only **0.47 and 0.55 seconds** buffered in the active clip. Each sample subsequently recorded two post-start waiting events. Existing first-frame readiness is insufficient evidence of bandwidth available for neighboring downloads. The recent neighboring-poster and backward-swipe fixes remain necessary.

Home TV, the shell profile viewer and the routed React profile viewer now wait for three seconds buffered ahead of the playhead, or the remaining duration of a shorter clip, before warming adjacent video sources. They use the contiguous range containing the playhead; a future seek range does not count. Progress events re-evaluate eligibility only when it changes. The React viewer updates media resources directly without new state updates. Listeners are removed on viewer changes/unmount. Existing source reuse, Data Saver, hidden-page suspension, manual pauses, eager nearby posters and both directions of warmup are retained.

A regression first failed against both production shell players with a decoded frame and half a second buffered. After the fix, 50 focused tests and focused lint passed, including resource windows, same-element reuse, rapid reversals, presentation and visibility. New coverage also checks short clips, seek gaps, 30 repeated progress events without redundant updates, and observer cleanup.

Two local-source cellular browser samples started the first clip without starting any neighboring video download during the nine-second observation window. Both still experienced buffering: the existing source bitrate remains a constraint. These are avoided competing downloads, not a claim of eliminated stalls or a controlled startup-time speedup. A separate unthrottled browser lifecycle passed initial play, eight rapid forward/backward scrolls with visible previews, hidden pause/resume and exit cleanup. At most one video played, no more than three sources were attached, and leaving TV released all sources.

The existing private media metadata was also sampled before considering narrower projections. Twelve rows were only 517–899 bytes each, so that change was not justified as a meaningful playback bottleneck. No database query, security rule or media encoding was changed.

Delivered as `e13785fc1c40fd75cdcf461b57f4f3cbb28dfff2`; the local commit matched `origin/main` and [Vercel succeeded](https://vercel.com/ai-movie-jobs/shiftstage/G8p9cctzbaUfQJTvXaUXYjMCidHc).

## Remaining scope review

- Cards and images: existing responsive source sets include small avatars; photos reserve dimensions; hero art has a responsive preload. The last recorded visible dancer-card image requests selected 320-pixel candidates for approximately 122 CSS-pixel cards at DPR 2. Current code retains these attributes. Existing poster images cover inactive video surfaces independently of native video decoding.
- Rendering and feeds: the production directory is an HTML shell, so React memoization would not reduce its work. Content keys retain unchanged card DOM, scrolling uses frame scheduling, and profile media renders in batches of 12. Discovery is bounded at 200 profiles per city (800 across all cities), with explicit relationship limits. Cursor pagination remains a scaling follow-up; the current small catalog does not establish performance at those limits.
- Fetching and navigation: discovery enrichments run in parallel, card metrics are batched, obsolete media requests are cancelled, and profile intent prefetch is bounded to a small short-lived cache. Existing venue/profile return state and scroll restoration are retained. Gallery metadata returned in discovery is used by the shell profile/gallery; deleting it would require a new loading contract.
- Caching and bundles: protected media and live visibility keep their authorization and no-store rules. Versioned assets and venue artwork keep existing caching. Heavy dashboard upload, NFC, shift and team tools already use dynamic imports. The large shared shell/CSS remains a material parsing/rendering cost; separating it safely is broader architecture work, not a small speculative change in this pass.

No additional measured small fix was established by this review. Final browser verification checks these paths once, with targeted follow-up only if it discovers a regression.

## Final automated verification

The system's default Node 24.16.0 failed the repository's runtime gate before tests/build began. Validation then used the existing Node 24.21.0 installation; no runtime requirement was bypassed or changed.

One complete suite run passed 9,445 tests and found three existing test-file import failures. `high-resolution-images`, `public-media-watermarks` and `responsive-upload-recovery` had not adopted the server-only marker resolution already required by the protected media signer. The native-import tests now use the existing narrow helper; the VM loader resolves only that signer's marker to Next's server implementation. All 49 tests inside these files passed in focused rechecks. Assertions and production security boundaries were unchanged. The complete suite was not repeated.

The final production build passed compilation, lint/type validation, page generation and tracing. Runtime/FFmpeg verification, migration checks, generated asset checks and the 274-file public-build security scan passed. The postbuild helper confirmed that no demo data operation ran. Only test setup and this report changed in this performance pass after the successful video deployment.

## Final production browser verification

The deployed shell and script matched the validated source exactly before measurements. Three cold cellular samples per route produced these medians:

| Route | LCP | CLS | Initial requests |
| --- | ---: | ---: | ---: |
| Home | 1,692 ms | 0.006 | 43 |
| Working Now | 1,464 ms | 0.007 | 36 |
| Venues | 1,576 ms | <0.001 | 42 |
| Dancer profile | 1,956 ms | 0 | 34 |
| TV | 4,112 ms | 0 | 41 |

All 15 samples had zero uncaught application errors or critical request failures. The five-second scroll samples recorded route medians of 0.36–0.73% of frames exceeding 50 ms, and no reported dropped video frames. TV loadstart-to-first-play was 1,495 ms. These are final lab observations, not attributed before/after page-speed improvements or field Core Web Vitals. The reliable change is removal of competing downloads while the active clip has little buffer.

The deployed two-run warmup probe confirmed that one constrained run never started a neighboring download during the observation window; the other waited until **3.11 seconds** was buffered, compared with 0.47/0.55 seconds in the baseline. First-card playback succeeded in both. Existing high source bitrate still caused waiting in one run.

- Production video lifecycle passed initial play, eight rapid forward/back transitions, visible posters, hidden pause, visible resume and exit cleanup. At most one player was playing; source/poster bounds held and exit released every video source. The routed profile journey preserved manual pause, resumed the same element and released the detached player after touch close.
- Android cellular, slower Android and iPhone portrait journeys passed all eight navigation/playback phases. The initial WebKit iPhone landscape run timed out waiting for profile playback, without runtime/network errors. An isolated diagnostic recheck passed all eight phases without any code change. The original timeout is retained as an unresolved lab observation, not erased or called a fixed production defect. Chromium emulation and the desktop WebKit port do not prove physical-phone decoder, thermal or memory behavior.
- Directory Now/Upcoming/All filters returned the expected counts and kept keyboard focus. Desktop home, 14 dancer cards, 17 venue cards and the profile grid had loaded visible images and no horizontal overflow, runtime errors or failed HTTP responses. Viewed mobile and desktop screenshots retained the established layout. The only desktop console warnings came from the harness deliberately blocking service workers.
- Three responsive hero configurations each requested one correctly sized image with immutable versioned caching. Cache-enabled return visits transferred 939,996 → 328,861 bytes on home (26 cache hits), and 340,312 → 127,832 on the profile (22 hits on return). The profile's first visit already shared common assets from home. These confirm existing caching; they are not new savings from the video change. Protected media caching rules remain unchanged.
- Fifteen public document routes and four anonymous private-API denial checks passed. Health checks passed. Bundle inventory retained 155 route entries and 52 client component entries; no dependency or speculative bundle rewrite was introduced.

A separate user styling change, `e820741e`, reached `origin/main` during final verification. It changes the venue Free Ride + Entry outline and its static asset fingerprint. It was fast-forwarded and preserved. The affected venue/card/version tests passed; a focused production check confirmed exact stylesheet delivery, the green outline and no overflow/runtime errors at 393 and 1440 pixels. Its [Vercel deployment succeeded](https://vercel.com/ai-movie-jobs/shiftstage/C5x56x7L7xSz4CmXHYpMzHwzcyVi). The general suite, route measurements and local build were not repeated for this independent CSS change.

## Changed components and remaining limits

Production changes are confined to `outputs/index.html` (home TV and shell profile players), `app/dancers/[slug]/DancerPhotoCarousel.tsx`, `src/lib/dancr/video-buffer-policy.ts`, and the generated shell fingerprints. Added/updated video policy and browser probes cover the change. Three existing image/upload test imports were corrected during final verification. No styling, business logic, media quality, dependency, migration or RLS change belongs to this performance patch.

The next larger improvements need separate work: adaptive bitrate delivery for high-bitrate sources, safe separation of the large shared shell/CSS, and cursor pagination as discovery approaches its current limits. Protected per-request authorization retains its latency/cache cost. Physical Android/iPhone testing and field responsiveness measurements remain necessary for claims beyond the lab results here.
