# Step 16 — CORS boundaries

## Audit result

No new exploitable CORS defect was confirmed. MyDancr already grants no cross-origin browser access to its application APIs. This step preserves that stronger default and adds ten regression tests; it does not add an origin allowlist, wildcard grants, credential sharing or a paid service.

The review covered all 116 API route files, middleware, Next configuration, Vercel deployment configuration, browser/session transport and Supabase request clients. There is no application `Access-Control-Allow-*` or `Access-Control-Expose-Headers` configuration and no custom API OPTIONS handler. The installed Next.js 15.5.24 implementation provides an empty 204 OPTIONS response with an `Allow` header without invoking an application handler. This matches the [Next.js route documentation](https://nextjs.org/docs/15/app/api-reference/file-conventions/route). `Allow` advertises HTTP methods; it does not grant CORS access under the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

At 18:21:50 UTC, 36 safe production checks passed. Eight representative account/admin/profile/upload/venue/auth/public/webhook routes returned 204 preflights without CORS grants for the canonical origin, an unrelated origin, a deceptive hostname and the literal null origin. Four anonymous account requests with a synthetic visitor cookie returned 401 and no CORS grants. No credentials, real accounts, uploads or mutations were used.

## Reviewed boundaries

| Boundary | Existing behavior preserved |
| --- | --- |
| MyDancr private APIs | No origin reflection, wildcard or credential-sharing grant. API authentication still requires an explicitly supplied and verified bearer token; ambient visitor cookies do not authenticate an account. |
| MyDancr public APIs | Same-origin browser access remains the application default. Public data stays subject to its existing response/abuse controls. CORS is not treated as authorization or scrape prevention. |
| Vercel public static assets | HEAD checks on the published icon, stylesheet and API-transport JavaScript returned wildcard origin access without credentials. These are intentionally public resources, not private API responses. The platform's existing asset delivery is retained. |
| Session refresh headers | Existing private caching and same-origin browser transport remain. No CORS exposed-header list makes access/refresh headers available to another site. |
| OPTIONS | Framework-generated 204 plus `Allow`; no handler action, session refresh, email, upload or webhook processing. Origin-dependent response grants are absent, so no new origin-dependent cache behavior is introduced. |
| Cookie-identified actions | Step 10's same-origin/JSON mutation checks remain. CORS does not replace those controls: simple cross-origin requests can reach a server even when the response is unreadable. |
| Supabase API gateway | Six read-only preflights across REST, Auth and a nonexistent private storage object returned `Access-Control-Allow-Origin: *`, requested API-key/authorization headers and no `Access-Control-Allow-Credentials`. No private object was read. |

Supabase access uses explicit API keys, bearer tokens or scoped signed-upload tokens, not a MyDancr ambient authentication cookie. The browser upload client disables session persistence, automatic refresh and URL session detection. The TV studio obtains a scoped upload authorization through MyDancr and calls `uploadToSignedUrl` with overwrite disabled. Cross-origin gateway behavior is required for that browser integration; it does not make protected rows or private storage objects public. The actual data boundaries remain JWT/token validation, grants, ownership, RLS and storage policies audited in earlier steps. Broad advertised preflight methods do not prove that those operations are permitted. No provider change or proxy rewrite is justified by the observed preflights. A cookie-authenticated cross-origin API introduced in future would require a separate exact-origin and CSRF review.

## Regression coverage and limits

The ten new tests inspect actual framework/deployment header rules and the API route inventory. Eight representative route-method configurations run through the installed framework's OPTIONS implementation and actual middleware for four origins. They verify empty 204 responses, required `Allow` methods, no origin/header/credential grants and no route-handler or session-refresh execution. Inventory guards require explicit review if custom preflights or CORS grants are introduced.

Native Edge checks against the local production build passed: same-origin health/account responses remained readable, cross-origin account responses were unreadable with credentials included or omitted, opaque-origin reads were blocked, and a JSON admin request stopped at preflight. The forwarding guard observed no application mutations. Only safe GET and OPTIONS requests reached the local app; the owned fixture pages requested only loopback resources. Browser request interception was avoided because its Chromium request path skipped native preflights in an initial harness check. The forwarding guard caught that synthetic POST before it reached MyDancr. The execution ledger records the final combined release validation.

These checks do not claim that CORS blocks non-browser clients, stolen bearer tokens, XSS, or all CSRF. No production authenticated account was used, and provider preflights are not a substitute for live cross-user RLS testing. Those testing limits and the existing isolated database coverage remain documented in the earlier step reports.
