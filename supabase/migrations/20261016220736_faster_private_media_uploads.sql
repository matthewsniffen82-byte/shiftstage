-- Private staging for direct photo transfers. Only the server issues scoped upload tokens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dancer-photo-uploads', 'dancer-photo-uploads', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/octet-stream']);

create table public.photo_upload_reservations (
  id uuid primary key,
  -- No account FK: expiry cleanup must retain the path after account deletion.
  user_id uuid not null,
  key_hash text not null check (length(key_hash) = 64),
  storage_path text not null unique check (storage_path = user_id::text || '/' || id::text),
  file_size_bytes integer not null check (file_size_bytes between 1 and 26214400),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/octet-stream')),
  intent jsonb not null check (jsonb_typeof(intent) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, key_hash)
);
create index photo_upload_reservations_expiry_idx on public.photo_upload_reservations (expires_at);
alter table public.photo_upload_reservations enable row level security;
revoke all on public.photo_upload_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.photo_upload_reservations to service_role;
-- Even a future permissive storage policy cannot make raw photo uploads readable.
create policy "Raw photo uploads require server access" on storage.objects as restrictive
  for all to anon, authenticated using (bucket_id <> 'dancer-photo-uploads') with check (bucket_id <> 'dancer-photo-uploads');

-- Existing media already passed inspection. Deferred submissions set this flag
-- before acknowledgment; every retry retains it until validated bytes are saved.
alter table public.mydancr_tv_videos add column upload_validation_pending boolean not null default false;
alter table public.mydancr_tv_videos add constraint tv_validated_before_approval
  check (not upload_validation_pending or status <> 'approved');

revoke select (upload_validation_pending), insert (upload_validation_pending), update (upload_validation_pending), references (upload_validation_pending)
  on public.mydancr_tv_videos from public, anon, authenticated;
grant select (upload_validation_pending), insert (upload_validation_pending), update (upload_validation_pending)
  on public.mydancr_tv_videos to service_role;
