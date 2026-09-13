# Sequential perceived-speed follow-up

Baseline revision: `2216ecb4`. This pass builds on the existing performance work and preserves protected media access, styling, features and encoding quality. Each implementation step is validated, committed, pushed and checked for Vercel success before the next change.

## Baseline

The existing mobile harness ran three cold Chromium samples each for `/` and `/tv`: 393 × 852, DPR 2, 4× CPU slowdown, 4 Mbps down, 100 ms latency. Median homepage LCP was 1,448 ms; TV LCP was 4,108 ms. No uncaught browser errors occurred. Raw evidence is in the ignored `.next-perceived-speed-20260912/before` directory. These are emulated lab samples, not physical-device or field INP measurements. Video byte counters have the read-ahead limitation documented in the previous report.

## Step 1 — stop abandoned media work

The protected media handler attached its abort listener only after database authorization completed. A request cancelled during either video lookup still started a Storage download; an already-cancelled request performed two queries and fetched the video. Photo lookups had the same gap.

The handler now propagates cancellation through the installed Supabase SDK, checks cancellation between dependent reads, and disposes late Storage responses. Authorization order, RLS, private/no-store headers, range delivery and original media bytes are unchanged.

The reproducer failed four cancellation scenarios before the fix. Afterward, cancellation at either video lookup or the parallel photo checks starts **zero** Storage requests; a request cancelled before entry starts **zero** queries. These are deterministic avoided-request counts, not an asserted percentage improvement in page speed. Tests also cover cancelling an active stream and a transport returning late headers.

Validation: media cancellation, media privacy and Supabase response-budget tests; focused ESLint; diff inspection. Delivery and final browser results are recorded below as this pass progresses.

Delivered `5454d314`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/J87KaqLjGyMrEeFsE3A6XfgNt1JP). All 33 focused tests passed. The deployed video journey passed initial play, eight rapid forward/back transitions, hidden/visible state, and leaving TV: at most one player and three sources, zero sources after exit.

## Step 2 — correctly sized TV avatars

The baseline showed 44 × 44 CSS-pixel TV avatars downloading 480 × 480 images. The TV serializer discarded the responsive candidate list already calculated by the image helper. The live card now uses that list with a 48-pixel size hint and reserved dimensions. Its existing image, crop, lazy loading and error fallback remain unchanged. No additional database calls or image pipeline changes were added.

Three real source probes totaled 86,846 bytes at 480 pixels, 8,887 bytes at 96 pixels, and 17,489 bytes at 160 pixels. That is 89.8% less sampled avatar payload at 2× and 79.9% less at 3×; it is not a whole-feed bandwidth claim. The original candidates remain available for larger pixel densities. Extra API metadata compresses repeated URL prefixes; it avoids another request for image metadata.

All 38 focused avatar, image, TV card, TV feature and shell-version tests passed, with focused lint. Two existing card-label assertions still expected the old “Club Deal” label; they now check the already-deployed “Free Entry” text. No product copy or behavior was changed to satisfy those assertions.

The poster probe did not justify a transformation change: the existing 640-pixel WebP poster sources were already compact, and transformed responses sometimes increased bytes and latency. Those sources and neighboring preview behavior are retained.

Delivered `5f02a925`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/HowK4MTGgTqdradscJuDkGk4u2cZ). A deployed Chromium mobile sample confirmed the 96-pixel candidates with the same 44-pixel displayed geometry and no uncaught errors. The single timing sample is not used to claim an LCP improvement.

## Final verification corrections

The one complete automated run exercised 9,486 tests: 9,465 passed and 21 exposed existing release mismatches. Focused rechecks resolved all failing cases. Most assertions described older Free Entry/travel copy, poster handling, signed Storage delivery or caching; they now assert the current behavior, including private/no-store media and anonymous RLS checks. No assertion was skipped and no production business behavior was reverted to satisfy an older test.

Two small production corrections were justified during that investigation:

- `venueCard` referenced an undefined `railQrMarkup` instead of its already-prepared `directionsMarkup`. A new executable renderer test reproduced the `ReferenceError`. The one-line fix preserves entry, directions and pickup actions.
- The media preview signer read server secrets without Next's `server-only` build boundary. It now has that marker and is included in the client-import boundary inventory. Native Node tests resolve only this marker to Next's own empty server implementation; the actual signer, visibility handler and image serializer still execute.

The affected final test groups passed (133 initial focused passes, then all 36 card tests after the remaining corrections, plus 30 media/import-boundary checks; groups overlap). Route type generation, whole-project TypeScript and lint, migration validation, the single final production build, public-build scanning and the non-mutating postbuild check passed. Production styling, dependencies and database policies have no diff in this pass.

Delivered `43511936`; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/7XDAPbMDNo1vF2Syh3DzpLDmMjSM). The full suite was run once; after investigating its failures, only affected groups were rerun. The local production build and bundle inventory were made at this revision.

## Final production verification

