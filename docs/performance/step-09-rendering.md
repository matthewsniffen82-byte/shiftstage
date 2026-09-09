# Step 9 — compact critical CSS while preserving cold mobile startup

Step 8 was pushed as `3f14c63342850cf6ec060007f6fe3b4b561839f1`; [Vercel succeeded](https://vercel.com/ai-movie-jobs/shiftstage/3CRniT2G4FpxrMYKKQ2WtwaVat42). Cache headers, warm asset reuse, three role fixtures, video resources, health and private-access checks passed.

## Baseline and final implementation

The classic homepage embeds three style blocks. Its main block has 908,266 normalized bytes (131,650 gzip) and 3,486 browser-parsed rules. It precedes shared overrides; the other blocks occupy different cascade positions. Fonts already use swap/preconnect. Inter, Manrope and Space Grotesk load on home, venues and login. Other faces remain available for views that need them. No font, glow, blur, shadow or animation change is justified by this evidence.

The retained optimization compacts syntactic whitespace at build time using the already installed PostCSS parser. It preserves every selector, declaration, value, comment and rule order. The main style remains inline at its exact original position, avoiding an added cold stylesheet request. The other style blocks and links are unchanged. Source CSS falls to 718,398 bytes (120,419 gzip); the document estimate falls from 1,369,728 to 1,179,860 raw bytes and from 199,176 to 188,084 gzip bytes. No browser dependency or runtime CSS parser is added.

Development, tests, type checking and builds generate the compact artifact before its static content version. The root route reads it alongside the source HTML, and explicit file tracing includes it in the deployed function. The generated public CSS URL remains available for compatibility with briefly cached documents from the tested external-delivery releases. New documents inline it and do not request or preload that URL. Private/API cache boundaries and CSP remain unchanged.

## Evidence-driven rejection of external delivery

Three cold cellular runs per route initially measured median home LCP/FCP 1,372 ms, 927,264 bytes and 42 requests; venues measured 1,396 ms, 715,581 bytes and 41 requests. A repeat home navigation using a fresh document URL transferred 218,976 bytes despite warm assets.

- `eb75d8436d5c9c662358cd4ea906fd367da688fc` externalized CSS. Vercel succeeded and styles matched. Repeat-document home transfer fell to 90,016 bytes, but cold FCP increased by 132–272 ms. The step stayed open.
- `ac451c674a64af33753cf2d1c178b1bea285ca94` generated compact static CSS, removing request-time extraction. Vercel and all 2,724 tests/checks passed, preserving upstream input validation (`70cfac08`). Live bytes and all 3,486 CSSOM rules matched. Home/venue cold transfer fell about 14 KB, but cold paint remained mixed/slower. One measurement-runner callback failed; its partial run was retained and a complete batch repeated.
- `bd70d9fa57e3a2acab72709ac8679a09c7f1159a` added one response-header preload to investigate the observed CSS-discovery delay. Vercel and all 2,768 tests/checks passed, preserving upstream XSS protection (`96745f70`). All nine mobile samples were healthy, with one CSS request each. Home/venue FCP medians were still 1,556/1,664 ms, against 1,372/1,396 before this step. Higher TTFB and host/network variation also affected the comparison.

Because cold mobile startup is the priority, external delivery and its preload were removed. The lossless compaction is retained inline. The repeat-document 59% transfer reduction from the experimental external version is **not** a benefit claimed for the final implementation. [MDN describes the investigated Link-header preload mechanism](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Link).

## Verification

AST signatures preserve all nodes and values. Browser CSSOM serialization matches all 3,486 rules exactly. Shared computed styles and stylesheet rule counts match across home, venues and login; venue screenshots match visually. One original home snapshot lacked data-loaded cards, so their presence is excluded from that style comparison. No speculative deletion of apparently unused CSS occurs: dashboards, modals and responsive states require broader coverage.

The final inline version receives the complete automated suite, TypeScript, lint, migration guard, production build, traced-artifact inspection and deployed CSS/HTML equivalence checks. Cold mobile samples, request counts, fresh-document transfer, video resources, dashboards and health are repeated before Step 10. The Step 9 delivery archive records every pushed release, final measurements and limitations.

The retained inline version preserves upstream CSRF protection (15b6fbff). All 2,806 automated tests, TypeScript, lint, migration guard and production build passed on the combined release. The built function trace contains the compact stylesheet. Development still renders live source CSS so edits remain visible without rebuilding.
