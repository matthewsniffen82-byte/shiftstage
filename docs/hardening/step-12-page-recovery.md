# Step 12 — Page recovery and loading states

Reviewed on `0e8e9b54e885a4d008bd4345199681402687ffc5`. This step adds five previously absent files;
existing account, privacy, publication and database behavior is preserved.

The React app had no application `error.tsx` or `global-error.tsx`. Unexpected
page-render failures therefore used the framework default rather than an
application recovery action. This step supplies a small shared screen with an
explicit retry and a plain home link. The global variant supplies its own
document, mobile viewport and styles so it can render without the root layout. It uses the
existing status-screen colors, spacing and 48-pixel actions.

The fallback does not inspect, display or log the exception, its stack or digest.
Rendering it does not send a request, clear credentials or retry a mutation.
The button calls Next's reset callback only when activated. Reset retries
rendering; it does not guarantee that the underlying problem has gone away.
The home link remains available without a client router dependency.

This follows the installed Next 15 boundary contract and the official
[Next 15 error reference](https://nextjs.org/docs/15/app/api-reference/file-conventions/error).
The custom boundary handles rendering failures. Event handlers, independent
asynchronous failures, API handlers and the separate HTML home shell keep their
existing error handling. It does not add an exception reporting service.

## Preserved loading and navigation behavior

The existing tests exercise public request deadlines including stalled bodies,
transient read retries, failed discovery recovery, stale city/feed responses,
signed-in discovery while saved data is stalled, and dashboard loading states.
Account/session tests preserve refreshed credentials and prevent old responses
from restoring a logged-out or replaced account. Empty-state assertions for
notifications, support, saved data and secondary panels are retained.

No new root loading boundary is added. Existing page and shell loading policies
remain in place; a global streaming change could also change the timing of
status headers. The official [Next 15 loading reference](https://nextjs.org/docs/15/app/api-reference/file-conventions/loading)
describes that behavior. This release does not claim every page, network or
accessibility state has been exercised in a browser.

## Release evidence

The preceding Security step 27 release also resolves the account/venue compensation
finding recorded at the Step 10 boundary. Its checked atomic account routine and
private pause ownership replace the separate compensating writes; retirement of
the old direct service-role write permissions covers older application callers.
The implementation is `8840f2a741dcc83f3929e0e7c17cdd2c97f861ab`, closed by
`0e8e9b54e885a4d008bd4345199681402687ffc5` with
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/2BNxnCquykvtcyypFhNUQbAFmA1S).
Its three SQL applications preserved all 81 existing table fingerprints and Auth
metadata, and passed 41 readiness checks. See the separate
[Security27 report](../security/2026-09-09/step-27-profile-location-privacy.md).
This resolves that database compensation finding; it does not establish a
cross-provider transaction or a hosted email-confirmation journey. Venue owner-ID
privacy remains that task's explicit Step 28 follow-up.

Seven focused cases passed against the final external candidate at
2026-09-12T13:18:30Z. They render the actual fallback, reject exception inspection,
verify explicit-only retries and the global document, and exercise the installed
Next boundary's reset and pathname transition. The initial global draft omitted
its own viewport; the updated document case fails on that draft and passes with
the correction. These are component/framework exercises, not browser fault
injection. The four-file focused lint check also passed. The complete
current-parent release results are recorded below.

The first complete run passed all 7,770 tests and standalone TypeScript, then
full-project lint identified the intentionally native home navigation. The
minimal external tree did not expose that route-aware rule. A single documented
rule exception retains the native anchor so recovery can replace a failed app
document without depending on its client router. No lint rule is disabled
globally, and no retry or rendering behavior changes. The complete gates were
rerun successfully with this final source; the first attempt is retained
in the external `step12-attempt1` evidence directory.

No production fault, account mutation or communication is used to trigger the
screen. The local preview remains stopped following its earlier automatic
approval rejection. Hosted authenticated recovery, screen-reader operation and
device rendering remain unverified; the production build and bounded public
health checks supply the available delivery evidence.

Final release validation:

On `0e8e9b54e885a4d008bd4345199681402687ffc5` plus this step, all **7,770 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 41
read-only readiness checks passed.

Published as `e8586070673d11f48c96be50cd86cebd6ab9ae05`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/H9C1pohZoeoyGbN9FQq573Eu4apP).
Post-release health passed at 2026-09-12T14:02:14.643Z. Local and remote main
matched and both unrelated screenshots were preserved. The complete receipt
is retained as `step12-delivery.json` in the external architecture evidence directory.
