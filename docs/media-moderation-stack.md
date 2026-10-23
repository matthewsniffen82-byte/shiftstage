# Human media approval

AI moderation is disabled for dancer photos, avatars, videos, captions, and venue images. Uploads do not call OpenAI moderation, visual review, or speech transcription. Local image cropping, file validation, FFmpeg encoding, thumbnails, responsive images, and watermark preparation remain. Hair-color tagging is a separate feature, not a moderation decision.

## Dancer flow

1. The dancer creates a private profile and uploads media. Basic file checks and preparation run in background jobs. A private avatar preview can appear before approval.
2. Existing identity/age-verification settings and NFC onboarding requirements remain unchanged. For an unaffiliated dancer, media stays private until the first NFC tap routes it to the venue's queue.
3. The club reviews each complete photo and video against MyDancr guidelines. It can reject with a reason or send the item to MyDancr staff. Club signoff does not publish the item.
4. MyDancr staff review the club-approved media and make the final decision. Only final approval publishes media to eligible public, internal, and embedded profiles. Existing profile eligibility, minimum-photo, and check-in requirements still apply.
5. Additional and replacement uploads follow the same two stages. Previously approved media stays visible while its replacement is pending. Replacing an upload invalidates its earlier club signoff.

Owners see separate "Waiting for Club approval" and "Waiting for MyDancr approval" states. Rejected uploads show a reason. Technical failures remain private and retryable. A ready upload cannot be restarted by the owner to bypass or invalidate a human decision.

Club reviewers must check the actual dancer, adult eligibility, rights/consent, solo-person rule, coverage, prohibited content, branding, and contact/payment information. Videos must be watched in full with sound, including their captions. No automated content finding substitutes for either review. Venue images go directly to MyDancr staff, with guidelines appropriate to venue branding.

## Processing and publication controls

The upload records a durable private job and returns promptly. Authenticated background dispatch and existing cron recovery prepare files; atomic claims, cancellation, retries, and timeouts prevent stale jobs from overwriting newer decisions. Legacy endpoint and database names containing "moderation" remain for compatibility; they now perform file preparation only.

Club approval records the reviewer, venue, time, notes, and current upload version. Database guards require club signoff and an active MyDancr admin for final dancer-media approval. Version checks reject stale decisions; uploads remain private throughout. Existing authenticated storage policies protect private originals and pending previews.

Apply `20261023025136_human_media_approval.sql` before deploying the corresponding application changes. The forward migration makes existing private prepared photos eligible for human review and requeues incomplete photos/videos for file preparation. It does not revive rejected media or reprocess published media. In-flight legacy jobs cannot bypass the new publication guard. Existing approved media remains approved.
