# Sequential perceived-speed follow-up

Baseline revision: `2216ecb4`. This pass builds on the existing performance work and preserves protected media access, styling, features and encoding quality. Each implementation step is validated, committed, pushed and checked for Vercel success before the next change.

## Baseline

The existing mobile harness ran three cold Chromium samples each for `/` and `/tv`: 393 × 852, DPR 2, 4× CPU slowdown, 4 Mbps down, 100 ms latency. Median homepage LCP was 1,448 ms; TV LCP was 4,108 ms. No uncaught browser errors occurred. Raw evidence is in the ignored `.next-perceived-speed-20260912/before` directory. These are emulated lab samples, not physical-device or field INP measurements. Video byte counters have the read-ahead limitation documented in the previous report.

## Step 1 — stop abandoned media work

The protected media handler attached its abort listener only after database authorization completed. A request cancelled during either video lookup still started a Storage download; an already-cancelled request performed two queries and fetched the video. Photo lookups had the same gap.

The handler now propagates cancellation through the installed Supabase SDK, checks cancellation between dependent reads, and disposes late Storage responses. Authorization order, RLS, private/no-store headers, range delivery and original media bytes are unchanged.

The reproducer failed four cancellation scenarios before the fix. Afterward, cancellation at either video lookup or the parallel photo checks starts **zero** Storage requests; a request cancelled before entry starts **zero** queries. These are deterministic avoided-request counts, not an asserted percentage improvement in page speed. Tests also cover cancelling an active stream and a transport returning late headers.

Validation: media cancellation, media privacy and Supabase response-budget tests; focused ESLint; diff inspection. Delivery and final browser results are recorded below as this pass progresses.
