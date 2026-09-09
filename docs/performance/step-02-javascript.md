# Step 2 — initial JavaScript

## Evidence and scope

Step 1 was pushed as `d93ecffe5808efa849fc09cc0f0cb428cd0b8c1e` and reached Vercel success. Its live source matched the validated build, health and Supabase checks passed, private saved data returned 401/no-store, and mobile samples had no JavaScript errors. The documentation-only release preserved application transfer cost. Profile timing varied (3.32–6.64 seconds LCP in the repeat samples), so the report makes no timing-improvement claim and retains image/render latency as an investigation target.

Step 2 starts from `c6431c6c81a40507bd1f4c385b1842dc871a01a9`, preserving subsequent database-audit documentation and profile social-icon/spacing changes. Before release it also incorporates `13676079` (venue Contact routing) and `43d851ba` (Next 15.5.24 / Sharp 0.35.4 security patches) and reruns complete validation with isolated dependencies. The customer, dancer and venue routes share a dashboard entry that eagerly imports video uploading, media management, shifts, NFC and venue-team tools. Only dancer video uploading imports the browser Supabase SDK in this dashboard directory. Customers do not use these tools.

The existing validated pre-change build listed 1,243,526 raw / 308,254 gzip bytes for each dashboard entry and shared chunks. Three fresh production cellular samples with synthetic empty customer responses measured median 340,539 transferred JavaScript bytes, 670,434 total bytes, 30 requests, 2,388 ms LCP, 1,756 ms FCP, and 0.001 CLS. The build measurement predates only the unrelated profile-spacing update; the browser baseline includes that update. Private response times in this fixture are not database measurements.

The final validation base additionally includes `df0b3126`, which consolidates the venue roster on another user's task. Its roster state/props and navigation are preserved. A new customer mobile baseline after the upstream security/roster releases measured 339,945 JavaScript bytes, 670,719 total bytes, 30 requests, 2,192 ms median LCP, 1,796 ms FCP and 0.001 CLS (`step-02-before.json`).

## Change

Seven role-specific tools use Next dynamic imports. Core dancer and venue tools warm concurrently with account/data loading, avoiding a new serial chunk wait after those responses. Customer navigation warms none of them. Video editors load when their existing UI mounts them. The same components, props, mount conditions, session validation, private requests and styling remain in place. No new dependencies, timers, vendor services or global caches were introduced.

The main dashboard, account controls and profile presentation remain eager. Splitting the entire 600 KB source module into independent role applications would carry substantially more integration risk; this release takes the bounded import-boundary improvement first. The large home shell is unchanged.

## Validation

The complete automated suite includes offline-chunk warmup tests for all three roles. `scripts/performance/dashboard-smoke.mjs` supplies explicitly synthetic private responses and exercises customer account controls, dancer schedule/profile/video-editor opening, and venue TV/team controls. It rejects JavaScript and chunk-loading errors and suppresses all API writes. This validates rendering and import boundaries, not real account authentication or uploads.

The first optimized build reduced the listed dashboard entry/shared JavaScript from 1,243,526 to 906,865 raw bytes and from 308,254 to 221,810 gzip bytes (86,444 bytes / 28.0% less gzip). The final build, including the upstream playback fix, lists 906,045 raw / 222,329 gzip bytes. The final browser comparison uses the refreshed patched baseline above to account for the upstream framework changes.

All three synthetic dashboard browser checks passed on the optimized patched production build, including opening the deferred video editor. The customer loaded 14 script chunks versus 17 before splitting. TypeScript, lint and the production build passed with all 1,954 then-available tests. The last upstream synchronization (`760808e4`) adds only migration-release tooling, tests and documentation; a scoped Git diff confirms no application source, runtime lockfile or framework configuration changed. Its new migration guard is run, along with the complete expanded test/TypeScript suite and lint, against the unchanged application build before publishing.

The expanded suite passed all 1,963 tests, TypeScript and lint; the migration guard also passed. The initial push then encountered upstream `da53b24a` (exclusive playback for the selected profile-video card). That fix is retained. The rebased release passes all 1,966 tests, TypeScript, lint, production build and all three dashboard browser checks. Build and deployed comparison results are recorded with the step's release artifacts. Only successful deployed measurements will be used in the final before/after report.
