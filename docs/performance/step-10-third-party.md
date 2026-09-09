# Step 10 — defer server SDK work outside ordinary video reads

Step 9 finished at `25f63e9194caa7bf2fd91cdb6d48bbed5fcaa3d1` with Vercel success, 2,806 passing tests/checks, deployed CSS equivalence, playback/resource limits, three dashboard roles and health checks. The retained change is lossless inline CSS compaction. Median home LCP/FCP improved from 1,372 to 1,216 ms and venues from 1,396 to 1,208 ms; transfers fell from 927,264 to 911,818 bytes and 715,581 to 699,309 bytes respectively, with original request counts. TV timings remained variable (LCP 3,480 to 3,676 ms with higher TTFB); no universal paint improvement is claimed. External CSS delivery and its preload were tested and rejected. All four Step 9 release hashes and exact deployment results are in its delivery archive.

## Audit and baseline

Nine recent public mobile traces contain **zero third-party JavaScript requests**. Google Fonts is CSS/font delivery, already audited in Step 9. OneSignal loads asynchronously only after explicit push enablement and granted permission; native unsubscribe avoids reloading its SDK. Stripe remains a required server payment/webhook integration, QR scanning belongs to its on-demand workflow, and analytics uses the application's existing requests. These integrations are preserved.

The built public TV route nevertheless loads a server chunk containing the OpenAI SDK through shared moderation/identity modules. Five fresh Node import-only samples measured 587,486 loaded server JavaScript bytes, one SDK-containing chunk, median 186.6 ms import time and about 8.9 MB retained heap above the process baseline. Discovery/profile controls contain no OpenAI SDK marker. No handlers, provider calls, credentials or production data are invoked in this measurement; it is not production API latency.

## Change

Move SDK loading behind a small server-only asynchronous client factory used by image moderation, video moderation, media identity review and avatar crop review. The native module cache reuses the SDK module; each operation still receives its own client and original options. Required credential/input checks still execute before construction. Keep all models, prompts, review gates, request timeouts/retries, error propagation and publication rules unchanged.

Tests verify that importing the factory does not load the SDK, operation-specific options/client instances remain isolated, and module/constructor failures reject without an approval fallback. Existing moderation, identity and security tests remain in the complete validation suite. The built-route import measurement is repeated after build, then public API/media, playback, dashboard and health checks run on the exact successful deployment. No browser dependency, new provider, paid service or client-side delay is introduced.

## Build verification

All 2,809 tests, TypeScript, lint, migration guard and production build passed before integrating the concurrent rate-limit security release. The rebuilt TV route loads 488,823 bytes instead of 587,486 (98,663 fewer, 16.8%), with zero OpenAI SDK-containing initial chunks. Discovery and profile controls retain exactly their original loaded bytes. Median retained heap in the TV import sample fell from 8,916,936 to 8,576,552 bytes. Import timing increased in both changed and unchanged routes during this session; these runs establish a reduction in loaded code, not a production latency improvement. Full checks are repeated after preserving upstream changes, and deployment results are recorded in the step delivery archive.
