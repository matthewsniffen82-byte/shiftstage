-- Dancr initial production schema
-- Run this in Supabase SQL editor or through Supabase migrations.

create extension if not exists pgcrypto;

create type public.user_role as enum ('customer', 'dancer', 'venue', 'admin');
create type public.dancer_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'disabled');
create type public.shift_status as enum ('draft', 'posted', 'cancelled', 'completed');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.social_platform as enum ('instagram', 'tiktok', 'snapchat', 'x', 'onlyfans');
create type public.notification_channel as enum ('in_app', 'push', 'email');
create type public.notification_type as enum (
  'shift_posted',
  'shift_updated',
  'shift_cancelled',
  'ranking_milestone',
  'approval_status',
  'weekly_summary'
);
create type public.account_state as enum ('active', 'disabled', 'deleted');

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null,
  display_name text,
  email text,
  account_state public.account_state not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  city text not null default 'Las Vegas',
  notification_settings jsonb not null default '{
    "followedDancersOnly": true,
    "followedVenuesOnly": true,
    "anyDancerInCity": false,
    "workingTonight": true,
    "newShifts": true,
    "venueSchedules": true,
    "clubChanges": true,
    "cancelledShifts": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dancer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.app_users(id) on delete cascade,
  real_name text not null,
  stage_name text not null,
  slug text not null unique,
  city text not null default 'Las Vegas',
  bio text,
  status public.dancer_status not null default 'draft',
  verification_status public.review_status not null default 'pending',
  photo_review_status public.review_status not null default 'pending',
  approved_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dancer_profiles_stage_name_check check (length(trim(stage_name)) >= 2)
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city text not null,
  state text,
  address text,
  phone text,
  website text,
  timezone text not null default 'America/Los_Angeles',
  opens_at time,
  closes_at time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dancer_photos (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order int not null default 0,
  is_primary boolean not null default false,
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.social_links (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  platform public.social_platform not null,
  handle text not null,
  url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dancer_id, platform)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Los_Angeles',
  status public.shift_status not null default 'posted',
  broadcast_sent_at timestamptz,
  broadcast_recipients int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_end_after_start check (ends_at > starts_at)
);

create table public.follows (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (customer_id, dancer_id)
);

create table public.venue_follows (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (customer_id, venue_id)
);

create table public.going_signals (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, shift_id)
);

create table public.favorites (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, dancer_id)
);

create table public.profile_views (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  viewer_id uuid references public.app_users(id) on delete set null,
  viewed_at timestamptz not null default now(),
  source text,
  session_id text
);

create table public.schedule_views (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  viewer_id uuid references public.app_users(id) on delete set null,
  viewed_at timestamptz not null default now(),
  session_id text
);

create table public.direction_requests (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  venue_id uuid not null references public.venues(id) on delete cascade,
  requester_id uuid references public.app_users(id) on delete set null,
  requested_at timestamptz not null default now(),
  session_id text
);

