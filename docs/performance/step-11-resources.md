# Step 11 — bound temporary video metadata resources

Step 10 was pushed and deployed at `9cfa154ec8438e65b5df69fab55f99a01d7a7b84`, with exact-commit Vercel success, 2,859 passing tests, TypeScript, lint, build, migration guard, 12 healthy public API responses, three media range responses, three dashboard roles and normal video resource limits verified.

## Audit and baseline

Reviewed timers, global listeners, observers, upload object URLs, request cancellation and subscription paths across the shell, React profiles, dashboard tools and push client. Dashboard refresh intervals remove their visibility listeners; profile observers and playback handlers disconnect on teardown; upload queues revoke preview URLs on removal/unmount; push subscription listeners clean up in `finally`; bounded request helpers remove timers/listeners. No application-created realtime channel or camera stream was found in these client paths. Existing page-lifetime listeners and analytics state are preserved.

`memory-journey.mjs` uses weak video references and forced garbage collection across six public city-switch, rapid-scroll and TV exit/reentry cycles. Before changes, every empty-city and exit sample had zero retained video sources/players; exit listeners stayed at 280, and DOM nodes stabilized at 5,775 after the second cycle. Post-GC exit heap was 3.86 MB initially and 4.17 MB at cycle six; this short warm-up is not proof of a leak. Initial/final TV had 22 video elements, two sources and one player. A suspected missing cleanup during feed replacement did not reproduce as accumulating detached playback, so no speculative feed rewrite was made. The first runner attempt used an incorrect TV selector; its partial artifact is retained, and the complete baseline uses the actual bottom TV button.

Both local upload metadata readers did have an unbounded failure path: when a browser emitted neither `loadedmetadata` nor `error`, the promise stayed pending with one registered blob URL, a sourced temporary video and live handlers. Existing `finally` revoked the URL only after that promise settled, and did not explicitly reset the temporary player.

## Change and validation

Both readers now bound metadata decoding to 20 seconds and clear the timeout, event handlers, source and decoder before revoking the URL on success, invalid metadata, decode error or timeout. Existing MIME, size, duration and orientation validation is preserved. No source format, quality, moderation rule, upload payload, normal preview or public playback changes.

Six focused tests exercise both actual reader functions with controlled browser events. A no-event browser now rejects with a retryable message and zero retained URLs, timers, sources or handlers. Successful reads retain exactly the same dimensions/duration. Full tests, TypeScript, lint and production build run before release; the deployed weak-reference journey, playback, dashboard roles and health checks are then repeated. These are Chromium lab/resource checks, not proof of physical-device behavior or absence of every possible long-session leak. Full results and the exact release status are in the delivery archive.
