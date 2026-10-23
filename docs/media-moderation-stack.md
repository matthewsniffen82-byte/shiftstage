# Media moderation backend

The moderation providers are fixed in code:

- `omni-moderation-latest`: image/video-frame safety screening and video caption/transcript screening.
- `gpt-6-astra` through Responses with `service_tier: "fast"`, low reasoning, strict JSON, and `store: false`: content rules, person counting, branding, and avatar crop selection.
- `gpt-transcribe`: completed video audio transcription.

There is no Decisions API or alternate-model fallback. Legacy moderation-model environment overrides are ignored. Existing safety thresholds, upload limits, five-file upload concurrency, and club authorization remain unchanged. Hair-color tagging is a separate feature, not a moderation decision.

Photo uploads (including retries) and video reviews use one combined visual request. Each original image/frame is sent once. The response requires separate content, branding, and person-count findings; the existing rules engine still evaluates their individual thresholds. Missing fields, refusal, incomplete output, and provider errors cannot certify an upload. Omni screening runs alongside the combined visual request. Avatar cropping and venue branding remain specialized checks using the same Fast provider configuration.

## Processing and recovery

The upload saves a durable private record and returns immediately. Its after-response task dispatches the video ID to authenticated `POST /api/cron/video-moderation`. This is a dedicated Vercel Node function invocation running FFmpeg, independent of the upload invocation. It uses the existing deployment, not a separately provisioned persistent server.

`CRON_SECRET` authenticates dispatch. The production origin comes from `NEXT_PUBLIC_SITE_URL`; previews use `VERCEL_URL` and, when configured, `VERCEL_AUTOMATION_BYPASS_SECRET`. Request Host headers cannot set the destination. Redirects are refused. Missing configuration or failed delivery leaves the saved job for existing cron recovery. Atomic claims prevent duplicate processing; worker leases, cancellation and timeout budgets remain in place.

Video checks include ten distributed timeline samples plus up to ten detected scene-change samples. If more scene changes are detected than can be checked, the result remains pending with `video_scene_coverage_incomplete`. This is bounded frame sampling, not analysis of every video frame. Missing audio is allowed; audio decoding/transcription failures cannot silently skip checks.

## Publication

Confirmed violations are rejected. Uncertain completed checks remain private and pending; failed or incomplete checks retain retryable/private states. Neither result publishes media. Club approval still requires a confirmed automated pass, the existing reviewer authorization, and a current record version. Existing approved media is not reprocessed by this migration.

## Fast-tier comparison, October 22, 2026

A bounded API-only comparison completed six scenarios for each of the previous split Ultrafast checks, combined Fast, and combined Ultrafast: solo photo, two-person photo, visible contact information, ten-frame solo video, a different person appearing later in a video, and spoken contact information. All three configurations matched the expected decisions in those six cases. Test video inputs were constructed frame sequences; these measurements cover the visual calls only, excluding upload, FFmpeg, Omni, transcription, and human review.

| Configuration | Median visual-call completion | Range | Calculated API charge for the six cases |
| --- | --- | --- | --- |
| Previous split Ultrafast | 2.64 s | 2.26–3.47 s | $4.65 |
| Combined Fast | 3.42 s | 2.69–4.25 s | $0.99 |
| Combined Ultrafast | 2.70 s | 1.96–3.22 s | $2.99 |

Charges use returned input/output/cache token usage and the current published rates, not invoice totals. Fast used about 79% less billed token cost in this small sample; this is not a general accuracy benchmark, throughput benchmark, or latency guarantee. Fast was selected because its measured visual-call times fit comfortably inside the existing 30-second request deadline while reducing repeated image input and tier charges. Additional live unreadable-image and logo comparisons encountered provider 429 insufficient-credit errors; they are not counted as completed comparisons. The first unreadable-image fixture was invalid and was excluded. Local tests cover uncertain/missing findings, logo thresholds, nudity, person counts, cancellation, and private club-review behavior. Exhausted API credits must be restored through OpenAI billing; no fallback can approve media during provider failure.

Official API references: [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode), [pricing](https://developers.openai.com/api/docs/pricing), [GPT-6 migration](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra), [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).
