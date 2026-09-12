# Step 7 — browser security and navigation

Reviewed from `b0f3ac2950b934793c07c9b63a32ecbf849727e1` on 2026-09-12.
The current application retains the earlier encoding, nonce/hash policy,
same-origin mutation, session-ordering and normalized-redirect corrections.
No additional application defect was reproduced in this review. This step adds
a bounded read-only deployment checker and records current evidence.

## Current checks

`node scripts/check-browser-boundaries.mjs` makes 23 sequential, unauthenticated
GET/OPTIONS requests to the fixed canonical production origin. It uses no
environment credentials, follows no redirects, retries no requests, and caps
each request at 15 seconds and each document at 4 MiB. It emits counts and
boolean results, never HTML bodies, script contents, cookies or nonce values.
Failure produces a nonzero exit status. It is an on-demand tool, not a watcher
or a scheduled task.

An explicit Vercel edge challenge now stops the check immediately, cancels the
response body and returns `EDGE_CHALLENGE` with `ok: false`. It neither examines
checkpoint HTML as an application policy nor sends the remaining requests.
This is blocked verification, not success. Ordinary application denials and
transport failures retain their failure classifications.

The private-page list is derived from existing admin, dashboard and account
page files and checked against middleware coverage. All eleven pages are
examined, with the dedicated account sign-in requested twice to check nonce
freshness. Root and callback inline scripts must match the policy's exact
hashes; private inline scripts must match an allowed nonce or hash. Additional
checks cover framing, plugins, event handlers, MIME handling, HSTS, private
caching and absence of session response headers on these unauthenticated
document requests.

Ordinary `/account` intentionally redirects to the homepage sign-in. The first
checker draft treated that redirect as a failed document request; it was
corrected to check the existing same-origin redirect separately. A synthetic
NFC context selects the dedicated account HTML without executing
client code or requesting a tag endpoint. No tag scan or registration occurs.

Eight framework preflights cover four account/admin/auth/webhook APIs for an
unrelated origin and the opaque `null` origin. They must remain empty 204
responses without origin, credential, allowed-header or exposed-header grants.
These checks send no bearer token and invoke no application mutation.

All 23 checks passed at the timestamp in `step-07-browser-evidence.json`.
The checker also passed thirteen synthetic positive/negative QA checks for
missing or unsafe policies, mismatched nonces, misleading attribute names,
credential headers, private caching, HSTS and callback referrers. Those checks
used in-memory responses and no provider requests. The checker examines the
controlled emitted HTML; it is not a general HTML sanitizer or XSS scanner.

## Boundaries retained

| Area | Current evidence |
| --- | --- |
| Rendering | Existing plain-text encoders protect reviewed legacy HTML/attribute/CSS contexts. Social anchors use safe protocols. React content remains JSX; the layout's sole `dangerouslySetInnerHTML` contains the fixed device-classification script. No production `eval`, `new Function` or `document.write` was found in the scanned app, source and public scripts. Existing runtime output-encoding regressions pass. |
| Private document policies | Middleware generates a fresh 192-bit nonce, replaces caller-supplied policy/nonce headers, and sets private/no-store controls. Existing tests cover path lookalikes, static 404 exclusions, per-request rendering and allowed resources. The live checker verifies correspondence with delivered inline scripts. |
| Root and callback | Exact inline-script hashes remain. Callback HTML retains no-store/no-referrer, credential URL scrubbing, verified sessions and guarded browser storage. The live callback check uses no credentials or confirmation code. |
| Return destinations | Shared and homepage validators reject external origins, unsafe schemes, controls, backslashes, encoded separators and authority prefixes introduced by dot normalization. Email callback destinations require an exact approved path without credentials or fragments. Existing ordinary destinations remain valid. |
| Browser account data | The Step 5 snapshot correction and Step 6 malformed-claim guard are retained. Browser fetch transport observes the initiating token pair, does not automatically replay writes and leaves unrelated fetches alone. Server verification remains authoritative. |
| CORS and CSRF | APIs retain no cross-origin browser grants. The three visitor-cookie mutations require same-origin JSON before reading the body or using the database. Account operations require explicit verified bearer credentials; visitor cookies and refresh-only headers do not authenticate them. |
| Service worker | The current worker clears old caches on activation and forwards requests to the network. It does not store new responses in Cache Storage; non-public navigation is requested with no-store. Existing public navigation behavior is preserved. |

The ten focused suites passed **178 tests**: security headers, private document
CSP, callback CSP, CORS, legacy output encoding, normalized redirects, safe
return paths, social URLs, visitor CSRF and the browser session boundary.
These mix executable synthetic handlers/helpers with source inventory checks;
they are not an exhaustive live penetration test.

## Limits and delivery

The initial Step 7 commit `def7ef5f3eb30cdc2fb6ae0f59b92fd9e34e81b1` reached
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/FuFw9ULYkxBYZnREujZgXFaQHtaa).
Its 08:30:01 UTC post-deployment check received 23 Security Checkpoint responses.
Read-only Vercel Firewall inspection identified an automatic System Rule
Challenge beginning 08:23 UTC, with zero custom rules and Bot Protection
inactive. These responses did not establish an application CSP failure.
Automated site probes were paused. At 08:42:18 UTC, one bounded GET using the
same client again received the normal 200 homepage with its application policy.
No provider setting, proxy, user-agent, cookie or credential was changed and
no support message was sent. The root check alone does not replace the final
post-deployment boundary and health checks.

This correction teaches the checker to stop and identify that condition.
Eight synthetic regressions exercise challenges during document, redirect and
preflight checks, cancellation failure, ordinary denial/transport failures and
the full successful response set. Five fail against the preceding checker;
all eight pass after correction. They make no provider requests. Vercel's
[firewall concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts)
explain that challenged traffic is verified at the edge before reaching the
application. A checkpoint response is never counted as application evidence.

The common policy still permits inline scripts on other Next.js document
surfaces. Inline styles and broad HTTPS image/media allowances also remain.
Extending nonces to other pages requires rendering, caching and browser
verification; removing a directive alone could break those pages. No such
unverified application policy change is made here.

Bearer credentials remain readable by same-origin JavaScript. A successful
same-origin script compromise could expose them; the existing CSP, escaping and
authorization controls are not replaced by this checker. Snapshot comparisons
are not a transaction across tabs. CORS does not authenticate requests or stop
non-browser clients.

The local preview remains stopped after automatic approval review rejected its
restart. This step does not start another server or claim new native browser
hydration, inline-script execution, physical-device, real-login or mailbox
coverage. Earlier native-browser evidence remains dated supporting evidence.
The current live checks verify headers and emitted HTML without executing it.
Critical-journey review remains Step 20 scope.

The full automated suite, standalone TypeScript, full lint, production build,
read-only readiness, exact pushed-commit Vercel status and post-release health
remain required for this step. No database, production-record, dependency,
provider-setting, UI or billing change is included.

Final release validation:

On `def7ef5f3eb30cdc2fb6ae0f59b92fd9e34e81b1` plus this step, all **6,851 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 30
read-only readiness checks passed.

Published as `0f5e0c31084dc53d58442202cea7ad6f761e1af0`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5UyvzVyCnUUwncbhTDV5VkZkT8MG).
All 23 deployed browser-boundary checks passed at 2026-09-12 08:58:31 UTC;
health checks passed at 08:58:33 UTC. The automatic edge challenge had cleared
without changing protections. Local and remote main matched; the unrelated
user screenshot was preserved outside the commit. The full receipt remains
`step7-delivery.json` in `D:\Codex\MyDancr-validation-2026-09-11\arch-stability`.