create table public.social_clicks (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  platform public.social_platform not null,
  clicker_id uuid references public.app_users(id) on delete set null,
  clicked_at timestamptz not null default now(),
  session_id text
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null unique references public.dancer_profiles(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'not_started',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approval_reviews (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  reviewer_id uuid references public.app_users(id) on delete set null,
  review_type text not null,
  status public.review_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  notification_type public.notification_type not null,
  channel public.notification_channel not null default 'in_app',
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.trending_scores (
  dancer_id uuid primary key references public.dancer_profiles(id) on delete cascade,
  city text not null,
  score numeric(12,2) not null default 0,
  rank int,
  previous_rank int,
  highest_rank int,
  best_rank_this_week int,
  trend text not null default 'stable',
  calculated_at timestamptz not null default now()
);

create table public.ranking_events (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  city text not null,
  event_type text not null,
  old_rank int,
  new_rank int,
  message text not null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.app_users(id) on delete set null,
  target_type text not null,
  target_id uuid,
  action text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index dancer_profiles_status_city_idx on public.dancer_profiles(status, city);
create index shifts_dancer_starts_idx on public.shifts(dancer_id, starts_at);
create index shifts_venue_starts_idx on public.shifts(venue_id, starts_at);
create index profile_views_dancer_viewed_idx on public.profile_views(dancer_id, viewed_at desc);
create index schedule_views_dancer_viewed_idx on public.schedule_views(dancer_id, viewed_at desc);
create index direction_requests_dancer_requested_idx on public.direction_requests(dancer_id, requested_at desc);
create index social_clicks_dancer_clicked_idx on public.social_clicks(dancer_id, clicked_at desc);
create index notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index trending_scores_city_rank_idx on public.trending_scores(city, rank);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid()
      and role = 'admin'
      and account_state = 'active'
  );
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_users where id = auth.uid();
$$;

create or replace view public.public_dancer_profiles as
select
  dp.id,
  dp.stage_name,
  dp.slug,
  dp.city,
  dp.bio,
  dp.approved_at,
  ts.rank,
  ts.score,
  ts.trend
from public.dancer_profiles dp
left join public.trending_scores ts on ts.dancer_id = dp.id
where dp.status = 'approved';

create or replace view public.dancer_monthly_impact as
select
  dp.id as dancer_id,
  count(distinct pv.id) filter (where pv.viewed_at >= now() - interval '30 days') as profile_views_30d,
  count(distinct sv.id) filter (where sv.viewed_at >= now() - interval '30 days') as schedule_views_30d,
  count(distinct dr.id) filter (where dr.requested_at >= now() - interval '30 days') as direction_requests_30d,
  count(distinct sc.id) filter (where sc.clicked_at >= now() - interval '30 days') as social_clicks_30d,
  count(distinct gs.shift_id) filter (where gs.created_at >= now() - interval '30 days') as going_signals_30d,
  count(distinct f.customer_id) filter (where f.created_at >= now() - interval '30 days') as followers_gained_30d
from public.dancer_profiles dp
left join public.profile_views pv on pv.dancer_id = dp.id
left join public.schedule_views sv on sv.dancer_id = dp.id
left join public.direction_requests dr on dr.dancer_id = dp.id
left join public.social_clicks sc on sc.dancer_id = dp.id
left join public.shifts sh on sh.dancer_id = dp.id
left join public.going_signals gs on gs.shift_id = sh.id
left join public.follows f on f.dancer_id = dp.id
group by dp.id;

alter table public.app_users enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.dancer_profiles enable row level security;
alter table public.venues enable row level security;
alter table public.dancer_photos enable row level security;
alter table public.social_links enable row level security;
alter table public.shifts enable row level security;
alter table public.follows enable row level security;
alter table public.venue_follows enable row level security;
alter table public.going_signals enable row level security;
alter table public.favorites enable row level security;
alter table public.profile_views enable row level security;
alter table public.schedule_views enable row level security;
alter table public.direction_requests enable row level security;
alter table public.social_clicks enable row level security;
alter table public.subscriptions enable row level security;
alter table public.approval_reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.trending_scores enable row level security;
alter table public.ranking_events enable row level security;
alter table public.admin_actions enable row level security;

create policy "users read own profile" on public.app_users for select using (id = auth.uid() or public.is_admin());
create policy "users update own profile" on public.app_users for update using (id = auth.uid()) with check (id = auth.uid());

create policy "customers manage own profile" on public.customer_profiles for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "approved dancers are public" on public.dancer_profiles for select using (status = 'approved' or user_id = auth.uid() or public.is_admin());
create policy "dancers update own draft profile" on public.dancer_profiles for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "dancers create own profile" on public.dancer_profiles for insert with check (user_id = auth.uid() or public.is_admin());

create policy "active venues are public" on public.venues for select using (is_active = true or public.is_admin());
create policy "admins manage venues" on public.venues for all using (public.is_admin()) with check (public.is_admin());

create policy "approved photos are public" on public.dancer_photos for select using (
  review_status = 'approved'
  or exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);
create policy "dancers manage own photos" on public.dancer_photos for all using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
) with check (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);

create policy "approved social links are public" on public.social_links for select using (
  is_active = true
  and exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.status = 'approved')
  or exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);
create policy "dancers manage own social links" on public.social_links for all using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
) with check (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);

create policy "posted approved shifts are public" on public.shifts for select using (
  status = 'posted'
  and exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.status = 'approved')
  or exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);
create policy "approved dancers manage own shifts" on public.shifts for all using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid() and dp.status = 'approved')
  or public.is_admin()
) with check (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid() and dp.status = 'approved')
  or public.is_admin()
);

create policy "customers manage own follows" on public.follows for all using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());
create policy "customers manage own venue follows" on public.venue_follows for all using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());
create policy "customers manage own going signals" on public.going_signals for all using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());
create policy "customers manage own favorites" on public.favorites for all using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());

create policy "insert public profile views" on public.profile_views for insert with check (true);
create policy "insert public schedule views" on public.schedule_views for insert with check (true);
create policy "insert public direction requests" on public.direction_requests for insert with check (true);
create policy "insert public social clicks" on public.social_clicks for insert with check (true);

create policy "dancers read own analytics" on public.profile_views for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "dancers read own schedule analytics" on public.schedule_views for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "dancers read own direction analytics" on public.direction_requests for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "dancers read own social analytics" on public.social_clicks for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);

create policy "dancers read own subscription" on public.subscriptions for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "admins manage subscriptions" on public.subscriptions for all using (public.is_admin()) with check (public.is_admin());

create policy "dancers read own reviews" on public.approval_reviews for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "admins manage reviews" on public.approval_reviews for all using (public.is_admin()) with check (public.is_admin());

create policy "users read own notifications" on public.notifications for select using (recipient_id = auth.uid() or public.is_admin());
create policy "users update own notifications" on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "admins create notifications" on public.notifications for insert with check (public.is_admin());

create policy "approved rankings are public" on public.trending_scores for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.status = 'approved')
  or exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid())
  or public.is_admin()
);
create policy "admins manage rankings" on public.trending_scores for all using (public.is_admin()) with check (public.is_admin());

create policy "dancers read own ranking events" on public.ranking_events for select using (
  exists (select 1 from public.dancer_profiles dp where dp.id = dancer_id and dp.user_id = auth.uid()) or public.is_admin()
);
create policy "admins manage ranking events" on public.ranking_events for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage admin actions" on public.admin_actions for all using (public.is_admin()) with check (public.is_admin());
