# Step 9 — reusable CSS without a visual change

Step 8 was pushed as `3f14c63342850cf6ec060007f6fe3b4b561839f1`; [Vercel succeeded](https://vercel.com/ai-movie-jobs/shiftstage/3CRniT2G4FpxrMYKKQ2WtwaVat42). Live cache headers matched all current/obsolete/unversioned expectations. Repeat home navigation went from six network requests to zero in the cache-behavior sample; repeat profile navigation went from six to four. Three role fixtures, video lifecycle/resource limits, health and private access rejection passed.

## Baseline and scope

The classic homepage embeds three style blocks. Its main block contains 908,266 normalized bytes (131,650 gzip) and 3,486 parsed CSS rules. It precedes the current shared override stylesheets; the other two inline blocks occupy different cascade positions. Fonts use `display=swap` and existing preconnects. Browser inspection loads Inter, Manrope and Space Grotesk on home, venues and login; other declared faces remain available for views that need them. No font files, weights, glow, shadow, blur or animation changes are justified by this evidence.

Three cold cellular lab runs per route before this step measured median home LCP/FCP 1,372 ms, 927,264 transferred bytes and 42 requests; venues measured 1,396 ms, 715,581 bytes and 41 requests. Detailed TV, task, scroll and layout-shift samples are retained alongside these. A separate repeat-navigation test uses a fresh document query while preserving the HTTP asset cache: the second home document still transfers 218,976 bytes. This specifically measures stylesheet reuse across different document URLs, not browser back/forward cache.

## Change and verification

Extract only the main stylesheet to a static build asset at `/outputs/live-shell.css?v=<content hash>` at its **exact original cascade position**. Keep every declaration, other style block, link order, script and UI behavior. The stylesheet URL retains the document's `/outputs/` base for relative URLs; current CSS image references are absolute or embedded. The existing static-asset version generator grants immutable caching only to the matching content version.

The HTML gzip estimate falls from 199,176 to 68,101 bytes, with the same CSS bytes delivered separately on a cold visit. That is a reuse improvement, not a claim that the first visit downloads less total CSS. No speculative removal of apparently unused rules occurs: dashboards, modals and responsive states need styles that a homepage coverage snapshot cannot classify safely.

Tests reconstruct the original HTML exactly from the extracted CSS and replacement link, verify unchanged inline security hashes, cascade order, URL-base semantics and versioned cache handling. All 2,683 automated tests, TypeScript, lint, migration guard and the production build passed before release. After deployment, the actual CSS bytes, computed styles/fonts across home/venues/login, screenshots, cold mobile medians, fresh-document caching, playback and health are checked. Exact results and delivery status are recorded in the Step 9 archive.

## Cold-load regression investigation

The first Step 9 deployment, `eb75d8436d5c9c662358cd4ea906fd367da688fc`, succeeded on Vercel. Repeated fresh-document home transfer fell from 218,976 to 90,016 bytes (58.9%), and all shared computed styles/rule counts matched. Home cards were absent from one earlier snapshot because data had not arrived; that presence difference is not a CSS comparison. Venue screenshots match visually, and all nine new mobile samples had no application errors or failed critical requests. However, cold FCP increased by 132–272 ms across the measured routes. The step therefore stayed open.

The follow-up removes request-time CSS extraction: generate the stylesheet during build and deliver it as an ordinary static asset. Use the already installed PostCSS parser solely to compact syntactic whitespace; retain selectors, values, comments and rule order. Source falls from 908,266 to 718,398 bytes and gzip from 131,650 to 120,419 bytes. A Chromium CSSOM comparison confirms all 3,486 parsed rules serialize identically. AST/declaration signatures also match, including custom properties. Development, tests, type checking and build generate the CSS before its content version, and a live delivery probe compares deployed bytes, version headers and CSSOM against the source. No new runtime dependency or per-request CSS parser is introduced.

The follow-up preserved upstream server input validation (70cfac08). All 2,724 automated tests, TypeScript, lint, migration guard and the production build passed again on the combined release.
