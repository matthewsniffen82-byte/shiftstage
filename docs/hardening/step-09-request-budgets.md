# Step 9 — atomic request admission and budgets

Reviewed on `e6f6750692ca4cb2cff702ceb813dfb626193670` at 2026-09-12.
The three existing implementation/test files match the earlier regression
baseline. The current readiness script retains the intervening security checks.
Reproduction dates are retained; final complete-suite validation
covers the current parent plus this change.

The public request limiter used a non-atomic count/insert compatibility path when
the atomic `consume_request_rate_limit` function was unavailable. In a synthetic
twenty-request burst, all twenty requests passed the fallback despite configured
IP and subject limits of five and three. The fallback made sixty table calls and
wrote forty internal throttle rows. This is a reproduced fallback defect, not
evidence that the production RPC is missing.

The correction requires the atomic function. A missing prerequisite
returns a typed, safe 503 response before any legacy table access or protected
mutation. Other returned and uncertain transport failures are not replayed.
Literal `allowed: true` remains required for admission; denials retain the
existing 429 response and bounded Retry-After behavior. Existing HMAC identities,
namespace windows and request budgets are preserved. No historical throttle row
is removed and no SQL or provider configuration is changed.

The read-only readiness script previously inspected four RPC names but did not
include this limiter. Its fifth presence check reads the service's
OpenAPI schema without invoking the function or consuming a rate-limit token.
This establishes interface presence; it does not substitute for concurrency or
privilege testing.

## Regression evidence

The earlier external def7ef5f candidate (2026-09-12 08:35 UTC) includes sixteen
actual-module and report-route cases. They reproduced three failures against
the preceding implementation; all sixteen pass after the correction. Together
with isolated atomic-limit, body-budget, media-request,
client-address, authentication and diagnostic checks, nine selected suites pass
213 tests. Focused lint passes. The fixtures use synthetic providers and rows;
no request reaches production and no real report is submitted.

The report route cannot write a protected report when its prerequisite is
missing; the successful path still writes once. Tests retain the original
uncertain errors, reject malformed RPC decisions and check a normal rate-limit
response's Retry-After value. Isolated PostgreSQL fixtures are separate evidence
from the synthetic application burst and do not establish hosted multi-session
behavior.

## Remaining resource boundaries

Per-namespace admission does not impose a global process memory or provider-call
budget. Public GET caching, the Supabase health probe, SDK response buffering,
moderation retry overlap and active decoder jobs remain separate boundaries.
Steps11,13,18 and21 address those topics. The existing finite JSON/image/video
input limits remain; a time deadline alone does not bound response bytes.

The release evidence below records validation against the current parent and
retains the dates and limitations of the earlier reproductions. Exact deployment
and post-release checks have a separate delivery receipt.

Final release validation:

On `e6f6750692ca4cb2cff702ceb813dfb626193670` plus this step, all **7,312 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 33
read-only readiness checks passed.

The full canonical gate ran on an isolated exact-source snapshot with synthetic
public configuration. All 1,512 source identities matched at integration and
after the normal production-configured shared build. An additional artifact scan
loaded the local deployment configuration to check for private values; it and
postbuild TypeScript passed. Only this report and the ledger then received their
validation-result text. No production record or provider setting changed.

Exact-commit push/deployment and post-release verification are the remaining
delivery checks at publication. Their receipt is retained as `step9-delivery.json`
in `D:\Codex\MyDancr-validation-2026-09-11\arch-stability` after success.
