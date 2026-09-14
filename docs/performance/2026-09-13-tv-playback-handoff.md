# TV playback handoff, September 13, 2026

The TV observer waited for 72% card visibility, or for the outgoing card to fall
below 25%, before starting the next player. Because the feed reserves viewport
space for navigation, that delayed activation even when the incoming card was
already the most visible card. Playback now hands over at 50% visibility. The
browser receives a matching observer threshold. Forward and backward swipes use
the same rule, with the existing one-player activation and profile-overlay guard.

A controlled one-second continuous scroll on the production page, using a Pixel
5 viewport, 4 Mbps download, 100 ms latency and 4x CPU slowdown, measured four
forward/backward handoffs. Delay from the incoming card becoming most visible to
activation fell from 215–297 ms to 130–170 ms. This is a browser simulation, not a
physical-phone measurement or a guarantee of network startup time.

The diagnostic also found clips with only 0.3–0.6 seconds buffered and continuation
requests taking roughly 0.6–1.3 seconds to return headers. Starting playback sooner
gives those requests a head start. It does not remove bandwidth-dependent stalls.
Same-position and ahead-seek preload experiments did not consistently help and
were not applied. No seek, extra offscreen playback, forced reload, rendition,
encoding, security, preload-window, or scroll-snap changes are included.

Focused checks cover early handoff in both directions, small partial scrolls,
viewport exit/re-entry, page suspension, profile-overlay ownership, and preservation
of the current/adjacent/second-adjacent loading window. Real native-player checks
cover Chromium and WebKit using the existing TV and profile journeys.

The top-card autoplay follow-up reproduced a separate resume failure in both
Chromium and WebKit: a loaded current video paused when layout moved it out of
view, then stayed paused at 35% visibility because that was below the handoff
threshold. An automatic viewport pause now resumes the same current player once
it is more than 25% visible. Manual pauses remain paused; new-card selection still
uses the 50% threshold. The correction preserves playback position and buffers.
