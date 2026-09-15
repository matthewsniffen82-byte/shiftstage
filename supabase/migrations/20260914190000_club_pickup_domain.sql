begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Additive and opt-in. Existing shuttle requests, deals and financial records are unchanged.
alter table public.venues add column club_pickup_enabled boolean not null default false;
grant select (club_pickup_enabled) on public.venues to anon, authenticated;

create table public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references public.app_users(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete restrict,
  status text not null default 'requested' check (status in
    ('requested','accepted','vehicle_dispatched','arriving','arrived','completed','cancelled','no_show','expired')),
  party_size smallint not null check (party_size between 1 and 30),
  pickup_location_text text not null check (length(trim(pickup_location_text)) between 3 and 300),
  pickup_location_details text not null default '' check (length(pickup_location_details) <= 500),
  customer_notes text not null default '' check (length(customer_notes) <= 1000),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  accepted_at timestamptz,
  vehicle_dispatched_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id) on delete restrict,
  cancellation_reason text check (length(cancellation_reason) <= 500),
  referral_source text not null default 'mydancr' check (referral_source = 'mydancr'),
  referral_outcome text not null default 'pending' check (referral_outcome in
    ('pending','arrival_reported','arrival_verified','completed_unverified','cancelled','no_show','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > requested_at)
);
create unique index pickup_one_active_per_customer_venue on public.pickup_requests(customer_user_id,venue_id)
  where status in ('requested','accepted','vehicle_dispatched','arriving','arrived');
create index pickup_customer_recent on public.pickup_requests(customer_user_id,requested_at desc,id);
create index pickup_venue_status_recent on public.pickup_requests(venue_id,status,requested_at desc,id);
create index pickup_admin_recent on public.pickup_requests(requested_at desc,id);
create index pickup_expiry on public.pickup_requests(expires_at) where status in ('requested','accepted','vehicle_dispatched','arriving');

create table public.pickup_messages (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  sender_user_id uuid references public.app_users(id) on delete restrict,
  sender_type text not null check (sender_type in ('customer','venue','system')),
  message_text text not null check (length(trim(message_text)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check ((sender_type = 'system') = (sender_user_id is null))
);
create index pickup_message_order on public.pickup_messages(pickup_request_id,sequence);
create index pickup_message_rate on public.pickup_messages(sender_user_id,created_at desc) where sender_user_id is not null;

create table public.pickup_events (
  id uuid primary key default gen_random_uuid(),
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  event_type text not null check (event_type in ('request_created','consent_recorded','venue_accepted',
    'vehicle_dispatched','status_changed','customer_cancelled','venue_cancelled','arrival_confirmed',
    'arrival_verified','completed','no_show','expired','conversation_reported','admin_action')),
  actor_user_id uuid references public.app_users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4000),
  created_at timestamptz not null default now()
);
create index pickup_event_order on public.pickup_events(pickup_request_id,created_at,id);
create index pickup_event_actor_rate on public.pickup_events(actor_user_id,event_type,created_at desc);

create table public.pickup_consents (
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  consent_version text not null check (length(consent_version) between 1 and 50),
  accepted_at timestamptz not null default now(),
  primary key(pickup_request_id,user_id,consent_version)
);
create table public.pickup_read_receipts (
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key(pickup_request_id,user_id)
);
create table public.pickup_reports (
  id uuid primary key default gen_random_uuid(),
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  reporter_user_id uuid not null references public.app_users(id) on delete restrict,
  reason text not null check (reason in ('sexual_services','illegal_drugs','threats','harassment','private_information','other')),
  details text not null default '' check (length(details) <= 1000),
  created_at timestamptz not null default now(),
  unique(pickup_request_id,reporter_user_id)
);
create index pickup_reports_recent on public.pickup_reports(created_at desc,id);
create table public.pickup_arrival_evidence (
  id uuid primary key default gen_random_uuid(),
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  source text not null check (source in ('customer_confirmation','venue_confirmation','nfc_deal_redemption')),
  actor_user_id uuid references public.app_users(id) on delete restrict,
  redemption_id uuid references public.qr_redemptions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((source = 'nfc_deal_redemption') = (redemption_id is not null)),
  unique(pickup_request_id,source),
  unique(redemption_id)
);

-- No direct writes, including service-role writes. Subsequent narrowly scoped RPCs
-- derive actors from auth.uid() and perform atomic state transitions and audit writes.
do $$ declare t text; begin
  foreach t in array array['pickup_requests','pickup_messages','pickup_events','pickup_consents',
    'pickup_read_receipts','pickup_reports','pickup_arrival_evidence'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
revoke all on sequence public.pickup_messages_sequence_seq from public,anon,authenticated,service_role;

create function public.prevent_pickup_history_rewrite() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin raise exception using errcode='42501',message='Pickup history cannot be edited or deleted.'; end $$;
revoke all on function public.prevent_pickup_history_rewrite() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['pickup_messages','pickup_events','pickup_consents','pickup_reports','pickup_arrival_evidence'] loop
    execute format('create trigger pickup_immutable before update or delete on public.%I for each row execute function public.prevent_pickup_history_rewrite()',t);
    execute format('create trigger pickup_no_truncate before truncate on public.%I for each statement execute function public.prevent_pickup_history_rewrite()',t);
  end loop;
end $$;
comment on table public.pickup_requests is 'Private customer-to-verified-venue coordination and customer referral attribution. MyDancr does not provide or dispatch transportation. No charges are created.';
comment on table public.pickup_arrival_evidence is 'Reported arrivals are distinct from verified cashier/NFC redemption evidence. Never evidence of a transportation fee.';
notify pgrst,'reload schema';
commit;
