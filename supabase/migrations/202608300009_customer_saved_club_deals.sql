begin;

create table if not exists public.customer_deal_saves (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  club_deal_id uuid not null references public.club_deals(id) on delete cascade,
  source_type text not null default 'club_page' check (source_type in ('club_page', 'dancer_profile')),
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (customer_id, club_deal_id)
);

create index if not exists customer_deal_saves_deal_idx
  on public.customer_deal_saves (club_deal_id, created_at desc);

alter table public.customer_deal_saves enable row level security;

revoke all on table public.customer_deal_saves from anon;
revoke update on table public.customer_deal_saves from authenticated;
grant select, insert, delete on table public.customer_deal_saves to authenticated;

drop policy if exists "customers read own saved club deals" on public.customer_deal_saves;
create policy "customers read own saved club deals"
on public.customer_deal_saves
for select
to authenticated
using (customer_id = auth.uid());

drop policy if exists "customers save own club deals" on public.customer_deal_saves;
create policy "customers save own club deals"
on public.customer_deal_saves
for insert
to authenticated
with check (
  customer_id = auth.uid()
  and exists (
    select 1
    from public.app_users as account
    where account.id = auth.uid()
      and account.role = 'customer'
      and account.account_state = 'active'
  )
  and exists (
    select 1
    from public.club_deals as deal
    join public.venues as venue on venue.id = deal.venue_id
    where deal.id = club_deal_id
      and deal.is_active = true
      and venue.is_active = true
  )
);

drop policy if exists "customers remove own saved club deals" on public.customer_deal_saves;
create policy "customers remove own saved club deals"
on public.customer_deal_saves
for delete
to authenticated
using (customer_id = auth.uid());

comment on table public.customer_deal_saves is
  'Private customer bookmarks for Club Deals. Saving never reserves, selects, or redeems an offer.';

commit;
