# Step 8: optional authentication during provider and query failures

## Prerequisite and confirmed issue

Invoice publication was pushed as `f73d48b1fc6b62fd148b0a587076c576b38ce6c5`; its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/3eXdz2Rq966UPh6Nu1t41NuYyfnc) succeeded. Both health routes, protected finance denials and all thirty readiness checks passed at 02:54:50–53 UTC on 2026-09-10. Read-only invoice counts, states, columns and constraints matched the earlier capture. No production billing or real email was invoked.

Going signals, cashier redemption and redemption activity catch all identity/account lookup failures and continue as guests. Analytics and reports also treat returned Auth infrastructure errors as anonymous. A signed-in person's action can consequently be recorded without its account association during an outage. Genuine guests and definitively expired/invalid sessions are intentionally allowed on these public actions.

## Controlled plan

Preserve that guest behavior while distinguishing the existing definitive sign-in-required error from temporary or unknown failures. Keep account lookup failures outside the anonymous fallback. Use the existing request authentication error classification for the two direct Auth lookups, without adding refreshes, retries or new permissions. Verify the actual public actions stop before their primary writes when identity is uncertain, retain verified account IDs and still support guests and expired sessions.

This change does not modify role eligibility, rate limits, attribution, database policies, schema, identity cookies or business data. Account suspension semantics, external side-effect atomicity and optional notification/cleanup acknowledgments remain their separate audit findings. Test with synthetic users/provider failures only; run the complete suite, lint, build, standalone TypeScript and read-only live readiness, then commit/push/deploy/verify before another correction.

## Implementation and focused evidence

The shared request helper now recognizes only definitive sign-in-required failures for anonymous fallback. Returned Auth errors with an unknown status also become a sanitized temporary-unavailable response instead of an expired-session response. Going, cashier redemption and redemption activity restrict their fallback to that definitive case; the latter two perform their account query outside the fallback catch. Analytics and reports retain their direct verified-user lookup and use the same availability classification for returned errors. No new refresh or retry is added.

Sixty-seven new tests execute the actual request helper, four public routes and cashier domain function with synthetic provider/query responses. They cover service/time-limit/rate-limit failures, unknown returned and thrown errors, expired sessions, absent credentials, verified account association, account timeout/permission/cardinality failures, and unchanged account eligibility. Going GET must not return a guest state or set a visitor cookie during an outage. The 124-case focused set passed, including existing request/session, public-input and outage checks.

Against the prior committed source, forty behavior cases failed; one additional new-helper test failed because the helper did not yet exist. All sixty-seven pass after the change. The fixture replaces provider transport, primary write adapters, public-resource checks and rate limiting; it verifies identity/error control flow and does not claim a live RLS, provider fault-injection or financial transaction test. Those independent boundaries retain their existing regression coverage.

## Release validation

Validation on `f73d48b1` passed all 3,957 tests without failures, skips or cancellations, full lint, production build, standalone TypeScript and thirty live readiness checks. The test fixture's reserved variable name was corrected after the first lint run; lint and all 67 focused cases then passed again. Postbuild skipped layout-review population. No schema, provider settings, production account/activity or real email was changed for testing. Exact push, Vercel success and post-deployment health remain required.

The incoming `dc83d703` payout-account reconciliation correction was preserved before release. Final validation on that combined tree passed all 3,991 tests without failures, skips or cancellations, full lint, production build, standalone TypeScript and thirty live readiness checks. This supersedes the earlier full-suite count; the final run includes the fixture-name correction. Exact push and deployment/health verification remain required.
