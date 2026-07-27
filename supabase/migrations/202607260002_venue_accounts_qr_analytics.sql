-- Venue account ownership, public QR publishing, and first-party venue analytics.

alter table public.venues
  add column if not exists owner_user_id uuid unique references public.app_users(id) on delete set null,
  add column if not exists qr_code_storage_path text,
  add column if not exists qr_code_label text,
  add column if not exists qr_code_updated_at timestamptz;

create index if not exists venues_owner_user_id_idx on public.venues(owner_user_id);

create table if not exists public.venue_page_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  viewer_id uuid references public.app_users(id) on delete set null,
  event_type text not null check (event_type in ('page_view', 'qr_impression')),
  source text not null check (source in ('venue_page', 'dancer_profile')),
  session_id text not null check (length(session_id) between 8 and 120),
  occurred_on date not null default current_date,
  occurred_at timestamptz not null default now(),
  unique (venue_id, event_type, source, session_id, occurred_on)
);

create index if not exists venue_page_events_venue_occurred_idx
  on public.venue_page_events(venue_id, occurred_at desc);

alter table public.venue_page_events enable row level security;

drop policy if exists "public records venue page events" on public.venue_page_events;

drop policy if exists "venue owners read venue analytics" on public.venue_page_events;
create policy "venue owners read venue analytics"
  on public.venue_page_events
  for select
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
    or public.is_admin()
  );

drop policy if exists "venue owners read own venue" on public.venues;
create policy "venue owners read own venue"
  on public.venues
  for select
  using (owner_user_id = auth.uid());

drop policy if exists "venue owners update own venue" on public.venues;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-qr-codes',
  'venue-qr-codes',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads venue qr codes" on storage.objects;
create policy "public reads venue qr codes"
  on storage.objects
  for select
  using (bucket_id = 'venue-qr-codes');

drop policy if exists "venue owners manage own qr codes" on storage.objects;
