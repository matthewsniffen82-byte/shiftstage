-- Dancr storage buckets and access rules.
--
-- Folder convention:
-- dancer-photos/{auth.uid()}/{dancer_id}/{file}
-- verification-documents/{auth.uid()}/verification/{file}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'dancer-photos',
    'dancer-photos',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'verification-documents',
    'verification-documents',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "approved dancer photos are publicly readable" on storage.objects;
drop policy if exists "dancers read own dancer photo files" on storage.objects;
drop policy if exists "dancers upload own dancer photo files" on storage.objects;
drop policy if exists "dancers update own dancer photo files" on storage.objects;
drop policy if exists "dancers delete own dancer photo files" on storage.objects;
drop policy if exists "admins manage dancer photo files" on storage.objects;
drop policy if exists "dancers read own verification files" on storage.objects;
drop policy if exists "dancers upload own verification files" on storage.objects;
drop policy if exists "dancers update own verification files" on storage.objects;
drop policy if exists "dancers delete own verification files" on storage.objects;
drop policy if exists "admins manage verification files" on storage.objects;

create policy "approved dancer photos are publicly readable"
on storage.objects
for select
using (
  bucket_id = 'dancer-photos'
  and exists (
    select 1
    from public.dancer_photos dp
    join public.dancer_profiles d on d.id = dp.dancer_id
    where dp.storage_path = storage.objects.name
      and dp.review_status = 'approved'
      and d.status = 'approved'
  )
);

create policy "dancers read own dancer photo files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dancer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers upload own dancer photo files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dancer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers update own dancer photo files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'dancer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'dancer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers delete own dancer photo files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'dancer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "admins manage dancer photo files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'dancer-photos'
  and public.is_admin()
)
with check (
  bucket_id = 'dancer-photos'
  and public.is_admin()
);

create policy "dancers read own verification files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers upload own verification files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers update own verification files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "dancers delete own verification files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "admins manage verification files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'verification-documents'
  and public.is_admin()
)
with check (
  bucket_id = 'verification-documents'
  and public.is_admin()
);
