# Step 11 — Rate limiting and abuse controls

## Findings and corrections

**MEDIUM — Caller-controlled address headers bypassed per-IP throttles.** Password recovery, account lookup, venue signup and copyright-notice address helpers preferred `CF-Connecting-IP` over the deployment's client-address headers. Supplying a different Cloudflare header could create a different IP hash while the actual Vercel address stayed unchanged. Subject/email limits still constrained individual targets, but changing targets defeated the IP dimension.

These paths and the shared public limiter now use one server-only helper. It prioritizes Vercel's address, then X-Forwarded-For and X-Real-IP, accepts valid IP addresses, normalizes IPv6 spelling and rejects zone identifiers. Arbitrary Cloudflare headers and user agents cannot create fallback identities. Missing addresses share an `unknown` bucket. Vercel documents its overwritten forwarding headers and spoofing boundary in its [request-header reference](https://vercel.com/docs/headers/request-headers). Another hosting/proxy arrangement must overwrite these headers at ingress; this helper does not make arbitrary headers trustworthy outside that boundary.

**MEDIUM — Selecting a different login role multiplied an email's attempt budget.** Login and signup buckets included the browser's selected role although Supabase authenticates the same email identity. The shared subject is now the normalized email alone. The existing login limits remain 60 attempts per IP and 15 per email per 15 minutes; signup remains 20 per IP and five per email per hour. This closes role switching without changing provider authentication, authorization, passwords or normal account selection.

**MEDIUM — Venue access-code previews used separate counts and inserts.** Concurrent preview attempts could pass the compatibility counts together. Previews now consume the existing service-only atomic counter before the original rolling-window check. The limits remain 20 per IP and six per subject per ten minutes. Keeping the rolling check avoids weakening the existing time-window behavior. Atomic denial maps to the existing recovery error and Retry-After handling. Backend failures propagate; they do not become an allowance.

## Existing coverage retained

| Operation | Existing application limits / boundary |
| --- | --- |
| Password reset | Eight/IP, three/email per 15 minutes; independent database locks for IP and subject |
| Account email lookup | Four/IP, two/subject per hour; same locked recovery function |
| Venue signup and confirmation | Signup ten/IP and five/email/hour, plus three submitted requests/IP/day; confirmation ten/IP and three/email/hour |
| Image uploads / previews | Shared upload budget 80/IP and 24/account/hour; crop preview 120/IP and 60/account/hour |
| Video upload stages | Shared budget 60/IP and 20/account/hour, plus media size/duration and ownership controls |
| Content reports | Eight/IP and two/subject per ten minutes |
| Favorites, follows and saved deals | 180/IP and 90/account/minute |
| Going, likes and shares | Separate persistent IP and account/visitor budgets; Step 10 browser-origin controls retained |
| Analytics and public events | Endpoint-specific IP/subject budgets, bounded bodies and target validation |
| Notifications | 240/IP and 120/account/minute for mutations |
| NFC / deal actions | Separate open/action/generation budgets, signed tokens, authorization and business redemption controls |
| Copyright notices | Five submitted notices/IP/hour and three/email/day; corrected IP attribution |
| Support | Existing 12-message/account/minute count and server authorization; burst safety is tracked below |
| Admin actions | Central database role/active-account checks, sensitive-action authorization and audit trail; no blanket low IP cap added that could obstruct moderation |

Application counters use keyed hashes rather than storing raw submitted identifiers or addresses. Existing 429 responses, Retry-After headers and sanitized rate-limit events remain. Supabase's provider-side limits are additional controls: direct provider authentication is not governed by the application's route counters. No new service, CAPTCHA, dependency or infrastructure cost is introduced.

## Database and regression evidence

Read-only production metadata confirms both `consume_request_rate_limit` and `record_account_recovery_event` are SECURITY DEFINER with a fixed `public, pg_temp` search path, executable by service_role and denied to anon/authenticated. The atomic function body exactly matches the reviewed migration (MD5 `27b0a36adb2dc7adbafb79ba2c2af11a`). The recovery function's live body differs in formatting/comments but its SQL token sequence matches the stronger two-lock implementation; that implementation is retained.

Forty-two request/runtime tests cover proxy-header precedence, IPv6 and invalid addresses, hash minimization, shared role budgets, existing preview flow and fail-closed backend errors. Eight isolated PostgreSQL tests exercise privileged execution, blocked browser roles, IP/subject budgets, queued burst accounting, expiry and invalid configuration. The initial 33-case request regression set had 24 failures before the fixes. The actual auth route admits only 15 synthetic provider attempts when 20 requests alternate all four selected roles, then returns 429 with Retry-After.

The PostgreSQL fixture uses an empty disposable database and the reviewed counter SQL; queued requests do not certify multi-connection production concurrency. Production checks read metadata and perform safe health/authorization probes only. No production login guessing, email sending, rate-limit exhaustion, notice submission, account mutation or database migration is used for validation.

## Remaining limits and scheduled follow-up

- IP limits cannot prevent distributed botnets and may group legitimate users behind a shared network. Existing subject/account controls remain essential.
- The existing missing-function compatibility fallback is non-atomic; production has the atomic RPC and readiness verifies its presence. Deployments missing it must restore that prerequisite, not treat the fallback as equivalent burst protection.
- Venue daily submissions, copyright notices and support retain additional count-then-write checks. Their precise concurrent spam behavior receives the immediately following bot-resistance review; the corrected IP boundary already applies to venue and copyright paths.
- Public discovery/search pagination, bulk enumeration and resource-heavy profile updates receive their scheduled Steps 28–29 reviews. A universal per-IP cap on cached page loads or all admin actions is not added without evidence that it preserves legitimate traffic.
- Provider-level distributed credential stuffing and CAPTCHA configuration remain deployment/provider considerations. No unsupported claim is made that application counters cover direct Supabase requests.
