-- Venue-initiated Club Deal requests. MyDancr remains the only publisher and
-- contract-fee authority; this table is an auditable request inbox only.

create table if not exists public.venue_club_deal_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  requested_by_user_id uuid references public.app_users(id) on delete set null,
  offer_key text not null check (offer_key in ('half_off_admission', 'skip_the_line')),
  offer_title text not null check (offer_title in ('Half-off admission', 'Skip the line')),
  request_notes text check (request_notes is null or char_length(request_notes) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'approved', 'rejected', 'withdrawn')),
  linked_deal_id uuid references public.club_deals(id) on delete set null,
  reviewed_by_admin_user_id uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'under_review') and reviewed_at is null)
    or
    (status in ('approved', 'rejected', 'withdrawn') and reviewed_at is not null)
  )
);

create index if not exists venue_club_deal_requests_venue_created_idx
  on public.venue_club_deal_requests (venue_id, created_at desc);
create index if not exists venue_club_deal_requests_status_created_idx
  on public.venue_club_deal_requests (status, created_at desc);

alter table public.venue_club_deal_requests enable row level security;

drop policy if exists "Admins manage venue Club Deal requests" on public.venue_club_deal_requests;
create policy "Admins manage venue Club Deal requests"
  on public.venue_club_deal_requests for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue teams read own Club Deal requests" on public.venue_club_deal_requests;
create policy "Venue teams read own Club Deal requests"
  on public.venue_club_deal_requests for select
  using (
    exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.venue_team_members member
      where member.venue_id = venue_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );

create or replace function public.touch_venue_club_deal_request_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists venue_club_deal_requests_touch_updated_at on public.venue_club_deal_requests;
create trigger venue_club_deal_requests_touch_updated_at
  before update on public.venue_club_deal_requests
  for each row execute function public.touch_venue_club_deal_request_updated_at();

grant select, insert, update, delete on public.venue_club_deal_requests to service_role;