A separate venue-detail change, `1e471ab3`, landed after the local build. It was preserved. The final browser pass waited for its [successful deployment](https://vercel.com/ai-movie-jobs/shiftstage/Af1eLyyQ4tju4TMoCJARQr78Biq4) and verified that the live shell and script exactly matched the working tree before measurement. No timed browser run overlapped this pass's build or automated tests. The later change's venue styling is not part of this performance pass.

Three cold cellular samples per path used the same Chromium settings as the baseline:

| Path | Median LCP | Median CLS | Initial requests |
| --- | ---: | ---: | ---: |
| Home | 1,468 ms | 0.006 | 43 |
| Working Now | 1,432 ms | 0.007 | 36 |
| Venues | 1,464 ms | <0.001 | 42 |
| Dancer profile | 1,896 ms | 0 | 34 |
| TV | 3,892 ms | 0 | 42 |

All 15 samples had zero uncaught runtime errors or critical request failures. Homepage LCP is effectively unchanged from the 1,448 ms baseline. TV LCP was 4,108 ms before and 3,892 ms afterward; median video load-to-first-play was 1,853 ms before and 1,641 ms afterward. Three samples and variable origin/host conditions are insufficient to attribute these small timing differences to this patch. The reliable measured gains are the avoided abandoned requests and smaller avatar payloads, not a claimed whole-page speedup. TV video quality was unchanged, with zero reported dropped frames in these samples.

The existing five-second scrolling sample recorded 0–0.733% of frames over 50 ms across the five paths. Initial long tasks remain (up to a 388 ms route median), and the homepage filter interaction proxy was 456 ms under 4× CPU slowdown; this is not field INP. These are remaining shared-shell costs, not evidence that all interactions are now instantaneous.

Final checks passed:

- Android cellular and slower Android emulation, plus the desktop WebKit engine with iPhone portrait and landscape viewport/UA: profile video playback, touch close, Now/Upcoming/All filters, venue navigation/back, authentication forms without submission, rapid video scrolling, and exit cleanup. Actual window errors and unhandled rejections were empty. Expected cancelled navigation/media requests remain recorded in the raw diagnostics.
- Video lifecycle: one playing video maximum, three attached sources maximum across eight rapid forward/back transitions, zero playing when hidden, resumed playback when visible, and zero sources on leaving TV.
- Responsive hero images at 393 px/2×, 390 px/3× and 1440 px/2×: one selected image request per viewport and immutable versioned caching. Deployed TV avatars used 96-pixel candidates for the same 44-pixel display size.
- Cache-enabled repeat visits: homepage network transfer was 940,619 bytes cold and 329,573 warm, with 26 requests served from cache. Profile transfer was 339,910 on first visit and 126,898 on repeat, with 22 cache hits on repeat; its first visit shared the homepage's already-warmed common assets. These verify existing caching, not improvements introduced by this patch. Protected media remains private/no-store.
- All 15 public-document checks and four anonymous private-API denials passed. Health endpoints returned 200 and protected customer access returned 401 with no-store.
- Desktop at 1440 × 1000: home, 14 dancer cards, 17 venue cards and the profile grid rendered with loaded visible images, no horizontal overflow, no runtime errors, and no HTTP responses at or above 400. Console inspection found only the harness's service-worker-blocking warnings. Fully loaded desktop cards and mobile feed/profile screenshots were visually inspected.

Raw JSON, logs and screenshots are retained locally under `.next-perceived-speed-20260912/final`; the baseline and step-specific probes are alongside that directory. Browser journeys used the production demo catalog and suppressed writes. They do not establish behavior for hundreds of real records, authenticated production accounts, physical phones, service-worker lifecycle, or field Core Web Vitals. No full audit or full build was repeated for the final documentation-only commit.

## Files and components changed

- `src/lib/dancr/media-delivery.ts`: cancel obsolete photo/video authorization and delivery work.
- `src/lib/dancr/tv.ts`: preserve the existing responsive avatar candidate list in TV responses.
- `outputs/index.html`: apply responsive TV avatar attributes before `src`; correct the undefined venue-card Directions markup reference.
- `src/lib/dancr/media-delivery-url.ts`: enforce the server-only boundary for the existing media signer.
- `src/generated/live-shell-version.ts` and `src/generated/live-shell-script-version.mjs`: regenerate delivery fingerprints.
- Tests: add cancellation and TV-avatar behavioral coverage; reproduce the venue renderer failure; update affected release/privacy assertions and the narrow native-Node server-marker helper. No dependencies or migrations were added.

## Remaining scope review

The main lists use the existing HTML shell; adding React memoization would not address their rendering. Content keys preserve identical dancer/venue DOM, frame-scheduled/passive handlers handle scrolling, profile grids load in batches, and Supabase parent/relationship reads have limits. Discovery enrichments and metrics use existing parallel/batched reads. Profile intent prefetch remains limited to four metadata entries with a short lifetime; venue details reuse discovery data and return navigation restores screen position. Heavy dashboard tools already use dynamic imports.

No additional small, measured bottleneck justified changing these paths. Protected media and visibility metadata retain their current private/no-store policies; city metadata, versioned assets and venue artwork retain their existing caching. Existing high source bitrates, per-request authorization latency, and the large shared shell/CSS remain limitations. Adaptive bitrate renditions and deeper shell splitting require separate measurement and architecture work; neither is introduced here. Physical-phone testing and field INP remain outside the available lab environment.
