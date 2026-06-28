create table if not exists public.club_deals (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  deal_title text not null,
  deal_description text not null default '',
  deal_terms text,
  is_active boolean not null default true,
  valid_days text[],
  valid_start_time time,
  valid_end_time time,
  redemption_rules jsonb not null default '{}'::jsonb,
  payout_type text not null default 'none' check (payout_type in ('none', 'flat', 'percent')),
  payout_amount_cents integer not null default 0 check (payout_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qr_redemptions (
  id uuid primary key default gen_random_uuid(),
  redemption_token text not null unique,
  venue_id uuid not null references public.venues(id) on delete cascade,
  club_deal_id uuid not null references public.club_deals(id) on delete cascade,
  source_type text not null check (source_type in ('club_page', 'dancer_profile')),
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  customer_id uuid references auth.users(id) on delete set null,
  session_id text,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_club_user uuid references auth.users(id) on delete set null,
  status text not null default 'generated' check (status in ('generated', 'redeemed', 'expired', 'voided')),
  ip_address text,
  user_agent text,
  device_fingerprint text,
  audit jsonb not null default '{}'::jsonb,
  suspicious boolean not null default false,
  voided_at timestamptz,
  voided_by_admin uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.commission_events (
  id uuid primary key default gen_random_uuid(),
  qr_redemption_id uuid not null unique references public.qr_redemptions(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  club_deal_id uuid not null references public.club_deals(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  status text not null default 'pending_club_payment' check (status in ('pending_club_payment', 'payable', 'paid', 'rejected', 'voided')),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  payout_type text not null default 'none' check (payout_type in ('none', 'flat', 'percent')),
  club_payment_received_at timestamptz,
  payable_at timestamptz,
  paid_at timestamptz,
  rejected_at timestamptz,
  voided_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists club_deals_venue_active_idx on public.club_deals(venue_id, is_active);
create index if not exists qr_redemptions_deal_status_idx on public.qr_redemptions(club_deal_id, status);
create index if not exists qr_redemptions_dancer_status_idx on public.qr_redemptions(dancer_id, status) where dancer_id is not null;
create index if not exists qr_redemptions_generated_idx on public.qr_redemptions(generated_at desc);
create index if not exists commission_events_dancer_status_idx on public.commission_events(dancer_id, status);
create index if not exists commission_events_venue_status_idx on public.commission_events(venue_id, status);

alter table public.club_deals enable row level security;
alter table public.qr_redemptions enable row level security;
alter table public.commission_events enable row level security;

drop policy if exists "Active club deals are public" on public.club_deals;
create policy "Active club deals are public"
  on public.club_deals
  for select
  using (is_active = true);

drop policy if exists "Admins manage club deals" on public.club_deals;
create policy "Admins manage club deals"
  on public.club_deals
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manage qr redemptions" on public.qr_redemptions;
create policy "Admins manage qr redemptions"
  on public.qr_redemptions
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Dancers view own attributed redemptions" on public.qr_redemptions;
create policy "Dancers view own attributed redemptions"
  on public.qr_redemptions
  for select
  using (
    dancer_id in (
      select id from public.dancer_profiles where user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage commission events" on public.commission_events;
create policy "Admins manage commission events"
  on public.commission_events
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Dancers view own commission events" on public.commission_events;
create policy "Dancers view own commission events"
  on public.commission_events
  for select
  using (
    dancer_id in (
      select id from public.dancer_profiles where user_id = auth.uid()
    )
  );

insert into public.club_deals (venue_id, deal_title, deal_description, deal_terms, redemption_rules, payout_type, payout_amount_cents)
select
  v.id,
  'Tonight''s venue offer',
  'Show this QR at the venue for the current Dancr offer.',
  'Offer is subject to venue availability and house rules.',
  '{"one_per_guest": true, "club_scan_required": true}'::jsonb,
  'none',
  0
from public.venues v
where v.is_active = true
  and not exists (
    select 1 from public.club_deals d where d.venue_id = v.id
  );
