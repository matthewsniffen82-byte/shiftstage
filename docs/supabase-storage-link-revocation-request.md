# Prepared Supabase support request — not sent

Subject: Revoke historical Storage signed URLs after private dancer-media cutover

Project: Dancr (`hfmzwadzabmgxkjzmqun`)

We need to invalidate previously issued Storage signed URLs for `dancer-photos`
and `mydancr-tv-videos` so saved provider links cannot bypass a dancer's current
profile visibility or disabled account state.

At 2026-09-13 approximately 00:49 UTC, both buckets were made private and a
restrictive policy blocked direct browser reads and new browser read signing.
The application now streams media through an endpoint that checks current
database visibility/account state on every request. It no longer issues direct
Storage signed URLs for dancer media. Both bucket cache purges were accepted at
00:49:45 UTC, and the former public object URL was confirmed inaccessible after
the propagation window. Original objects have been preserved.

Your documentation says Storage uses a dedicated internal signing key and that
support is required to revoke signed URLs. Please confirm the supported way to
invalidate all historical read links for these two buckets, including previously
cached signed responses, while preserving stored bytes and authenticated service
access. If revocation must be project-wide, please describe the impact on other
private-document previews and outstanding upload tokens before performing it.

Please provide a confirmation timestamp and any cache-purge follow-up required.
We will then run targeted checks of old-link rejection and current photo/video
delivery. No database password, API key or actual media URL is included here.

Reference:
[Supabase Storage signed URLs](https://supabase.com/docs/guides/storage/serving/downloads)
and [cache invalidation](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache).
