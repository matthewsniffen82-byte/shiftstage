# Step 1 — audit and baseline

Source baseline: `bb14ecd1` (`origin/main` at audit start). Production implementation is unchanged in this step. Changes consist only of the measurement tools and this report.

The upstream documentation-only security baseline `50d4eb54` was fast-forwarded before delivery. A later concurrent feature release, `e60f1a64` (deal removal and venue visibility), arrived at the first push attempt, so this audit was rebased and all release checks rerun. The recorded measurements remain explicitly tied to the original application baseline, not attributed to that unrelated feature. Later step comparisons must use the then-current deployment for any affected venue/API behavior. The home HTML/application-script bytes were unchanged by those upstream commits. All 1,936 tests passed on the original baseline; validation of the integrated release is recorded in the delivery archive together with the exact Vercel status.

A further upstream fix, `6ef753e2`, binds home photo cropping to its initiating account and changes the home script. It is preserved in the release. The initial audit remains the historical baseline; per-step comparisons will record the current pre-change script/bundle sizes rather than attributing unrelated security changes to optimization work. The integrated application is revalidated before this audit is pushed.

## Architecture and inspected paths

The app uses Next.js 15.5.22 / React 19, deployed to the existing Vercel project, with Supabase auth, PostgreSQL, and Storage. There are 148 page/route files and 48 client-component entry files. The largest discovery surface is **not React**: `app/route.ts` serves the checked-in `outputs/index.html`; `app/live-shell.js/route.ts` extracts its deferred, version-keyed application script. `/tv` redirects into that home shell. Venue URLs resolve public venue data and redirect into the same shell. Dancer profile pages render server-fetched data with interactive client islands. Customer, dancer, and venue dashboards all import `DashboardClient.tsx`.

| Area | Existing implementation and evidence | Follow-up |
| --- | --- | --- |
| Initial JS / hydration | Home app script is 1,168,674 raw bytes (234,878 gzip estimate). Dashboard route entry plus listed shared chunks totals 1,241,845 raw / 307,723 gzip bytes; all three roles eagerly import dancer media, NFC, shifts, venue team, and TV tooling. Server-only Supabase/sharp/ffmpeg code is separate from client components. | Step 2: isolate optional dashboard tooling and reduce delivered script overhead without delaying essential controls. |
| HTML / CSS | Normalized source HTML is 2,537,868 bytes. Inline styles total 1,234,683 bytes (174,096 gzip). The global aesthetic stylesheet contains accumulated overrides, filters, and responsive rules. Root request rendering rereads and transforms the source and recomputes CSP. | Steps 2, 8, 9: measure safe delivery/build transforms; preserve selectors, cascade, CSP, and deployment version checks. No blind CSS removal. |
| Fonts | Home requests Inter, Manrope, Outfit, and Space Grotesk from Google Fonts with `display=swap`; the pilot actually transferred three font files totaling approximately 95 KB. | Step 9: measure font use and loading order; retain the visible typefaces. |
| Images | `responsive-image.ts` generates watermarked WebP variants at 320/480/640/1280/2048 and retains dimensions/focal coordinates. Public cards include srcsets. The 1,590 px hero is displayed around 369 CSS px in the pilot. Older media and logos follow fallback paths. | Step 3: verify rendered `sizes`, avatar/feed/logo variants, below-fold priority, and layout stability across every major surface. |
| Video upload/storage | Existing upload maximum is 75 MiB / 30 seconds. Moderation/watermark processing supports H.264/AAC MP4 with `+faststart`, and WebM. MP4 encoding uses CRF 20 / veryfast with no delivery rendition ladder. Posters are generated. Public TV URLs are signed in a batch for one hour; source formats/resolutions vary. | Step 4: inspect actual file/range/cache behavior and bound feed warmup. Consider source resolution/bitrate evidence before changing encoding. |
| Video player | Home, profile carousel, dashboard previews, and TV strips use different player paths. Active/adjacent source limits and IntersectionObservers already exist. `videoBufferMode` currently gives the next clip `auto` once the active clip is ready; data saver releases adjacent sources. The pilot kept one video playing and released distant players, with no reported dropped frames in the short sample. | Step 4: rapid scrolling, hidden-page pause, stalled playback, and bounded next-clip bandwidth. Do not preload a whole feed. |
| Feed rendering | Home constructs HTML lists and has visibility observers, incremental profile media, passive listeners, and periodic discovery refresh. Dashboard state covers many sections/roles in one client module. | Step 5: measure long tasks and repeated list work; avoid indiscriminate React memoization or virtualization of short lists. |
| Supabase / queries | Public discovery parallelizes independent venue/dancer work. Public metrics use bounded aggregate RPCs instead of per-card counts. Public video signing is batched; owner TV workspace/admin paths still sign rows individually. Existing indexes cover profile visibility/city, shifts, video feeds, notifications, and engagement. | Step 6: inspect remaining per-row work and unnecessary columns. Do not add indexes without evidence or change RLS. Production query plans are not yet available through the connected tools. |
| API/network | Pilot home navigation initiated cities, discovery, TV count, and the full TV feed before opening TV. A direct discovery response was approximately 270 KB uncompressed; TV metadata approximately 55 KB. Both supplied public cache headers and succeeded. Customer/dancer dashboard loaders already parallelize optional panels and cancel requests. | Step 7: measure duplicate/unneeded fetches, payload repetition, and dependency ordering. Preserve auth refresh serialization and fresh private state. |
| Caching | Public discovery/TV use 10-second freshness and short edge stale windows; following/private data use no-store. Root uses a brief public edge window. JS version URLs are immutable, and several explicitly listed CSS/JS paths have one-year cache headers. | Step 8: verify versioning matches immutability; never put session/private data in public caches or extend live visibility freshness casually. |
| Third parties / analytics | Pilot initial JS came from the app itself. OneSignal is loaded on push enrollment rather than globally. QR generation is server-side. Engagement collection uses app APIs; Stripe billing is opened on demand. | Step 10: verify no accidental eager integration loads and preserve required events/consent. A dependency in package.json is not proof it ships to the browser. |
| Memory / lifecycle | Observers, object URLs, timers, and cleanup exist across media and auth paths. Most React effects disconnect or abort; home observers/timers live for the document lifetime. API transport removes abort listeners and deadlines. Push SDK deferred callbacks and repeated media changes merit longer checks. No active Supabase realtime subscriptions were found in app/client source. | Step 11: stress repeated opening/closing and video scrolling; distinguish bounded caches from retained resources. |
| Mobile / transitions | Android-specific classes, safe-area handling, visualViewport listeners, touch swipe handling, and global mobile navigation already exist. Auth and venue redirects pass through the home shell. | Steps 12–13: test narrow iPhone/Android-sized viewports, slow CPU/network, back navigation, forms, and useful first content without changing the design. |

