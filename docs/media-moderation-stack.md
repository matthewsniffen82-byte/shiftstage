# Human media approval

AI moderation is disabled for dancer photos, avatars, videos, captions, and venue images. Uploads do not call OpenAI moderation, visual review, or speech transcription. Local image cropping, file validation, FFmpeg encoding, thumbnails, responsive images, and watermark preparation remain. Hair-color tagging is a separate feature, not a moderation decision.

## Dancer flow

1. The dancer creates a private profile and uploads media. Basic file checks and preparation run in background jobs. A private avatar preview can appear before approval.
2. Existing identity/age-verification settings and NFC onboarding requirements remain unchanged. For an unaffiliated dancer, media stays private until the first NFC tap routes it to the venue's queue.
3. The club reviews each complete photo and video against MyDancr guidelines. It can reject with a reason or send the item to MyDancr staff. Club signoff does not publish the item.
4. MyDancr staff review the club-approved media and make the final decision. Only final approval publishes media to eligible public, internal, and embedded profiles. Existing profile eligibility, minimum-photo, and check-in requirements still apply.
5. Additional and replacement uploads follow the same two stages. Previously approved media stays visible while its replacement is pending. Replacing an upload invalidates its earlier club signoff.

Owners see "Uploading", followed by "Awaiting final approval" once the server acknowledges the upload. This concise label covers file preparation and both human reviews; the club and MyDancr approval gates are unchanged. Rejected uploads show a reason. Technical failures remain private and retryable. A ready upload cannot be restarted by the owner to bypass or invalidate a human decision.

Club reviewers must check the actual dancer, adult eligibility, rights/consent, solo-person rule, coverage, prohibited content, branding, and contact/payment information. Videos must be watched in full with sound, including their captions. No automated content finding substitutes for either review. Venue images go directly to MyDancr staff, with guidelines appropriate to venue branding.

## Processing and publication controls

The upload records a durable private job and returns promptly. Authenticated background dispatch and existing cron recovery prepare files; atomic claims, cancellation, retries, and timeouts prevent stale jobs from overwriting newer decisions. Legacy endpoint and database names containing "moderation" remain for compatibility; they now perform file preparation only.

Club approval records the reviewer, venue, time, notes, and current upload version. Database guards require club signoff and an active MyDancr admin for final dancer-media approval. Version checks reject stale decisions; uploads remain private throughout. Existing authenticated storage policies protect private originals and pending previews.

Apply `20261023025136_human_media_approval.sql` before deploying the corresponding application changes. The forward migration makes existing private prepared photos eligible for human review and requeues incomplete photos/videos for file preparation. It does not revive rejected media or reprocess published media. In-flight legacy jobs cannot bypass the new publication guard. Existing approved media remains approved.

## Upload experience and timing

Multi-photo selections show centered 9:16 previews with **Keep all crops**, **Adjust individually**, and **Cancel**. Keeping all crops encodes the displayed framing locally when the browser can decode the image; unsupported formats use the existing authenticated preview conversion. Canceled crops never proceed to upload. Individual adjustment retains the existing photo editor.

Photo and video queues share progress rendering and an **X of Y uploaded** count. Counts require a saved server receipt, not just 100% network transfer. A saved notice appears only after the batch has finished and the workspace has no active/unsaved uploads or unsaved profile details. Cancellation remains accessible during transfer. Completed uploads still await human approval.

Video upload logs already record queue, metadata, reservation, transfer, and server submission durations (`mydancr_tv.upload_timing`). Workers now also save numeric stage durations in `mydancr_tv_videos.moderation_details.processingTiming`, including inspection, archive/source work, encoding, poster creation, and total elapsed time. These diagnostics contain no media, filenames, signed URLs, or credentials. Nested stage durations overlap; do not add them to the total.

`node scripts/performance/benchmark-upload-encoding.mjs` measures only the mobile encoding step using a local synthetic clip. On the implementation machine, the two-run mean fell from 764 ms with `medium` to 503 ms with `veryfast` (about 34%). Resolution, CRF, bitrate caps, and the minimum size-saving threshold remain unchanged. This is not a phone-upload or production end-to-end benchmark. Recent human-review production records showed roughly 40 seconds of preparation, but historic transfer timings were unavailable for a direct comparison. Future stage records distinguish processing delays from transfer delays.
