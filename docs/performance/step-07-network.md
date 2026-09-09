# Step 7 — cancel obsolete public video requests

Step 6 was pushed as `d62c04e52de86c22d3e7ed0ee1713cfafd47d9a6` and [Vercel succeeded](https://vercel.com/ai-movie-jobs/shiftstage/81P2nPTKPvYNjcobK4E51ngrjAta). Live health, all three dashboard role fixtures, public playback/resource checks and anonymous owner/admin video endpoint rejection passed. Twelve public API samples returned 200 and all three media prefixes returned 206. The private loader request-count improvement was verified with the actual loaders against SDK fixtures; no private production latency claim is made.

## Audit and baseline

The earlier path-only network summaries grouped calls to `/api/public/tv` without their query parameters. A focused trace establishes that the directory calls are **scoped profile-video metadata prefetches**, not citywide feed or video-file downloads. Six filter transitions/profile opening produced two successful scoped requests (one empty 85-byte response, one three-video 6,129-byte response), with the opening reusing prepared data. The existing four-entry, 20-second cache, connection-aware warmup, demand-load reuse and failed-request eviction are useful and remain unchanged. Removing them would risk slowing profile opening for little transfer benefit.

The shared public JSON transport already has a body-inclusive timeout and bounded retries; discovery refreshes avoid duplicate private-account loads and use request state to reject stale results. TV loading also rejected old responses, but did not stop the underlying request on a city/venue/video change or when leaving TV. An instrumented stalled-network baseline executing the actual transport/loader left **two requests active after changing scope and both still active after leaving TV**. They could consume bandwidth until completion/deadline despite no longer being useful.

## Change

- Give each active TV metadata load an AbortController. Cancel its predecessor when scope changes and cancel a pending load when leaving TV. Clear the pending scope so returning can request current data.
- Preserve completed scoped data and the current in-flight request when TV is reselected; do not introduce duplicate loads for an unchanged destination.
- Support an optional caller signal in the existing JSON transport. Cancellation interrupts headers, stalled body parsing and retry delay, without retrying the abandoned request. Remove listeners and both timeout/backoff timers on every settled attempt. Existing deadline, transient-error retry and non-retryable error behavior remains covered.
- Preserve profile prefetches, credentials, public/private cache policy, response validation, analytics and all UI/route behavior.

The same stalled-network fixture now leaves **one current request after scope change and zero after leaving**, with both obsolete requests aborted. Regression cases cover latest-response isolation, return navigation, completed-cache preservation, same-TV reselect, pre-aborted calls, body stalls, retry cancellation and cleanup. The deployed browser journey additionally holds one public request, leaves TV, verifies an abort and returns to actual public playback. All API writes in browser checks are suppressed.

All 2,313 automated tests, TypeScript, lint, migration guard and the production build passed before commit. These are cancellation/resource improvements under changed navigation, not a claim of faster ordinary API responses or lower initial page weight. Public API probes and normal profile/video journeys are repeated after deployment. No server caching, private-data reuse, database policy, paid infrastructure or visible redesign is introduced.
