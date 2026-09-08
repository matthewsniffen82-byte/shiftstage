# Dancer media pins

Owners can pin or unpin approved gallery photos and profile videos. Multiple items can be pinned. Pinned photos precede the existing photo-slot order; pinned videos precede the normal video order. Pins never change the avatar, moderation status, visibility, or ordering in the shared TV feed.

`PATCH /api/dancer/media/pin` requires the authenticated dancer and accepts an explicit `mediaType`, `mediaId`, and boolean `pinned`. The server scopes the update to the dancer derived from the authenticated user and approved media. Videos must have `profile_and_feed` distribution. Retrying the same desired state is idempotent. Browser roles retain no direct update privileges on the media tables.

## Database rollout

Apply `supabase/migrations/202609070006_dancer_media_pins.sql` before deploying this application version. It adds `is_pinned boolean not null default false` to `dancer_photos` and `mydancr_tv_videos`. Existing media begins unpinned; no media, accounts, slots, or policies are deleted or replaced. The migration uses a five-second lock timeout and a transaction.

The migration was applied to production project `hfmzwadzabmgxkjzmqun` on 2026-09-07 and registered as `202609070006 / dancer_media_pins` in `supabase_migrations.schema_migrations`. Verification confirmed both columns are non-null booleans with a false default and that `anon` and `authenticated` cannot directly update either column. No dashboard configuration change remains.

Validation covered owner isolation, moderation and distribution restrictions, repeated pin requests, unpinning, refresh persistence, failure handling, public gallery ordering, and keeping shared-feed ordering unchanged. The complete automated suite, TypeScript checks, lint, production build, and mobile layout checks passed.
