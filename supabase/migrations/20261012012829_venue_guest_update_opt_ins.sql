begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- No backfill: visit/ride contact details alone are never update permission.
create table public.venue_update_subscriptions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  channel text not null check(channel in ('email','text')),
  destination text not null check(char_length(destination)<=254 and destination !~ '[[:cntrl:]]'),
  name text not null check(char_length(name) between 2 and 100),
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  manage_token text not null unique check(manage_token ~ '^[A-Za-z0-9_-]{43}$'),
  unique(venue_id,channel,destination),
  check((channel='email' and destination ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')
    or (channel='text' and destination ~ '^\+[1-9][0-9]{7,14}$'))
);
create index venue_update_subscriptions_active on public.venue_update_subscriptions(venue_id,channel,consented_at desc,id) where withdrawn_at is null;
create table public.venue_update_consent_events (
  subscription_id uuid not null references public.venue_update_subscriptions(id) on delete cascade,
  source text not null check(source in ('guest_list','ride')),
  source_id uuid not null,
  channel text not null check(channel in ('email','text')),
  consent_version text not null check(consent_version='venue-updates-v1'),
  sender_name text not null,
  consented_at timestamptz not null default now(),
  primary key(source,source_id,channel)
);
create index venue_update_consent_subscription on public.venue_update_consent_events(subscription_id);
alter table public.venue_update_subscriptions enable row level security;
alter table public.venue_update_consent_events enable row level security;
revoke all on public.venue_update_subscriptions,public.venue_update_consent_events from public,anon,authenticated;
grant select,insert,update on public.venue_update_subscriptions to service_role;
grant select,insert on public.venue_update_consent_events to service_role;

-- The server first verifies the pass/session or the immutable ride details.
-- Resolve venue and contact addresses from that saved receipt, never body IDs.
create function public.record_venue_update_opt_ins(p_source text,p_receipt text,p_email boolean,p_text boolean,p_version text,p_email_token text,p_text_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  contact record; choice record; subscription public.venue_update_subscriptions;
  results jsonb='[]'::jsonb; prior_event uuid;
begin
  if p_email is null or p_text is null or p_version is distinct from 'venue-updates-v1'
    or p_source is null or p_source not in ('guest_list','ride') then
    raise exception 'Invalid update preference' using errcode='22023';
  end if;
  if p_source='guest_list' then
    select g.pass_id source_id,g.venue_id,g.guest_name name,g.email,g.phone,v.name sender_name into contact
    from public.venue_guest_list_entries g join public.qr_redemptions r on r.id=g.pass_id
    join public.venues v on v.id=g.venue_id where r.redemption_token=p_receipt and r.venue_id=g.venue_id;
  else
    select r.id source_id,r.venue_id,n->'payload'->>'name' name,n->'payload'->>'email' email,
      n->'payload'->>'phone' phone,v.name sender_name into contact
    from public.club_shuttle_requests r join public.venues v on v.id=r.venue_id
    cross join lateral jsonb_array_elements(r.notification_rows) n
    where r.id=p_receipt::uuid and n->'payload'->>'kind'='club_shuttle_request'
      and n->'payload'->>'requestId'=r.id::text and n->'payload'->>'venueId'=r.venue_id::text limit 1;
  end if;
  if contact.source_id is null then raise exception 'Update receipt unavailable' using errcode='22023'; end if;
  for choice in select * from (values ('email',p_email,lower(trim(contact.email)),p_email_token),('text',p_text,contact.phone,p_text_token)) x(channel,opted_in,destination,token)
  loop
    if not choice.opted_in then continue; end if;
    if nullif(choice.destination,'') is null then raise exception 'Contact address required for updates' using errcode='22023'; end if;
    -- Serialize the same destination, including different simultaneous receipts.
    perform pg_advisory_xact_lock(hashtextextended(contact.venue_id::text||':'||choice.channel||':'||choice.destination,0));
    select subscription_id into prior_event from public.venue_update_consent_events
      where source=p_source and source_id=contact.source_id and channel=choice.channel;
    if prior_event is null then
      insert into public.venue_update_subscriptions(venue_id,channel,destination,name,manage_token)
        values(contact.venue_id,choice.channel,choice.destination,contact.name,choice.token)
        on conflict(venue_id,channel,destination) do update set name=excluded.name,consented_at=now(),withdrawn_at=null
        returning * into subscription;
      insert into public.venue_update_consent_events(subscription_id,source,source_id,channel,consent_version,sender_name)
        values(subscription.id,p_source,contact.source_id,choice.channel,p_version,contact.sender_name);
    else
      -- Replaying a receipt must never undo a later unsubscribe.
      select * into strict subscription from public.venue_update_subscriptions where id=prior_event;
    end if;
    results := results||jsonb_build_array(jsonb_build_object('channel',choice.channel,'token',subscription.manage_token,'active',subscription.withdrawn_at is null));
  end loop;
  return results;
end $$;
revoke all on function public.record_venue_update_opt_ins(text,text,boolean,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.record_venue_update_opt_ins(text,text,boolean,boolean,text,text,text) to service_role;
create function public.issue_guest_list_admission_pass_with_updates(
  p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,p_source text,p_dancer_id uuid,p_shift_id uuid,p_arrival_method text,p_video_id uuid,
  p_guest_name text,p_phone text,p_email text,p_consent boolean,
  p_update_email boolean,p_update_text boolean,p_version text,p_email_token text,p_text_token text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt jsonb; updates jsonb;
begin
  receipt := public.issue_guest_list_admission_pass(p_token,p_deal_id,p_session_id,p_customer_id,p_source,p_dancer_id,p_shift_id,p_arrival_method,p_video_id,p_guest_name,p_phone,p_email,p_consent);
  updates := public.record_venue_update_opt_ins('guest_list',receipt->>'token',p_update_email,p_update_text,p_version,p_email_token,p_text_token);
  return receipt||jsonb_build_object('updates',updates);
end $$;
revoke all on function public.issue_guest_list_admission_pass_with_updates(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,boolean,boolean,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.issue_guest_list_admission_pass_with_updates(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,boolean,boolean,boolean,text,text,text) to service_role;
comment on table public.venue_update_consent_events is 'Explicit optional club-update permission. venue-updates-v1: separate unchecked email and text choices for club news, events and offers; optional and not required for entry or a ride. No legacy contact import.';
commit;
