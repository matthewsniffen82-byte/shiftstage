-- Moderated venue cover images used by public venue profiles and discovery cards.

alter table public.venues
  add column if not exists cover_image_storage_path text,
  add column if not exists cover_image_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-cover-images',
  'venue-cover-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads venue cover images" on storage.objects;
create policy "public reads venue cover images"
  on storage.objects
  for select
  using (bucket_id = 'venue-cover-images');

drop policy if exists "venue owners manage own cover images" on storage.objects;
create policy "venue owners manage own cover images"
  on storage.objects
  for all
  using (
    bucket_id = 'venue-cover-images'
    and exists (
      select 1
      from public.venues venue
      where venue.owner_user_id = auth.uid()
        and (storage.foldername(name))[1] = venue.id::text
    )
  )
  with check (
    bucket_id = 'venue-cover-images'
    and exists (
      select 1
      from public.venues venue
      where venue.owner_user_id = auth.uid()
        and (storage.foldername(name))[1] = venue.id::text
    )
  );