## Baseline measurements

The table contains authoritative measurements from 28 mobile page runs. Seven public routes and a synthetic customer dashboard have three cellular samples each; Wi-Fi/slow-network samples are diagnostic single runs. Pilot runs are excluded because tests/builds were still running. The synthetic customer uses disposable in-browser data and mocked private APIs, so it measures production rendering/bundle work, not authenticated server latency. Dancer/venue dashboards share the same initial module; their real private data timings remain unmeasured.

| Route / lab profile | Runs | LCP ms | FCP ms | TTFB ms | CLS | Initial JS KiB | Initial total KiB | Requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cellular / | 3 | 2404 | 2404 | 96.8 | 0.025 | 249.3 | 1089.3 | 42 |
| cellular /?city=Las%20Vegas&view=tonight | 3 | 1956 | 1956 | 101.6 | 0.039 | 249.2 | 899.6 | 35 |
| cellular /?city=Las%20Vegas&view=venues | 3 | 2464 | 2464 | 90.6 | 0 | 249.2 | 878.7 | 41 |
| cellular /dancers/layout-review-09 | 3 | 3212 | 2184 | 122.5 | 0 | 155.5 | 354.0 | 31 |
| cellular /venues/deja-vu-showgirls | 3 | 2060 | 2060 | 356.1 | 0.03 | 249.2 | 1067.4 | 48 |
| cellular /tv | 3 | 7252 | 2116 | 234.7 | 0.004 | 249.0 | 2371.2 | 56 |
| cellular /?auth=login | 3 | 1680 | 1680 | 79 | 0 | 249.2 | 880.8 | 34 |
| wifi / | 1 | 1940 | 1940 | 130 | 0.008 | 249.3 | 1087.3 | 42 |
| wifi /tv | 1 | 3176 | 992 | 274.1 | 0 | 249.0 | 10615.1 | 57 |
| slow / | 1 | 3988 | 3988 | 67 | 0.006 | 248.8 | 1089.3 | 42 |
| slow /tv | 1 | 12488 | 4720 | 286.9 | 0 | 249.5 | 4977.5 | 56 |
| cellular /dashboard/customer [synthetic customer data] | 3 | 1944 | 1428 | 87.5 | 0.009 | 331.4 | 654.5 | 30 |

No browser JavaScript errors or failed critical requests occurred in the repeat public samples. The home filter interaction proxy was 704 ms (not field INP). Median longest tasks were 772 ms on home, 1,173 ms in the venue feed, and 1,576 ms in TV. Scroll frames over 50 ms were 8.9% in the venue feed and 6.5% in TV. These are concrete Step 5 targets.

Cellular TV first loadstart-to-playing median was 2,096.9 ms; navigation-to-playing was 8,675.4 ms. One player remained active, and the first two sources were attached. No stalled events were reported in the short runs, although initial/repeated waiting occurred. Wi-Fi TV transferred 10.4 MiB by the measurement cutoff, indicating room to limit adjacent-video download.

Twelve independent API probes all returned 200. Three bounded media probes returned 206 for the requested 1 MiB prefix. All three MP4 files had their moov atom before mdat: fast-start is already working. Samples were 3.3–10.3 MB at 1080 × 1920 for 9.9–15.1 seconds; two average roughly 5–5.5 Mbps, above the 4 Mbps cellular lab download rate. Neither cache-control nor accept-ranges was exposed in those signed range responses, but actual range support was verified by 206/content-range. See `baseline-api-media.json`; no signed URLs are retained.

## Priorities and constraints

1. Reduce avoidable initial parse/compile and shared dashboard tooling. Both home and dashboard have material raw JavaScript costs despite compression.
2. Improve the TV entry waterfall and next-video bandwidth. The pilot observed roughly 2.9 seconds between the first player's loadstart and playing, on top of routing/render work; repeat measurements determine the baseline.
3. Tighten responsive image choices and critical asset priority while preserving sharpness and crop.
4. Remove measured duplicate work/requests and improve cache correctness before adding infrastructure.
5. Audit large CSS/font delivery and long-lived media resources against actual browser samples.

Adaptive streaming/multiple video renditions could help large uploads on poor cellular connections. This is a recommendation for assessment, not approval to buy a vendor or introduce recurring costs. Existing fast-start MP4, Storage delivery, posters, source limits, and cleanup must be optimized first.

No security policy, account data, schema, branding, UI layout, or production behavior is changed by Step 1. Serious unrelated bugs, if discovered, will be recorded separately instead of folded into performance commits.
