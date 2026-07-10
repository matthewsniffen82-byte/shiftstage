-- Dancr automatic image moderation records, private buckets, and access rules.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'dancr-image-moderation-temp',
    'dancr-image-moderation-temp',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'dancr-image-moderation-review',
    'dancr-image-moderation-review',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.image_moderation_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_id uuid null references public.dancer_photos(id) on delete set null,
  temporary_storage_path text null,
  final_storage_path text null,
  upload_context text not null,
  provider text not null default 'openai',
  provider_model text not null,
  provider_flagged boolean not null default false,
  decision text not null check (decision in ('approved', 'review', 'rejected')),
  status text not null check (status in ('pending', 'completed', 'error')),
  reason_codes jsonb not null default '[]'::jsonb,
  category_flags jsonb not null default '{}'::jsonb,
  category_scores jsonb not null default '{}'::jsonb,
  error_code text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  review_decision text null check (review_decision is null or review_decision in ('approved', 'rejected')),
  review_notes text null,
  idempotency_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists image_moderation_records_user_idempotency_idx
  on public.image_moderation_records(user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists image_moderation_records_decision_idx on public.image_moderation_records(decision);
create index if not exists image_moderation_records_status_idx on public.image_moderation_records(status);
create index if not exists image_moderation_records_created_at_idx on public.image_moderation_records(created_at desc);
create index if not exists image_moderation_records_user_id_idx on public.image_moderation_records(user_id);
create index if not exists image_moderation_records_reviewed_at_idx on public.image_moderation_records(reviewed_at desc);

alter table public.image_moderation_records enable row level security;

drop policy if exists "users read own moderation status" on public.image_moderation_records;
drop policy if exists "users insert own moderation shell" on public.image_moderation_records;
drop policy if exists "admins manage image moderation" on public.image_moderation_records;

create policy "users read own moderation status"
on public.image_moderation_records
for select
to authenticated
using (user_id = auth.uid());

create policy "users insert own moderation shell"
on public.image_moderation_records
for insert
to authenticated
with check (
  user_id = auth.uid()
  and provider = 'openai'
  and reviewed_by is null
  and reviewed_at is null
  and review_decision is null
);

create policy "admins manage image moderation"
on public.image_moderation_records
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage moderation temp files" on storage.objects;
drop policy if exists "admins manage moderation review files" on storage.objects;

create policy "admins manage moderation temp files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'dancr-image-moderation-temp'
  and public.is_admin()
)
with check (
  bucket_id = 'dancr-image-moderation-temp'
  and public.is_admin()
);

create policy "admins manage moderation review files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'dancr-image-moderation-review'
  and public.is_admin()
)
with check (
  bucket_id = 'dancr-image-moderation-review'
  and public.is_admin()
);

-- Schedule a Supabase Edge Function or external job to delete stale objects from
-- dancr-image-moderation-temp after 24 hours. Do not delete unresolved records
-- whose decision remains 'review'.
