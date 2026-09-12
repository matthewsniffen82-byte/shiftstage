# MyDancr TV unavailable after browser verification

The reported mobile session stayed on “Unavailable” after Retry and recovered
after a hard refresh. Its original network response was not captured, so the
initial trigger cannot be proved from the screenshot alone.

Contemporaneous deployment evidence recorded Vercel Security Checkpoint 403
responses and `x-vercel-mitigated: challenge`. The Vercel console showed an
automatic system challenge beginning at 08:23 UTC on September 12, 2026. At
08:30 UTC, the deployment checks received 403 responses for documents and API
preflights. Five ordinary public TV requests made during this investigation
later returned 200 with 22 videos; further production probing was paused in
coordination with the deployment review.

[Vercel documents](https://vercel.com/docs/vercel-firewall/firewall-concepts#challenge)
that challenged API requests need a valid browser verification session. A
challenge delivered to `fetch()` cannot execute the browser check as a document.
The existing client reduced that response to a generic video outage, and Retry
repeated the API request. This reproduces the reported difference between Retry
and a full document refresh; it is the supported explanation, not a recovered
trace from the user's phone.

The repair recognizes only a 403 carrying Vercel's challenge marker. TV offers
“Reload MyDancr TV” with a browser-check explanation. Clicking it navigates to
the same origin, retaining the current city, venue, selected video and other URL
state. A fresh query value ensures the document is requested again. It does not
navigate automatically, execute challenge HTML from an API response, or change
Vercel settings.

Two additional recovery defects were reproduced and fixed:

- Ordinary Retry reused the same cached request, and the service worker replaced
  explicit cache modes with `default`. Manual retry now requests a fresh URL with
  `no-store`; automatic retry uses `no-store`. The worker preserves request cache
  intent while still enforcing `no-store` on private document navigation.
- Loading and error messages replaced the video elements without clearing their
  render key. A recovered response containing the same video IDs could therefore
  leave the loading message on screen. Those replacements now clear the key.

The ten new runtime regressions produced seven failures and three passes against
`def7ef5f` and all pass with the repair. Existing loading, cancellation and cache
contracts remain covered. `scripts/performance/tv-recovery-smoke.mjs` exercises
the complete mobile homepage, a synthetic challenge/reload and a transient
failure/Retry through to real playback of a generated test clip. Every browser
request is fulfilled locally; this test neither contacts production nor attempts
to automate Vercel verification. Release validation and exact-commit deployment
verification remain separate required delivery checks.
