# Adaptive playback and shared-shell follow-up

This pass implements the requested adaptive streaming and deeper code splitting, then fixes the slow scrolling reported after the initial HLS deployment. The existing UI, public visibility checks, private Storage bucket, original MP4s and full-resolution playback option remain intact. Raw measurements are saved locally in the ignored `.next-adaptive-20260912` directory.

## Playback regression and correction

The first HLS integration released every offscreen adaptive player. Every swipe therefore fetched a fresh master playlist, variant playlist, initialization range and first media segment. Returning to a clip also lost its buffer. The existing three-second warmup threshold was designed for large progressive downloads; applying it to small adaptive segments delayed preparation too far. MSE buffer appends also needed an explicit readiness notification. Promoting a preload with another `startLoad()` could abort and repeat an almost-finished segment.

The corrected TV and profile players retain the adjacent source window, prepare one low-rendition segment at a time once the active clip has 1.5 seconds buffered, and reuse the same element and in-flight request when it becomes active. Progressive media keeps its three-second margin. There is at most one playing video and three attached sources. Distant/hidden players release resources, manual pauses survive fallback, and Safari receives serialized native preload hints. No brightness or opacity styling was changed: the captured long poster-to-video wait was removed for prepared cards.

The reproducible read-only journey is `scripts/performance/video-scroll-startup.mjs`: Chromium/Edge with Pixel 5 emulation, 4 Mbps download, 100 ms latency, six forward/backward swipes and 2.5 seconds viewing between swipes. It is a desktop lab, not a physical Android measurement.

| Measurement | Before correction | Corrected local source | Deployed correction |
| --- | ---: | ---: | ---: |
| Median swipe-to-presented-frame | 2,524 ms | 229 ms | 242 ms |
| Observed range | 2,080–2,918 ms | 95–267 ms | 56–2,236 ms |
| Prepared incoming cards | 0 of 6 | 6 of 6 | 5 of 6 |

Five deployed swipes started in 56–275 ms. One farther backward revisit was cold because the current clip had insufficient spare buffer and its old player was outside the retained window; it took 2.24 seconds. Very fast scrolling, cold clips and constrained connections can still require loading. The first baseline swipe includes screenshot capture; excluding it still gives a 2,461 ms baseline median versus a 245 ms deployed median.

## Adaptive delivery

