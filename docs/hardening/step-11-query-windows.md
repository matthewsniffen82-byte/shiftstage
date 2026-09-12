# Step 11 — Query windows, caching and generated assets

The public dancer profile previously limited its embedded shifts to 50 before
filtering dates for display. An account with enough historical rows could lose
an upcoming date from its profile. The corrected query filters posted dates,
checkout state, scheduled end or active confirmed presence, and visible venues
before applying the existing 50-row limit. Starts and identifiers provide stable
ordering. A public profile with no visible dates remains available.

This preserves the current presence helper's definition, including confirmed
check-ins whose scheduled end has passed. It changes both existing schema
branches consistently. A separate Security review owns retirement of legacy
privacy fallbacks; that work has not been released at this step's boundary.

## Query evidence and limits

The nine new tests execute the actual profile, card and presence helpers through
the installed Supabase SDK with synthetic responses. Seven failed on the prior
query. Cases cover old history hiding the next date, active presence, excluded
dates consuming the window, an empty profile, deterministic ordering and query
failure. The focused seven-suite group passed 39 tests in the external candidate.
The first complete gate then passed 7,364 tests and found one older alias
fixture missing the new query methods. Its corrected adapter retains the alias
and privacy assertions and checks the same window for both alias lookups.
Both focused files then passed all 16 tests, and the complete gate passed again
as recorded below.

The external candidate's earlier generated-asset fixture failure was corrected by running the
existing generators in that isolated archive; no application rule was weakened.

At 2026-09-12 12:12 UTC, a single read-only request sent the actual SDK's emitted
embedding and filter query to hosted PostgREST using the application's server
role, with an additional zero-parent-row limit. It returned HTTP 200 and zero
rows. This verifies supported syntax and the current schema without reading
profile data. It does not replace the synthetic date-selection regressions or
claim a hosted history fixture. The source baseline is reconciled against the
exact Step 10 release before integration. No SQL or production records change.

Directory queries still embed child history. Their total bytes and pagination
remain Step 21 review items; this profile window does not bound every query.

## Existing network and cache behavior retained

The Supabase transport gives database/Auth requests a 15-second deadline and
Storage requests 120 seconds, covers response bodies and combines cancellation.
It does not replay mutations; uncertain Auth server failures map to the existing
unavailable response to avoid implicit refresh retries. It currently buffers the
response body without a byte ceiling, an explicit Step 21 resource finding.

Public dynamic JSON uses a 10-second fresh window and 20-second stale allowance;
city metadata uses 60 seconds and 300 seconds. Personalized following-TV responses
remain private and uncached. This means publication changes are not guaranteed
to become visible instantly through public caches. Existing public cache and
fetching tests are retained; no cache policy or product freshness rule changes.

Static CSS/JS/SVG versions hash normalized text; other assets hash their bytes.
Exact current version URLs receive immutable caching, while unversioned assets
must revalidate. Pretest and prebuild regenerate the shell and asset manifests.
The existing consistency tests and complete release gate verify those outputs,
including the independently delivered profile spacing changes. Unknown versions
are not newly granted immutable caching by this step.

The canonical production build and explicit environment-loaded private-value
artifact scan passed. Browser navigation, authenticated
journeys and production load tests are not claimed by this query correction.
The final delivery receipt will identify the exact successful commit and health
checks; the local preview remains stopped.

Final release validation:

On `0ac237ee6a0d99f30a58b711d6fa802b9d8ee8f1` plus this step, all **7,365 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 33
read-only readiness checks passed.

Published as `104b221da2417f58fc1f60dd710c1d9db21229e0`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/F5EMcpzuXxq1jd1BnUYpLzDBrami).
Post-release health passed at 2026-09-12T12:32:48.013Z. Local and remote main
matched and both unrelated screenshots were preserved. The complete receipt
is retained as `step11-delivery.json` in the external architecture evidence directory.
