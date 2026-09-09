# Step 10 — CSRF and state-changing requests

## Finding and correction

**LOW — Visitor-cookie mutations lacked an explicit browser-origin and JSON content-type boundary.** Likes, engagement shares and anonymous going signals use HTTP-only visitor cookies. Their POST handlers previously accepted JSON carried as `text/plain`, including a body that an HTML form can construct using an extra field for the inserted `=`. No Origin or Fetch Metadata check ran before database work.

Existing `SameSite=Lax` cookies mitigate ordinary cross-site POSTs. They do not isolate sibling origins within the same site; an attacker would need control of such an origin to attach an existing visitor identity that way. Cross-site requests without that identity could still cause unwanted anonymous engagement attempts. Existing durable rate limits and public-target eligibility reduce impact. This is not an account-authentication or private-record bypass, and no compromised sibling origin was established.

Only the three affected POST handlers now call `requireSameOriginJsonMutation` before body parsing or database access. A supplied Origin must match the request's own origin; cross-site/same-site Fetch Metadata is rejected. Requests must use `application/json`, including ordinary charset parameters. Rejections return 403 for origin/context mismatch or 415 for an unsupported media type. The guard is not an authentication mechanism and does not trust these headers against non-browser attackers.

Legacy browsers and non-browser JSON clients may omit Origin/Fetch Metadata. A browser form still cannot send the required JSON media type, and cross-origin script requests require preflight. No permissive CORS policy is added. The existing public rate limits remain necessary for direct automated clients. Current home-shell, React profile, TV, share and dashboard callers send same-origin JSON; anonymous and signed-in behavior is preserved.

## Other boundaries reviewed

- Account, profile, schedule, venue and admin operations use explicit Authorization bearer headers. Refresh credentials also travel in an explicit header. The request helper never treats cookies or a refresh token alone as login credentials. Same-origin browser restrictions prevent a hostile page from reading MyDancr browser storage or silently adding another user's bearer token. Existing authorization and Step 7 admin denial coverage remain intact.
- No application server actions using `use server` were found. The application uses Route Handlers; it does not inherit a universal framework CSRF guard for arbitrary cookie-backed JSON handlers. A new global CSRF token system would duplicate the bearer boundary and disrupt machine endpoints, so the correction is scoped to the visitor-cookie actions.
- The NFC browser-account cookie is a signed deterrent, explicitly not a login credential. Dancer registration still requires verified bearer authentication; viewing a sticker does not register the browser as a dancer. Auth callbacks retain the provider-token and Step 5 browser-session protections and must remain reachable from email links. Session architecture receives its scheduled Step 17 review.
- A source inventory covered 84 exported GET handlers, including 81 API handlers. Customer going/media-like GETs read state; invitation and legacy redemption GETs resolve existing records without accepting an invitation or redeeming an offer. NFC GET records bounded scan telemetry but does not complete a cashier redemption or dancer registration. No ordinary browser GET was identified as a destructive account/admin action.
- The five Vercel worker GETs deliberately perform scheduled maintenance. Each requires the centralized, constant-time `CRON_SECRET` bearer check and fails closed if it is absent. Browser cookies do not authorize them. Their existing deployment workflow is preserved; tests retain denial-before-worker checks. This is an explicit machine-workflow exception to the usual read-only GET convention, not an unprotected browser mutation.
- Webhooks, authenticated machine requests and auth callbacks receive no new origin checks in this step. Signature/replay checks and CORS receive their own numbered reviews.

## Evidence and limits

Thirty-eight new tests cover 27 real POST rejection cases, four deployment/development origins, three preserved normal validation paths and four attempts to authenticate account operations using cookies or refresh-only credentials. All 27 rejection cases failed before the route guards and pass afterward, before body consumption or database work. The cookie tests run the actual request-authentication helper with isolated provider/database fixtures. The full suite passes 2,805 tests before final release checks.

Synthetic requests reproduce server admission/rejection; no hostile form is published and no production engagement, notification or user record is changed to test the controls. Deployment verification uses `{}` with no valid target ID and checks denied requests plus normal 400 validation, so a mistaken guard cannot create engagement data. No database migration, cookie-attribute change, new dependency or UI change is required.
