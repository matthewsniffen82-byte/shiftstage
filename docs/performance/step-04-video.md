# Step 4 — video playback and resource use

Step 3 was pushed as `8e12a9e95778a6889d1baa729aec71dd4dd86fe5` and deployed successfully. Its matched samples reduced total transfer from 1,115,196 to 925,463 bytes on home, 363,378 to 312,472 on the dancer profile and 899,397 to 713,866 in the venue feed. Profile LCP improved from 2,680 to 2,324 ms; home/venue paint times increased by 208/172 ms in the sample while pre-paint long tasks varied. No universal timing improvement is claimed. Home CLS fell from .028 to .006; the other two routes remained zero. No JavaScript errors or critical failed requests occurred. The delivery archive records all measurements and the live source check.

## Pipeline audit and baseline

The live TV destination is the home-shell feed; `/tv` redirects there. `TvFeedClient` and `TvVideoStrip` currently have no production imports and are retained without speculative rewrites. The active production players are the home feed, the shell profile viewer, and the routed React profile carousel. Existing players use inline muted autoplay, posters, stable elements, bounded source windows, pause on active-card changes, and source removal for distant cards. The upload pipeline already creates H.264/AAC MP4 with `+faststart`, retains originals, moderates/watermarks media and generates posters. Three current bounded Storage probes verified actual 206 range responses and moov-before-mdat. Reimplementing fast-start or introducing HLS infrastructure would not address the measured eager-download issue.

Nine current cold mobile runs (three per network/CPU profile) are in `step-04-before.json`. Wi-Fi transferred a median 14,565,328 bytes by the initial cutoff, cellular 3,146,678, and slow cellular 1,541,205. Recorded first-playing-video startup was 540 / 2,069 / 5,167 ms respectively. On slow runs, the initial card had not started within the observation window; the first recorded playback was a later card reached during scrolling. Do not interpret that last metric as successful initial-card startup.

The resource journey found 22 assigned posters immediately, even though just two video sources were attached. The next video was given `preload="auto"` as soon as the active video had a decoded frame, allowing its entire file to compete with playback. Before that, its metadata request already competed with startup. A simulated hidden-page event left one video playing and both sources attached. Rapid scroll and leaving-TV checks otherwise preserved a single playing video and released distant/removed sources.

## Changes and preserved behavior

- Give the active clip exclusive startup bandwidth. Only after its first frame is ready, warm **metadata for one next clip**. Retain an already-loaded previous element for back scrolling and release everything farther away. Data Saver and 2G continue to allow only the active source. Browser preload is a hint, so transferred bytes are measured rather than assuming a byte cap.
- Assign home-feed posters only to the active/adjacent window (two initially, at most three), while preserving the metadata and loading artwork for later cards. Reuse the video elements and warmed sources through ordinary updates.
- Retain observer visibility ratios across callbacks so a rapid backward jump can select the visible card even below the normal snap threshold when the old card has left view. Pause a feed outside the viewport; autoplay recovery respects that state. A pre-change journey captured the previous offscreen clip still playing after one backward jump. The recovery asset version is advanced so existing browsers receive the fix.
- Pause production home/profile playback when the page becomes hidden or enters pagehide. Release neighbors, retain the active position, and resume only a previously playing, still-connected active card. Manual pauses remain paused. Profile playback takes priority over the underlying feed. React visibility listeners are removed on viewer changes/unmount.
- Keep codec/quality, media URLs, signed access, moderation, watermarking, analytics events, sound preference, autoplay recovery, swipe controls, reports, likes and all visual styles intact.

## Verification and remaining limits

Policy tests cover 30-card windows, rapid index jumps, Data Saver, no repeat source assignment, and previous-buffer reuse. Visibility tests cover repeated hidden/pagehide events, manual pause, detached/inactive cards and profile priority. All 2,102 automated tests, TypeScript, lint, migration guard and production build passed. Local production browser checks kept two initial/at most three posters, one playing clip, one paused active source while hidden, and no sources after leaving TV; all three dashboard role smoke checks passed. Mobile startup/transfer and the routed profile playback journey are repeated after deployment.

The first scroll probe sampled geometry on a timer before a queued IntersectionObserver callback had necessarily run. The refined before/after probe waits two paint opportunities after each jump; both versions then passed the basic offscreen check. The stricter observer unit test additionally covers a partially visible replacement and scrolling entirely outside the feed. Do not claim the initial transient observation proves prolonged background playback during every scroll. The hidden-page issue was reproduced in both baseline journeys.

Visibility events in the automated resource journey are simulated and explicitly labeled; they do not claim physical-phone background behavior. Browser preload heuristics vary. The sampled 1080 × 1920 source files remain 3.3–10.3 MB for roughly 10–15 seconds, with the largest exceeding a 4 Mbps connection's sustainable rate. An adaptive rendition ladder or a separately reviewed lower-bitrate delivery derivative could improve that case. This pass does not rewrite existing media, silently reduce quality, add a paid service, or create a new transcoding job. Source bitrate remains a documented infrastructure/delivery follow-up.

## Deployed results

Implementation commit `78067bf7b2895f4b8068860b4d0ccc18ac15a0a3` was pushed and [Vercel succeeded](https://vercel.com/ai-movie-jobs/shiftstage/FaJDnCj1UZyRCGFvBhPxgUE5PQoP). Live health, Supabase health, exact deployed shell/source matching and anonymous private-data rejection passed. The public profile smoke test was corrected to select `profile_and_feed` media; feed-only clips correctly do not appear on profiles. The final journey passed playback, hidden pause, same-player resume, manual-pause preservation and keyboard close cleanup. The unrelated mobile pointer-close overlap is recorded in `known-issues.md`.

Three cold runs per network profile are recorded in `step-04-after.json`. All used the same optimized shell. Public feed rotation and server/network variability remain limits on timing comparisons.

| Network | Initial bytes before → after | Requests before → after | First playing video startup before → after | LCP before → after |
| --- | --- | --- | --- | --- |
| Wi-Fi | 14,565,328 → 10,237,983 (−29.7%) | 57 → 37 | 540 → 378 ms | 1,128 → 1,236 ms |
| Cellular | 3,146,678 → 2,931,811 (−6.8%) | 56 → 37 | 2,069 → 912 ms | 3,368 → 3,480 ms |
| Slow cellular | 1,541,205 → 1,537,042 (−0.3%) | 57 → 36 | See note below | 8,780 → 6,936 ms |

On slow cellular the first card started in **3/3 optimized runs versus 0/3 baseline runs** within the observation window. Its optimized median load-to-play was 1,504 ms; baseline's 5,167 ms summary came from a later card, so these are not a matched first-card timing comparison. Cellular first-card startup fell 55.9%, and navigation-to-first-play fell from 5,318 to 4,378 ms. Waiting-event medians stayed 1 on Wi-Fi and 7 on cellular; slow waiting events increased from 4 to 6 while actual first-card playback became possible. Zero sampled dropped frames, JavaScript errors or critical failed requests were recorded. No claim of eliminated buffering is made.

Live resource checks confirmed at most three attached sources/posters, one playing clip, only one paused retained source when hidden, and zero sources after leaving TV. The first-run Wi-Fi CLS outlier was .343; median was zero (also zero before). Cellular median CLS became zero and slow remained .005. Paint variability and the source bitrate limitation remain for later passes.
