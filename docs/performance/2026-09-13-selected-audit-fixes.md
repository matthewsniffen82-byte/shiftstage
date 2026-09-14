# Selected speed audit fixes: 1, 2, 4 and 5

This follows the five-item chat recommendation, not the older 15-step audit.
Item 3 (hidden login photos and speculative homepage TV downloads) is excluded.
The existing mobile video representations and next/previous preload policy stay in place.

## Changes

1. TV creates the first three complete cards immediately, reserving every remaining
   scroll slot. It activates the first player before filling one further card per
   animation frame/task. A jump prepares the selected card and its two neighbors
   on each side synchronously. Obsolete work stops after a feed/tab change or when
   the document becomes hidden. Playback, profile ownership and pause rules remain
   in the existing player controller.
2. The custom homepage serves a compact, versioned copy of its shared aesthetic
   stylesheet. CSS parsing verifies identical selectors, values and cascade order.
   Next pages load the four profile stylesheets in dancer/dashboard layouts instead
   of globally; the dashboard downloads the crop editor on first use, with shared
   concurrent loading, cancellation checks and retry after failure. The preceding
   upstream release had already externalized homepage styles and split dashboard
   workspaces; those changes are preserved.
4. The TV feed reuses avatar paths from its original eligible-profile join, removing
   one repeated profile query. Private paths are stripped from the serialized feed.
   The existing bounded small-image cache also handles TV posters, after fresh
   visibility, active-owner and poster-identity checks on every request. Preview,
   range and actual video requests bypass this cache. Browsers/CDNs still receive
   private/no-store media responses. TV and media responses expose numeric server
   timings for diagnosis.
5. Lab accounting separates completed non-media wire bytes, received media payload,
   and completed media wire bytes. Unfinished/cancelled media never uses accumulated
   CDP encoded chunks as a transfer total. Old mixed totals are intentionally absent
   from the updated summary. Mobile lab requests now use an Android user agent so
   they exercise the deployed mobile-video selection.

## Controlled measurements

Three alternating before/after runs used the same 22-video API fixture and Chromium
with a Pixel 5 viewport and 4× CPU slowdown. The baseline source was `e830a998`.
These isolate TV setup work; they are not production load-time or field-vitals results.

| Measurement | Before median | After median |
| --- | ---: | ---: |
| First ready-feed render | 434 ms | 212 ms |
| First player start request after render begins | 506 ms | 105 ms |
| Complete video elements after initial render | 22 | 3 |

All 22 scroll slots retained the same 663 px height. A jump to card 18 kept one
playing video and five prepared sources. The normal forward/backward sequence kept
three to five sources and never overlapped playback.

The compact theme is 444,447 bytes instead of 485,855 bytes (41,408 fewer uncompressed
bytes). Moving the four profile styles removes 33,901 source bytes from unrelated
Next page imports; the crop editor is 10,089 source bytes and loads on demand.
These are source/delivered-text sizes, not claims about compressed network savings.

## Anonymous field samples

`public/mydancr-performance.js` samples 1% of document visits and flushes at most once,
on first hiding/page exit. It respects GPC/DNT, skips automated browsers, and uses
`fetch` with `credentials: omit`. No storage, cookies, account IDs, IP addresses,
profile names, page URLs or query strings are collected by the script.

The same-origin `/api/public/performance` receiver accepts at most 2 KB with a
three-second body deadline. It validates coarse route/device enums, a release SHA
and finite bounded numeric metrics, strips all other fields and writes
`performance.sample` JSON to Vercel runtime logs. There is a best-effort ceiling of
120 accepted requests per minute per warm function instance; no database write or
new analytics service is involved. This is untrusted observational data, never an
authorization or billing signal.

Filter Vercel runtime logs for `performance.sample`, then group by `release`,
entry `route` and `device`. Metrics are `lcpMs`, session-window `cls`,
`interactionMaxMs`, `tvFirstPlayMs` and `tvRebuffers`. Missing means unmeasured.
`interactionMaxMs` is a sampled interaction maximum, **not INP**. TV first play is
measured from document navigation, including time spent on the homepage before TV;
compare direct-TV entry samples separately. Rebuffers count waiting events only
after that active player has played once. Small samples and browser support limit
interpretation; these logs are not a complete web-vitals analytics dashboard.

Media `Server-Timing` exposes `authorize`, `storage` and `image_cache` hit/miss/bypass;
the TV API exposes total `tv` duration. No paths, credentials or provider errors are
included in these headers. A cache hit still includes a fresh authorization duration.

## Validation

Focused tests cover progressive rendering, rapid reversals, manual pause, unchanged
neighbor buffering, feature loading, recovery, media authorization/cancellation,
poster cache bypass and revocation, avatar fallback/path stripping, lossless CSS,
crop-editor loading/cancellation, byte accounting and bounded anonymous reports.
All 167 focused checks passed. The production build compiled and passed its
lint/type checks and public-build security check. Real Chromium forward/backward/
jump and nine-phase feed/profile playback handoffs passed. The same nine phases
passed in WebKit with the local generated scripts over the production HTTPS
origin; the initial HTTP-localhost WebKit run encountered TLS upgrade errors.
