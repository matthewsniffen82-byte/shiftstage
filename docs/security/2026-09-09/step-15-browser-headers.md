# Step 15 — Browser security headers

## Finding and scoped hardening

**MEDIUM — Sensitive Next.js pages and the authentication callback permitted arbitrary inline scripts.** Read-only production checks confirmed `script-src 'unsafe-inline'` on the admin, dancer dashboard, password-reset and callback pages. That reduces protection if HTML injection reaches a page holding session or administrative data. This is a confirmed policy weakness, not a newly demonstrated production XSS or account-takeover exploit. The home page already used exact script hashes, and API responses already had a restrictive policy; both stronger controls are retained.

All eleven existing admin, dashboard and account document pages now receive a fresh 192-bit cryptographic script nonce. Middleware sends the same policy upstream for Next's renderer and downstream to the browser, replaces any caller-supplied CSP/nonce headers, and marks the response private/no-store in browser and CDN caches. Matching uses explicit page paths and accepts the trailing slash. An inventory test requires every private page to be covered and render per request. The existing API session-rotation branch remains separate and retains its authentication and error handling.

The fixed Android device-classification script is shared unchanged between the layout and policy generator and allowed by SHA-256. It remains inline, avoiding an extra resource request or a timing change. Next's own generated scripts receive the request nonce. Other script sources retain the existing same-origin and OneSignal requirements; arbitrary inline scripts, inline event handlers and evaluation are not allowed on these private pages. No blanket `strict-dynamic` change alters third-party loading assumptions.

The reset page now renders dynamically so it cannot reuse a build-time nonce. Other existing private pages already render dynamically. This follows the [Next.js 15 nonce and rendering guidance](https://nextjs.org/docs/15/app/guides/content-security-policy), cross-checked against the installed 15.5.24 renderer and Script implementation. The root layout does not start reading request headers, so unrelated static/public routes keep their rendering behavior.

The standalone authentication callback uses the existing hash-policy builder over its exact generated HTML. Its session serialization, token validation, concurrent-session protections, no-store and no-referrer behavior remain. Hashes do not include credential values in readable headers. Invalid and temporarily unavailable callbacks receive the same policy discipline.

No database migration, provider configuration, dependency, paid service or UI redesign is introduced.

## Header inventory and retained compatibility

| Control | Reviewed behavior |
| --- | --- |
| CSP: home | Existing exact trusted-script hashes; no arbitrary inline JavaScript. Public caching retained. |
| CSP: admin/dashboard/account | New per-response nonce plus the fixed device-script hash; API session handling is unchanged. |
| CSP: auth callback | New exact response-script hash; existing no-store/no-referrer retained. |
| CSP: other Next pages | Existing SSR-compatible policy retained in this conservative rollout. Inline scripts remain permitted there; they are a known residual weakness. Applying nonces to those pages requires the same native-browser and rendering/cache verification, not simply deleting `unsafe-inline`. |
| CSP: APIs | Existing `default-src 'none'`, no forms/base URI and no framing. JSON responses do not become active HTML documents. |
| Framing / plugins | `frame-ancestors 'none'`, legacy `X-Frame-Options: DENY`, and `object-src 'none'` retained. |
| MIME handling | `X-Content-Type-Options: nosniff` retained. |
| Referrers | `strict-origin-when-cross-origin`; sensitive callback overrides to `no-referrer`. |
| HTTPS | HSTS for one year and upgrade-insecure-requests retained. No unverified includeSubDomains/preload commitment is added. |
| Browser capabilities | Existing self-only camera, microphone, geolocation, fullscreen and payment; USB disabled. Required media/location flows are not disabled without product evidence. |
| Isolation / compatibility | Same-origin-allow-popups and Origin-Agent-Cluster retained. No COEP restriction is introduced that could block existing remote media/integrations. |
| Legacy headers | Existing DNS-prefetch/cross-domain controls remain. X-XSS-Protection is already `0`, disabling the obsolete browser filter rather than claiming it is a modern XSS defense. |

The common policy is extracted without weakening its directives. Inline styles remain necessary for existing React styles and the live design. Existing HTTPS media/image sources, Supabase HTTPS/WebSocket connections, Google fonts/maps and configured OneSignal sources remain. Broad image/media and Supabase source allowances are residual constraints; this change does not claim complete exfiltration prevention or replace URL validation, escaping, authentication or authorization.

## Validation and operational limits

Twenty-four new tests cover private paths, prefix lookalikes/public exclusions, fresh nonces, replacement of attacker-supplied headers, matching request/response policy, private caching, required resources and the fixed script hash. Nine private-page assertions failed before middleware wiring. Four callback cases cover empty, valid, rejected and unavailable provider responses, checking the actual emitted script hash and retained safe headers. Existing recovery, session-concurrency, device styling, API session-transport and header tests remain.

The first local production check confirmed matching policies on all eleven real pages, then caught a compatibility defect in a broad-prefix implementation: Next's cached 404 HTML did not contain the newly generated nonce. Before publication, matching was restricted to the actual dynamic private pages. Unknown pages retain their existing static-404 policy, and non-API fallthrough cannot invoke API session handling. Three missing-route cases and the private-page inventory check guard this boundary; 37 focused policy/session tests passed after the correction. This was a pre-release regression caught by validation, not a deployed production defect.

One older callback VM fixture initially lacked the new imported policy helper; it was updated to use the real helper. All 34 focused callback/session regressions then passed. Final validation passed all 2,965 tests, lint, TypeScript and production build. At 18:13:36 UTC, native Edge verification of the local production build passed all eleven page variants and the corrected 404, with working admin controls, device classes and recovery navigation. A synthetic untrusted inline script was blocked while the valid nonce probe executed. No unexpected CSP violation or JavaScript error occurred. Delivery evidence is recorded in the execution ledger.

Browser verification uses the local production build, synthetic script markers and a temporary loopback server. All browser API requests are intercepted and all external requests blocked, so no authentication, email, upload, admin action or financial event is submitted. The native checks confirmed actual hydration and blocked untrusted inline execution before publication. Real authenticated production workflows and physical-device Safari testing are outside this safe fixture; no claim of complete browser or XSS coverage is made.
