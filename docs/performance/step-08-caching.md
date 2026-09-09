# Step 8 — safe static asset reuse

Step 7 was pushed as `d2383163be446be1382d99cbee94c8babb37a28f`; its exact Vercel deployment succeeded. The live stale-request cancellation/return-playback journey, normal profile prefetch trace, resource limits, public API/media probes and private access boundary checks passed.

## Baseline and policy audit

The application already uses content-addressed Next bundles and a hash-versioned live application script. Public directory data has a 60-second browser/edge window; rapidly changing public schedules/feed data has a 10-second window. Personalized TV, private API responses and authentication remain private/no-store. Public HTML has its existing short edge window. These policies are preserved; no account or permission data is added to a cache.

The static CSS/JavaScript allowlist previously granted one-year immutable caching to mutable filenames **even with an obsolete or missing version query**. Meanwhile both early runtime scripts, API transport and photo crop, revalidated on every navigation. A browser trace with HTTP caching enabled and no request routing measured six network requests on the second home visit, including both script revalidations (138 response bytes combined). The first home visit transferred 926,295 bytes in 42 requests. The second profile visit also revalidated both scripts. These are single cache-behavior samples, not timing medians. The first profile visit shares already cached home assets and is not a fully cold browser.

## Change

- Generate deterministic versions from the actual allowlisted public asset contents before development, tests/type checking and production builds. Text line endings are normalized so Windows and deployment builds agree.
- Reference these versions in the classic shell and React layout. The shell rewrite happens after application-script externalization and preserves inline scripts/styles, signed media, external URLs and API links. CSP is calculated from the final HTML.
- Grant immutable caching only to the matching content version and the existing three content-addressed responsive heroes. Unversioned/obsolete mutable aliases and mutable venue-logo paths revalidate, avoiding a year of stale branding or code after a release.
- Keep Next asset handling, live-shell hash checks, all data/security cache boundaries and asset bytes unchanged. No dependency or service is added.

Tests cover manifest freshness, current/obsolete/unversioned header selection, private-path exclusion and HTML/code preservation. All 2,680 automated tests, TypeScript, lint, migration guard and the production build passed before delivery. Live verification repeats header probes, warm navigation, dashboard fixtures and video playback after Vercel success. Results and the exact delivery record are retained in the Step 8 archive. Any warm-request change is reported separately from the correctness benefit; no cold-load speedup is assumed.
