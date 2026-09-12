# Step 14 — Monitoring certainty and diagnostics

Reviewed on `6f1a9048139a5c01125f3b11046feb0c21b1e3bf`. The two current function spans match the
earlier `19ca1b42` regression baseline; narrow replacements preserve other changes.
Singular/plural labels and the recent-activity description are also corrected.
The focused assertions were updated for the visible grammar and rerun on this
integration: all 25 passed, with focused zero-warning lint.

The monitoring table-count helper previously treated a missing count as zero.
The corrected helper accepts only a nonnegative safe integer and an acknowledged
successful query. Missing, null, malformed, negative and nonfinite values return
an unavailable result with no count. Database error details remain private and
are reduced to the existing safe metadata logging contract.

The compact admin summary also read obsolete success/error fields. The correction
uses the current API's explicit `ok` flags and distinguishes unavailable,
malformed, empty, failed and successful checks. Missing results do not produce a
healthy indicator. Existing operational warnings remain visible. Successful
integration-setting checks are described as settings checks, not proof that
external providers are reachable or that messages and payments were delivered.

The existing monitoring route authenticates the request and requires an active
administrator before creating its service client. The reviewed status service
counts six fixed application tables in parallel and returns configuration-key
names and booleans without their values. The shared diagnostic helper accepts
bounded operational tokens and HTTP statuses and omits messages, stacks and
response bodies. These source observations were reconciled with the actual
release parent; no new privilege or logging channel is part of the correction.

The 25 focused cases execute the actual selected helper/component functions and
ReactDOM rendering with synthetic data. Twenty failed on the previous source;
all 25 passed after correction, with focused lint. These are not a hosted admin
session or a live provider outage experiment. Complete current-parent release
validation is recorded below.

The narrow integration changes `countTable`, `SystemHealthSummary`, its missing
monitoring label and the associated test. Preserve all independently delivered
account, venue, publication, privacy and other admin behavior around those spans.

No new exception service, alert recipient, background monitor or paid integration
is introduced. The existing liveness/readiness probes and exact deployment checks
remain separate operational signals. Alert delivery and a real authenticated
monitoring journey have not been exercised; a passing test or settings indicator
must not be presented as proof that an operator will receive an alert.

Final release validation:

On `6f1a9048139a5c01125f3b11046feb0c21b1e3bf` plus this step, all **8,841 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 58
read-only readiness checks passed.

Exact-commit push/deployment and post-release verification are the remaining
delivery checks at publication. Their receipt is retained as `step14-delivery.json`
in `D:\Codex\MyDancr-validation-2026-09-11\arch-stability` after success.
