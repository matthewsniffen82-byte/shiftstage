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
