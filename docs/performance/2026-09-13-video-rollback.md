# Video-only rollback — September 13, 2026

## Historical state

Restored video playback and scrolling to **ad0208a57a9c54bbca32fc650a25a07ce89618fb**, September 11, 2026 at **23:34:19 America/Los_Angeles**. This is the last first-parent state before the approximately 24-hour cutoff established when the rollback began. Its playback implementation is the same as **bc4812b7b41550f59c2f803219a7db0f94fcd51a** (September 11 at 23:09:47, stabilize MyDancr TV playback while scrolling).

This is a new scoped rollback commit on top of fdca9fee (including the concurrent dancer-directory image-loading change after e1032960), not a repository reset.

## Playback restored

- Routed profile player (DancerPhotoCarousel), shared-shell profile video viewer, shared-shell TV feed, and routed TV feed.
- September 11 viewport selection, scroll handoff, pause/resume, native MP4 attachment, buffering and source cleanup.
- Previous poster/decoded-frame behavior and autoplay recovery.
- Active clip loads normally; next clip warms metadata after readiness; the already-attached previous clip is retained where that historical player supports it. Data Saver/2g restrictions remain. The newer two-ahead/two-behind full preload behavior is removed.
- Removed HLS/adaptive client, HLS engine delivery, rendition generation/background scheduling, playlist delivery, delayed-frame presentation helpers, and their obsolete tests. Old HLS URLs return 404 so already-open clients can fall back to their MP4 source.

Five production files match the historical snapshot exactly: DancerPhotoCarousel.tsx, profile-media-card-feed.css, video-autoplay-recovery.js, video-resource-ref.ts, and video-buffer-policy.ts. TvFeedClient.tsx matches its historical implementation except the later Free Entry CTA wording. Eighteen shared-shell playback functions were compared against the historical snapshot and match exactly, including both profile and feed scroll selection.

## Preservation

Mixed files were patched only in video-related sections. Later security, authentication, RLS, protected MP4 byte-range delivery, profile/venue UI, dashboards, database work, verification recovery, responsive avatars and shared-shell code splitting remain. No database migrations, stored media, Supabase configuration or RLS policies were changed. Safe private-rendition deletion helpers remain for cleanup of derivatives that were already generated; these do not participate in playback. No unrelated working-tree files were staged.

## Validation

- 187 focused playback/media/security/moderation tests passed.
- 78 integration tests passed, including protected MP4 and retired HLS endpoint checks.
- Production build, TypeScript/lint build checks, and public artifact scan passed.
- Historical source comparisons passed.
- Read-only mobile Chromium and WebKit journeys passed 22 phases each: feed/profile MP4 playback, rapid forward/backward scrolling, single-player handoff, background/resume and closing. Both recorded zero overlapping playback, zero HLS requests and zero runtime errors. Chromium had no console errors; WebKit emitted only its existing unsupported interactive-widget viewport warning. Reports are retained locally with release evidence.
- A Windows CRLF-only build mismatch in the existing CSP hash generation was resolved by using LF source checkout, with no security-code changes.

Physical Android and iPhone devices were unavailable; browser tests use Pixel 5 Chromium and iPhone 13 WebKit emulation. This restores previous MP4 behavior, including its existing limitations on slow cellular connections; it does not claim adaptive quality or device-level smoothness guarantees. No further optimization is part of this rollback.

## Complete changed-file inventory

M = selective/restored modification; D = removed recent video implementation or obsolete associated validation.

```text
M	app/api/admin/tv/import/route.ts
M	app/api/admin/tv/videos/route.ts
M	app/api/cron/video-moderation/route.ts
M	app/api/dancer/tv/videos/[id]/route.ts
M	app/dancers/[slug]/DancerPhotoCarousel.tsx
M	app/dancers/[slug]/page.tsx
D	app/hls-engine.js/route.ts
M	app/tv/TvFeedClient.tsx
M	next.config.mjs
M	outputs/index.html
M	package-lock.json
M	package.json
D	public/adaptive-video.mjs
M	public/profile-media-card-feed.css
M	public/video-autoplay-recovery.js
D	scripts/performance/adaptive-video-smoke.mjs
M	scripts/performance/mobile-matrix.mjs
M	scripts/performance/profile-video-smoke.mjs
M	scripts/performance/verify-deployment.mjs
D	scripts/performance/video-presentation-smoke.mjs
M	scripts/performance/video-resource-smoke.mjs
D	scripts/performance/video-scroll-startup.mjs
D	scripts/performance/video-warmup-smoke.mjs
D	scripts/prepare-adaptive-videos.mjs
M	src/generated/live-shell-feature-versions.mjs
M	src/generated/live-shell-script-version.mjs
M	src/generated/live-shell-version.ts
M	src/generated/static-asset-versions.mjs
D	src/lib/dancr/adaptive-video-background.ts
D	src/lib/dancr/adaptive-video-codecs.ts
D	src/lib/dancr/adaptive-video-encoder.ts
M	src/lib/dancr/adaptive-video-manifest.ts
D	src/lib/dancr/adaptive-video-worker.ts
M	src/lib/dancr/media-delivery.ts
M	src/lib/dancr/static-asset-paths.mjs
M	src/lib/dancr/tv.ts
M	src/lib/dancr/video-buffer-policy.ts
D	src/lib/dancr/video-frame-presentation.mjs
M	src/lib/dancr/video-resource-ref.ts
D	tests/adaptive-video-background.test.mjs
D	tests/adaptive-video-client.test.mjs
D	tests/adaptive-video-delivery.test.mjs
D	tests/adaptive-video-encoder.test.mjs
M	tests/adaptive-video-manifest.test.mjs
D	tests/adaptive-video-warmup.test.mjs
D	tests/adaptive-video-worker.test.mjs
M	tests/dancer-profile-experience.test.mjs
M	tests/home-tv-card-experience.test.mjs
M	tests/home-tv-playback-handoff.test.mjs
M	tests/import-finalization-caller.test.mjs
M	tests/intelligent-video-loading.test.mjs
M	tests/media-delivery-privacy.test.mjs
M	tests/profile-media-scroll-stability.test.mjs
M	tests/profile-video-playback-selection.test.mjs
M	tests/video-autoplay-recovery.test.mjs
M	tests/video-buffer-window.test.mjs
D	tests/video-frame-presentation.test.mjs
M	tests/video-moderation.test.mjs
M	tests/video-page-visibility.test.mjs
D	tests/video-recovery-mutations.test.mjs
M	tests/video-resource-ref.test.mjs
D	tests/video-warmup-buffer.test.mjs
A	scripts/performance/video-rollback-smoke.mjs
A	docs/performance/2026-09-13-video-rollback.md
```
