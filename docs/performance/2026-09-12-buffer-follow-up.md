# Playback buffer follow-up

This sequential pass starts at `9406af1e`, building on the existing audits and delivery fixes. It preserves the existing UI, media quality, protected/no-store delivery and data freshness. Raw local evidence is in the ignored `.next-speed-followup-20260912` directory.

## Step 1: give the playing video startup bandwidth

Two fresh production cellular samples (393 × 852, DPR 2, 4× CPU, 4 Mbps down, 100 ms latency) reproduced a remaining bottleneck: the next clip began downloading with only **0.47 and 0.55 seconds** buffered in the active clip. Each sample subsequently recorded two post-start waiting events. Existing first-frame readiness is insufficient evidence of bandwidth available for neighboring downloads. The recent neighboring-poster and backward-swipe fixes remain necessary.

Home TV, the shell profile viewer and the routed React profile viewer now wait for three seconds buffered ahead of the playhead, or the remaining duration of a shorter clip, before warming adjacent video sources. They use the contiguous range containing the playhead; a future seek range does not count. Progress events re-evaluate eligibility only when it changes. The React viewer updates media resources directly without new state updates. Listeners are removed on viewer changes/unmount. Existing source reuse, Data Saver, hidden-page suspension, manual pauses, eager nearby posters and both directions of warmup are retained.

A regression first failed against both production shell players with a decoded frame and half a second buffered. After the fix, 50 focused tests and focused lint passed, including resource windows, same-element reuse, rapid reversals, presentation and visibility. New coverage also checks short clips, seek gaps, 30 repeated progress events without redundant updates, and observer cleanup.

Two local-source cellular browser samples started the first clip without starting any neighboring video download during the nine-second observation window. Both still experienced buffering: the existing source bitrate remains a constraint. These are avoided competing downloads, not a claim of eliminated stalls or a controlled startup-time speedup. A separate unthrottled browser lifecycle passed initial play, eight rapid forward/backward scrolls with visible previews, hidden pause/resume and exit cleanup. At most one video played, no more than three sources were attached, and leaving TV released all sources.

The existing private media metadata was also sampled before considering narrower projections. Twelve rows were only 517–899 bytes each, so that change was not justified as a meaningful playback bottleneck. No database query, security rule or media encoding was changed.

Deployment and final cross-path verification are recorded below after completion.
