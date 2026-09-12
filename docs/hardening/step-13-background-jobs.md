# Step 13 — Provider deadlines and worker settlement

Reviewed on `d4e472700d6dc5651eb048148b7029b13eb98bce`. The four existing source/test files match
the candidate's earlier `e947a5ed` regression baseline; unrelated intervening
releases remain preserved. Three new helper/test files are added.

The application's moderation timeouts previously stopped waiting without
consistently cancelling the underlying OpenAI operation. The installed SDK also
has its own retry behavior. The correction supplies an AbortSignal and disables
SDK retries for seven existing provider-call paths while retaining their existing
application-level retry and classification rules. The shared deadline remains
active through response-body consumption. A local abort does not prove that a
provider had not already accepted or charged for the request.

The installed OpenAI SDK is 5.23.2. Its default retry and timeout behavior was
checked against the installed code and the official
[TypeScript SDK reference](https://developers.openai.com/api/reference/typescript).
The correction retains the application's existing operation budgets: 12 seconds
for a video-frame request, 20 seconds for image/diagnostic requests and 30 seconds
for audio/text/policy and identity operations. Models, prompts and content policy
decisions do not change.

After a terminal video-frame failure, the worker pool stops assigning additional
frames and awaits active siblings before returning the first failure. This keeps
temporary file cleanup from racing unfinished sibling work. Successful results
retain their ordering and concurrency of three. Transcription also destroys its
input stream in finally, including when the deadline occurs while the SDK is
still preparing multipart input and has not begun its HTTP request.

## Regression evidence

The seven-file external candidate passed 220 focused cases and lint. Sixteen new
cases exercise actual call sites, the installed SDK against synthetic fetch,
stalled connections/bodies, single-attempt provider errors, retained application
retry behavior, frame-worker settlement and multipart input cleanup. Earlier
source failed nine provider cases, one worker case and one audio-input case.
The evidence uses controlled application timers and synthetic streams; it sends
no provider request and reads no credential or private media. A first logging
test harness lacked the new helper dependency; it was connected to the actual
helper without weakening privacy assertions before the focused group passed.

The complete current-parent release gate also passed; its results are recorded
below. The configured private-value artifact scan and postbuild TypeScript
passed as well. Synthetic provider tests do not prove hosted provider behavior.

## Remaining job and recovery boundaries

Per-operation deadlines are not a whole-job budget. Download, FFmpeg, provider,
retry and database work can accumulate beyond a function's execution allowance.
The existing video cron declares 60 seconds for up to two jobs; the image cron can
select five jobs. Those limits and processing stages need their own reconciliation.
This correction must not be described as guaranteeing all jobs finish on time.

The deployed parent `d4e47270` was also checked through Vercel's read-only
[resource table](https://vercel.com/ai-movie-jobs/shiftstage/6ohG5qusg4FSkoQJgGQiM43i2rvP/resources).
It reports a 60-second video-function ceiling and a 300-second image-function
ceiling, both in IAD1 on Node.js 24.x. These are execution limits, not measured
job durations or proof that two video jobs or five image jobs finish within
them. No settings were changed and no job was invoked for this check.

A separate actual-route synthetic reproduction found that a claimed image left
in `moderating` is not reclaimed by the next day's query. Gallery publication
has a review-version fence, but avatar publication does not have an equivalent
complete late-worker fence at this baseline. Automatically reclaiming the old
claim before all publication paths are fenced could let an old worker overwrite
a newer result. No unsafe reclaim or arbitrary production unlock is added.
This concrete crash-recovery finding remains open pending an independently
validated lifecycle release with the complete publication ownership contract.

These remaining findings are separate from the implemented cancellation and
cleanup corrections. No cron invocation, production
claim, paid moderation request or real-user media mutation is used for testing.

Final release validation:

On `d4e472700d6dc5651eb048148b7029b13eb98bce` plus this step, all **8,048 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 51
read-only readiness checks passed.

Published as `a519813ea8211a440e695f62858bbc2896f09846`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/H13p7p12hrw7tgSzaDqtFTMjF9dV).
Post-release health passed at 2026-09-12T15:10:16.842Z. Local and remote main
matched and both unrelated screenshots were preserved. The complete receipt
is retained as `step13-delivery.json` in the external architecture evidence directory.
