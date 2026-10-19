begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- Server-only settings. Admin routes authorize writes; public readers return
-- only the relevant color after resolving a valid club/table scope.
create table public.venue_guest_colors (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  internal_accent text check (internal_accent ~ '^#[0-9a-f]{6}$'),
  embed_accent text check (embed_accent ~ '^#[0-9a-f]{6}$'),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.venue_guest_colors enable row level security;
revoke all on public.venue_guest_colors from public, anon, authenticated;
grant select, insert, update on public.venue_guest_colors to service_role;
comment on table public.venue_guest_colors is 'Admin-managed guest colors for table QR and website embeds; no staff/public-app theme changes.';
commit;
