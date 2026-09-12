# Step 6 — API authorization, input and failures

Reviewed against `8725ca85a8d696f50baacc314eff6194dab36fd9` on 2026-09-12;
the final release checks run again on the then-current shared main branch.

## Reproduced correction

The middleware refresh scheduler decoded a JWT payload and read `claims.exp`
without checking the decoded JSON shape. A `null` payload raised a TypeError.
The middleware caught this as an unavailable service and returned 503 before the
route's authoritative authentication could reject the credentials.

`refreshExpiringRequestSession` now requires a non-null, non-array object before
reading scheduling claims. Unsupported payload shapes skip refresh and continue
to normal route authentication. Decoding does not authorize a user. The change
preserves token length and character limits, finite expiry checks, provider
subject matching, bounded provider transport, and private response caching.

Nine synthetic regressions exercise the real helper and actual middleware. The
published baseline passed seven and failed two: the null helper invocation threw,
and middleware returned 503. With the guard all nine pass. No refresh request is
made for invalid scheduling claims, no replacement credential headers are
returned, and the original authorization header reaches the normal verifier.
The middleware's internal pass-through response is not proof of authenticated
access. Independent request-auth tests cover credential rejection.

## Sales-agent input correction

The parallel database review found that the administrator's sales-agent route
silently converted unrecognized or missing status to `active`, invalid depth to
three levels, and malformed sponsor objects to no sponsor. Independent source
review confirmed those substitutions. The application caller,
`AdminSalesAgentPanel.tsx`, already sends an explicit allowed status, numeric
depth and a string or null sponsor.

The route now requires an allowed status and depth of 3 or 5. Canonical strings
`"3"` and `"5"` remain accepted for compatibility. Optional values must be text,
null or omitted; intentional empty sponsor values still clear the link. Invalid
required fields, oversized audit notes and unknown reconciliation outcomes now
produce typed 400 responses before their mutation. Existing administrator
authorization still runs before reading the body. Valid commission rules,
provider actions and database procedures are unchanged.

The 59 route checks execute the actual authentication/admin boundary, HTTP
handler, error policy, and agent-setting/venue-assignment service functions with
instrumented database transport. The preceding published route passed 21 and
failed 38; the fixed route passes all 59. Cases verify intended valid settings,
rejected malformed values without an RPC or reload, verified actor binding,
authorization before body consumption, and one attempt on uncertain database
failure. Three additional cases exercise the HTTP boundary for audit length and
reconciliation outcomes using a synthetic affiliate-action transport; they do
not invoke the NATS provider. The old route and failing logs remain external
evidence, rather than a second implementation in the repository.

## Reviewed boundaries and evidence

| Area | Current behavior and regression evidence |
| --- | --- |
| Verified identity | `createRequestSupabaseContext` creates an isolated client, verifies the provider user and checks server-selected role/active-account requirements against `app_users`. Browser role hints do not grant access. Request availability and professional-role tests cover rejection and database failure. |
| Administrator and venue access | Administrator routes retain the active administrator boundary. The admin denial suite executes discovered handlers with synthetic identities before privileged work. Venue access checks active ownership or permitted staff membership; its boundary suite asserts use and implementation of the shared guard in source. The route inventory detects missing explicit guards. |
| Resource identifiers | Customer writes validate public targets; schedule and venue references must be related. Privileged video changes repeat ownership in their final update. IDOR regressions combine source-order assertions with executable synthetic query cases for cross-venue, cross-dancer and unavailable targets. |
| Public and privileged operations | Service-role routes have a maintained classification. Cron workers authorize before privileged work, and Stripe retains signature verification. Public exceptions require their own documented token, resource, rate or submission contracts. Inventory assertions alone do not prove every runtime branch. |
| Optional authentication | Only a definitive missing/invalid sign-in permits the documented guest flow. Unknown provider and database failures return unavailable and stop before writes. Real helper/route regressions retain this distinction. |
| Request bodies | The bounded JSON reader checks declared and streamed bytes, cancels excess input, rejects malformed UTF-8 and requires an object. It distinguishes malformed input (400) from excess size (413). These byte bounds do not themselves impose a stream deadline; request budgets remain Step 9 scope. |
| Failure responses | Typed public errors retain controlled status/message/code. Unexpected database/provider details use fixed public fallbacks. Retryable infrastructure failures remain 503 rather than being presented as an expired session. Error-safety and outage tests exercise these paths. |

The original focused group passed **644 tests**, including on Node 24.21.0: the new refresh cases, Supabase outage
reliability, request-auth availability, optional-auth query errors, professional
roles, API error safety, bounded JSON input, service-role inventory, IDOR,
administrator and venue authorization. Together with the 59 sales-agent cases,
the integrated focused group passes **703 tests** and focused lint passes.
Existing detailed authorization and
optional-auth reports remain supporting historical evidence; this report does
not replace synthetic tests with claims of fresh provider configuration review.

## Delivery and limits

This step repairs malformed-input handling in the session scheduler and
sales-agent HTTP route, and adds their regressions and review record. It changes
no valid role or commission policy, migration, provider configuration or
production row. No automatic write retry is introduced. The database task's
separate agent-hierarchy correction remains outside this release.

Full tests, standalone TypeScript, full lint, production build, read-only
readiness and exact-commit deployment verification are required before this
step's delivery receipt is marked complete. Results are retained under
`D:\Codex\MyDancr-validation-2026-09-11\arch-stability`.

No disposable hosted accounts were designated; this is not a new exhaustive
live role matrix or cross-account penetration test. Browser storage and token
exposure remain Step 7 scope, and partial writes remain Step 10 scope. The local
preview remains stopped following automatic approval review's restart rejection.

Final validation on `77ea0eb48d3de3a1b65c87fdca8e5754fb6d1579` plus this step passed all
**6,721 tests**, with no failures, skips, cancellations or todo, standalone
TypeScript, full zero-warning lint and the production build. Node 24.21.0 and the
verified native decoder passed the pretest/prebuild runtime checks. The build
retained compilation and type validation; its duplicate lint pass was omitted
after full standalone lint. Postbuild confirmed
`LAYOUT_REVIEW_POPULATION_SKIPPED`. All 30 read-only readiness checks passed.

Published as `b0f3ac2950b934793c07c9b63a32ecbf849727e1`, with [exact-commit Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5JHGBMZtCdFFkMstAtWrehtYvvJ5). At 2026-09-12T07:09:49.262Z the checkout was clean and local main, origin/main and the remote matched. Public root and both health endpoints passed; anonymous administrator monitoring remained 401. The final receipt is `D:\Codex\MyDancr-validation-2026-09-11\arch-stability\step6-delivery.json`.
