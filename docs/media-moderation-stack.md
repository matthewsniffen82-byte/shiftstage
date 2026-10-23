# Media moderation backend

The moderation providers are fixed in code:

- `omni-moderation-latest`: image/video-frame safety screening and video caption/transcript screening.
- `gpt-6-astra` through Responses with `service_tier: "ultrafast"`, low reasoning, strict JSON, and `store: false`: content rules, person counting, branding, and avatar crop selection.
- `gpt-transcribe`: completed video audio transcription.

There is no Decisions API or alternate-model fallback. Legacy moderation-model environment overrides are ignored. Existing safety thresholds, upload limits, five-file upload concurrency, and club authorization remain unchanged. Hair-color tagging is a separate feature, not a moderation decision.

## Processing and recovery

The upload saves a durable private record and returns immediately. Its after-response task dispatches the video ID to authenticated `POST /api/cron/video-moderation`. This is a dedicated Vercel Node function invocation running FFmpeg, independent of the upload invocation. It uses the existing deployment, not a separately provisioned persistent server.

`CRON_SECRET` authenticates dispatch. The production origin comes from `NEXT_PUBLIC_SITE_URL`; previews use `VERCEL_URL` and, when configured, `VERCEL_AUTOMATION_BYPASS_SECRET`. Request Host headers cannot set the destination. Redirects are refused. Missing configuration or failed delivery leaves the saved job for existing cron recovery. Atomic claims prevent duplicate processing; worker leases, cancellation and timeout budgets remain in place.

Video checks include ten distributed timeline samples plus up to ten detected scene-change samples. If more scene changes are detected than can be checked, the result remains pending with `video_scene_coverage_incomplete`. This is bounded frame sampling, not analysis of every video frame. Missing audio is allowed; audio decoding/transcription failures cannot silently skip checks.

## Publication

Confirmed violations are rejected. Uncertain completed checks remain private and pending; failed or incomplete checks retain retryable/private states. Neither result publishes media. Club approval still requires a confirmed automated pass, the existing reviewer authorization, and a current record version. Existing approved media is not reprocessed by this migration.

Official API references: [Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode), [GPT-6 migration](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra), [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).