- `adaptive-video-encoder.ts`, `adaptive-video-manifest.ts`, `adaptive-video-codecs.ts` and `adaptive-video-worker.ts` generate aligned, two-second fMP4 byte-range renditions: 360 short-edge, 720 where applicable, and the source dimensions at CRF 18. The original published MP4 is unchanged and remains the fallback. Generated codec information follows [Apple's HLS authoring requirement](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/) rather than guessing the AVC level.
- `media-delivery.ts` checks current public RLS visibility and active ownership before serving manifests or media ranges. Rendition paths are derived from a validated generation and source path. No Storage credentials or signed object URLs are sent to the player; delivery remains private/no-store. Deletion includes validated renditions.
- `public/adaptive-video.mjs`, the shell in `outputs/index.html`, and `DancerPhotoCarousel.tsx` provide native Safari HLS, demand-loaded HLS.js for supported MSE browsers, bounded neighboring preparation, playback cleanup and MP4 recovery.
- `adaptive-video-background.ts` prepares renditions after approved dancer uploads, admin reviews/retries and approved imports. Work has independent bounded deadlines and verified upload/database receipts. Existing cron recovery handles at most two missing renditions per run. No database migration, RLS change, new cron or hosting service was added.
- All 12 clips in the current Las Vegas public TV feed were prepared, including the four profile-visible clips on `lvdegen11`. Their codec metadata was repaired using only small initialization ranges. `scripts/prepare-adaptive-videos.mjs` supports bounded, explicit `--apply` preparation and `--repair-codecs`; otherwise it is a dry run.

For the original 15-second test clip, the published MP4 was 10,319,504 bytes; the 360 rendition is 1,633,646 bytes (84% smaller), and 720 is 5,032,175 bytes (51% smaller). In the controlled nominal 1.5 Mbps test, progressive playback had four post-start waits and transferred 2,981,888 media bytes in 18 seconds while advancing only 3.87 seconds. Adaptive playback had zero post-start waits and transferred 1,682,798 bytes. Its initial first frame was slower (2.40 versus 1.68 seconds); this is a buffering improvement, not a universal startup win. The corrected fast-link fixture selected the full-resolution rung with zero post-start waits. That single-clip comparison did not detect the scrolling regression; the separate swipe journey now covers it.

## Shared script

`split-live-shell-script.mjs` extracts 21 reviewed TV-only functions at build time. The generated classic chunk preserves existing global bindings and synchronous card behavior. `loadHomeTvFeed()` requests code alongside data, waits for both, ignores obsolete results, and offers a user-initiated reload if a chunk is unavailable. The route accepts only its current content version. Build-time dependency checks reject new callers outside the loading boundary.

The main script is now **791,175 bytes / 188,844 gzip**, versus **811,238 / 193,779** immediately before splitting. The separate TV chunk is **21,387 / 6,258 gzip**. HLS.js is **371,222 / 116,030 gzip** and loads only for adaptive playback; the small controller is **7,757 / 2,435 gzip**. A real-browser journey verified that home, Working Now and venues request neither the TV chunk nor HLS engine, and revisiting TV reuses its loaded chunk.

## Validation and delivery

Individual steps passed focused encoder, manifest, delivery/visibility, cleanup, client, upload/moderation, shell and playback checks before commit/push. Real FFmpeg fixtures cover audio and silent clips, aligned segments, exact bytes and full decoding. The final complete suite ran once: 9,533 passed, with 10 failures in older fixtures expecting direct `video.play()`, the former monolithic output, or missing newly extracted helper dependencies. Those fixtures were corrected; all 68 targeted follow-up checks passed. The scrolling correction then passed 32 focused tests, TypeScript, lint and the 13-phase real-browser lifecycle. An additional 11 checks passed for serialized native Safari warmup and asset hashes.

The final production build, public-build scanner and guarded postbuild completed successfully on Node 24.21.0 after the scrolling correction. The build was repeated only because the user reported that new playback regression during final verification. Live health and private anonymous-access checks passed; deployed shell bytes match the validated output. Live routed profile playback, background pause/resume, preserved manual pause, and detached-player cleanup passed with an explicit adaptive-source assertion.

All four final mobile journeys passed: Android cellular (4× CPU/4 Mbps), slow Android (6× CPU/1.6 Mbps), and desktop WebKit with iPhone portrait/landscape dimensions. They covered profile video and close controls, Working Now/Upcoming/All filters, venue pages, back navigation, login/signup controls without submission, rapid TV scrolling and exit cleanup. Android recorded no browser console errors; all cases recorded no window errors or unhandled rejections. WebKit logged its unsupported `interactive-widget` viewport warning and a cities-fetch message correlated with canceled requests during navigation. Those diagnostics are retained in the evidence rather than presented as zero console output. The deployed TV chunk's bytes/cache policy, obsolete-version rejection and three codec-declared adaptive levels also passed verification.

Implementation commits: `84f446bc` (renditions/delivery), `fbf6c0e6` (players), `9ade4aee` (approval/recovery), `5d639523` (shell split), and `e016f430` (scrolling/compatibility correction). Each was pushed to `origin/main` and reached Vercel success. The correction deployment is [available here](https://vercel.com/ai-movie-jobs/shiftstage/7s4XhJhdHiHAna7z2VQSxTGwM9vQ).

## Remaining limits and follow-ups

- Physical iPhone Safari and Android hardware were not available. Desktop WebKit has no native HLS support in this environment, so its media journey exercises fallback; unit coverage verifies native HLS selection and serialized preload behavior. It cannot certify physical Safari decoding or cellular behavior.
- Fresh private authorization and Storage proxy latency remain on every media range. Reducing that latency further needs a separately reviewed authenticated edge-delivery design that preserves visibility and revocation guarantees.
- Serverless transcoding is bounded but still consumes CPU and Storage. The full-resolution rendition may be larger than the original. A durable encoding queue, resumable historical backfill and generation cleanup are appropriate infrastructure work if volume grows; current public-feed preparation does not mean the entire historical catalog was converted.
- Most legacy dashboard/editor code and the large inline stylesheet remain shared. Further separation requires explicit entry-point boundaries and broader UI regression coverage. This pass does not claim a large initial-paint improvement from the approximately 20 KB script reduction.
