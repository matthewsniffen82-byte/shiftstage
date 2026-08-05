-- Private originals for public dancer photos and venue covers.
-- No storage.objects policies are intentionally granted: only the service role can
-- archive or recover these files. Public surfaces receive separately watermarked
-- objects from the existing media buckets.
-- MyDancr TV originals remain in its existing private bucket under __originals/;
-- that prefix cannot satisfy the dancer UUID-based storage policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'dancr-media-originals',
  'dancr-media-originals',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
