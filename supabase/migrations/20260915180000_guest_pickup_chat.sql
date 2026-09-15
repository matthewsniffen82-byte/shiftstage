begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Guest capabilities belong to one conversation. Only their SHA-256 hashes are
-- stored; no account, public read policy, or general-purpose guest role is created.
alter table public.pickup_requests alter column customer_user_id drop not null;
alter table public.pickup_requests add column is_guest boolean not null default false;
alter table public.pickup_requests add constraint pickup_customer_identity
  check ((customer_user_id is null) = is_guest);

create table public.pickup_guest_access (
  pickup_request_id uuid primary key references public.pickup_requests(id) on delete restrict,
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  rate_key text not null check (rate_key ~ '^[a-f0-9]{64}$'),
  consent_version text not null check (consent_version = 'pickup-chat-v1'),
  accepted_at timestamptz not null default now(),
  access_expires_at timestamptz not null default (now() + interval '30 days'),
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0)
);
create index pickup_guest_rate on public.pickup_guest_access(rate_key, accepted_at);
alter table public.pickup_guest_access enable row level security;
revoke all on public.pickup_guest_access from public, anon, authenticated, service_role;

alter table public.pickup_messages add column guest_request_id uuid references public.pickup_guest_access(pickup_request_id) on delete restrict;
alter table public.pickup_messages drop constraint pickup_messages_check;
alter table public.pickup_messages add constraint pickup_message_identity check (
  (sender_type = 'system' and sender_user_id is null and guest_request_id is null) or
  (sender_type in ('customer','venue') and sender_user_id is not null and guest_request_id is null) or
  (sender_type = 'customer' and sender_user_id is null and guest_request_id = pickup_request_id and guest_request_id is not null)
);
alter table public.pickup_reports alter column reporter_user_id drop not null;
alter table public.pickup_reports add column guest_request_id uuid references public.pickup_guest_access(pickup_request_id) on delete restrict;
alter table public.pickup_reports add constraint pickup_report_identity check (
  (reporter_user_id is not null and guest_request_id is null) or
  (reporter_user_id is null and guest_request_id = pickup_request_id and guest_request_id is not null)
);
create unique index pickup_guest_report_once on public.pickup_reports(guest_request_id) where guest_request_id is not null;

create function public.pickup_require_guest(p_id uuid, p_key_hash text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from public.pickup_guest_access g join public.pickup_requests r on r.id=g.pickup_request_id
    where g.pickup_request_id=p_id and g.key_hash=p_key_hash and g.access_expires_at>now() and r.is_guest
  ) then raise exception using errcode='42501', message='Private pickup link required.'; end if;
end $$;

create function public.pickup_guest_create(p_id uuid, p_key_hash text, p_rate_key text,
  p_venue_id uuid, p_location text, p_party_size integer, p_consent_version text,
  p_details text default '', p_notes text default '') returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype;
begin
  if p_id is null or p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$' or p_venue_id is null
    or p_location is null or length(trim(p_location)) not between 3 and 300
    or p_party_size is null or p_party_size not between 1 and 30
    or p_consent_version is distinct from 'pickup-chat-v1' or p_details is null or length(p_details)>500
    or p_notes is null or length(p_notes)>1000 then
    raise exception using errcode='22023', message='Check the pickup details and chat notice.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup-guest-rate:'||p_rate_key,0));
  perform pg_advisory_xact_lock(hashtextextended('pickup-guest-request:'||p_id::text,0));
  select * into r from public.pickup_requests where id=p_id;
  if found then
    perform public.pickup_require_guest(p_id,p_key_hash);
    if r.venue_id<>p_venue_id or r.pickup_location_text<>trim(p_location) or r.party_size<>p_party_size
      or r.pickup_location_details<>trim(p_details) or r.customer_notes<>trim(p_notes) then
      raise exception using errcode='22023', message='Request ID already has different details.';
    end if;
    return r.id;
  end if;
  if not exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    where v.id=p_venue_id and v.club_pickup_enabled and v.is_active and v.page_review_status='published'
    and v.published_at is not null and owner.role='venue' and owner.account_state='active') then
    raise exception using errcode='22023', message='This venue is not accepting pickup chat requests.';
  end if;
  if (select count(*) from public.pickup_guest_access where rate_key=p_rate_key and accepted_at>now()-interval '1 hour')>=5 then
    raise exception using errcode='P0001', message='Pickup request limit reached. Please try again later.';
  end if;
  insert into public.pickup_requests(id,is_guest,venue_id,party_size,pickup_location_text,pickup_location_details,customer_notes)
    values(p_id,true,p_venue_id,p_party_size,trim(p_location),trim(p_details),trim(p_notes));
  insert into public.pickup_guest_access(pickup_request_id,key_hash,rate_key,consent_version)
    values(p_id,p_key_hash,p_rate_key,p_consent_version);
  perform public.pickup_record_event(p_id,'request_created',null,'{"referralSource":"mydancr","guest":true}',
    'Pickup requested from the venue. Transportation is not confirmed until the venue accepts.');
  perform public.pickup_record_event(p_id,'consent_recorded',null,jsonb_build_object('version',p_consent_version,'guest',true));
  perform public.pickup_notify(p_id,null,'request');
  return p_id;
end $$;

create function public.pickup_guest_get(p_id uuid, p_key_hash text, p_before bigint default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype; messages jsonb; evidence jsonb; venue jsonb; has_older boolean;
begin
  perform public.pickup_require_guest(p_id,p_key_hash);
  if p_before is not null and p_before<0 then raise exception using errcode='22023',message='Invalid message position.'; end if;
  select * into strict r from public.pickup_requests where id=p_id;
  if r.expires_at<=now() and r.status in ('requested','accepted','vehicle_dispatched','arriving','arrived') then
    select * into strict r from public.pickup_requests where id=p_id for update;
    if r.status in ('requested','accepted','vehicle_dispatched','arriving','arrived') then
      update public.pickup_requests set status='expired',updated_at=now(),
        referral_outcome=case when referral_outcome in ('arrival_reported','arrival_verified','arrival_disputed') then referral_outcome else 'expired' end
        where id=p_id returning * into r;
      perform public.pickup_record_event(p_id,'expired',null,'{}','This pickup request has expired. Contact the venue before making new plans.');
    end if;
  end if;
  select jsonb_build_object('name',v.name,'slug',v.slug) into venue from public.venues v where id=r.venue_id;
  select coalesce(jsonb_agg(to_jsonb(m) order by sequence),'[]'::jsonb) into messages from (
    select id,sequence,sender_type,message_text,created_at from public.pickup_messages
    where pickup_request_id=p_id and (p_before is null or sequence<p_before) order by sequence desc limit 50
  ) m;
  select exists(select 1 from public.pickup_messages where pickup_request_id=p_id
    and (p_before is null or sequence<p_before) order by sequence desc offset 50 limit 1) into has_older;
  select coalesce(jsonb_agg(to_jsonb(e) order by created_at),'[]'::jsonb) into evidence from (
    select id,source,actor_user_id,redemption_id,created_at from public.pickup_arrival_evidence where pickup_request_id=p_id
  ) e;
  return jsonb_build_object('request',to_jsonb(r)||jsonb_build_object('venue',venue),'role','customer','guest',true,
    'consented',true,'messages',messages,'hasOlderMessages',has_older,'events','[]'::jsonb,
    'hasMoreEvents',false,'reports','[]'::jsonb,'evidence',evidence);
end $$;

-- A fixed command allowlist keeps capability access separate from account RPCs.
create function public.pickup_guest_command(p_id uuid, p_key_hash text, p_command text, p_args jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype; m public.pickup_messages%rowtype; message_id uuid; body text;
  desired text; expected text; reason text; sequence_value bigint; latest bigint;
begin
  perform public.pickup_require_guest(p_id,p_key_hash);
  select * into strict r from public.pickup_requests where id=p_id for update;
  perform public.pickup_require_guest(p_id,p_key_hash);
  if p_args is null or jsonb_typeof(p_args)<>'object' then raise exception using errcode='22023',message='Invalid pickup action.'; end if;
  if p_command='pickup_send_message' then
    message_id := (p_args->>'p_message_id')::uuid; body := trim(p_args->>'p_text');
    if message_id is null or body is null or length(body) not between 1 and 2000 then
      raise exception using errcode='22023',message='Messages must contain 1 to 2000 characters.';
    end if;
    select * into m from public.pickup_messages where id=message_id;
    if found then
      if m.guest_request_id is distinct from p_id or m.pickup_request_id<>p_id or m.message_text<>body then
        raise exception using errcode='22023',message='Message ID already has different content.';
      end if;
      return;
    end if;
    if r.status in ('completed','cancelled','no_show','expired') or r.expires_at<=now() then
      raise exception using errcode='22023',message='This pickup conversation is closed.';
    end if;
    if (select count(*) from public.pickup_messages where guest_request_id=p_id and created_at>now()-interval '60 seconds')>=12 then
      raise exception using errcode='P0001',message='Message limit reached. Please wait a minute.';
    end if;
    insert into public.pickup_messages(id,pickup_request_id,guest_request_id,sender_type,message_text)
      values(message_id,p_id,p_id,'customer',body);
    update public.pickup_requests set updated_at=now() where id=p_id;
    perform public.pickup_notify(p_id,null,'message');
  elsif p_command in ('pickup_set_status','pickup_confirm_arrival') then
    if p_command='pickup_confirm_arrival' and r.status in ('arrived','completed') then
      insert into public.pickup_arrival_evidence(pickup_request_id,source) values(p_id,'customer_confirmation') on conflict do nothing;
      if found then perform public.pickup_record_event(p_id,'arrival_confirmed',null,'{"source":"customer_confirmation","guest":true}','Guest also confirmed arrival.'); end if;
      return;
    end if;
    desired := case when p_command='pickup_confirm_arrival' then 'arrived' else p_args->>'p_status' end;
    expected := case when p_command='pickup_confirm_arrival' then r.status else p_args->>'p_expected_status' end;
    reason := coalesce(trim(p_args->>'p_reason'),'');
    if desired is null or desired not in ('arrived','cancelled') then raise exception using errcode='42501',message='Guest status action denied.'; end if;
    if r.status=desired then return; end if;
    if expected is null or r.status<>expected then raise exception using errcode='40001',message='Pickup status changed.'; end if;
    if r.expires_at<=now() or r.status in ('completed','cancelled','no_show','expired') then
      raise exception using errcode='22023',message='This pickup request is closed.';
    end if;
    if (desired='cancelled' and r.status='arrived') or (desired='arrived' and r.status not in ('accepted','vehicle_dispatched','arriving')) then
      raise exception using errcode='42501',message='Guest status action denied.';
    end if;
    if length(reason)>500 or (desired='cancelled' and length(reason)<3) then raise exception using errcode='22023',message='Provide a short cancellation reason.'; end if;
    update public.pickup_requests set status=desired,updated_at=now(),
      arrived_at=case when desired='arrived' then coalesce(arrived_at,now()) else arrived_at end,
      cancelled_at=case when desired='cancelled' then now() else cancelled_at end,
      cancellation_reason=case when desired='cancelled' then reason else cancellation_reason end,
      referral_outcome=case when referral_outcome in ('arrival_verified','arrival_disputed') then referral_outcome
        when desired='arrived' then 'arrival_reported' else 'cancelled' end where id=p_id;
    if desired='arrived' then
      insert into public.pickup_arrival_evidence(pickup_request_id,source) values(p_id,'customer_confirmation') on conflict do nothing;
    end if;
    perform public.pickup_record_event(p_id,case when desired='arrived' then 'arrival_confirmed' else 'customer_cancelled' end,null,
      jsonb_build_object('from',r.status,'to',desired,'reason',reason,'guest',true),
      case when desired='arrived' then 'Guest reported arrival.' else 'Guest cancelled the request.' end);
    perform public.pickup_notify(p_id,null,desired);
  elsif p_command='pickup_mark_read' then
    sequence_value := (p_args->>'p_sequence')::bigint;
    if sequence_value is null or sequence_value<0 then raise exception using errcode='22023',message='Invalid message position.'; end if;
    select coalesce(max(sequence),0) into latest from public.pickup_messages where pickup_request_id=p_id;
    update public.pickup_guest_access set last_read_sequence=least(sequence_value,latest)
      where pickup_request_id=p_id and last_read_sequence<least(sequence_value,latest);
  elsif p_command='pickup_accept_consent' then
    if p_args->>'p_version' is distinct from 'pickup-chat-v1' then raise exception using errcode='22023',message='Accept the current chat notice.'; end if;
    -- Consent was recorded atomically at creation; retries do not rewrite it.
  elsif p_command='pickup_report_conversation' then
    reason := p_args->>'p_reason'; body := coalesce(trim(p_args->>'p_details'),'');
    if reason is null or reason not in ('sexual_services','illegal_drugs','threats','harassment','private_information','other') or length(body)>1000 then
      raise exception using errcode='22023',message='Check the report details.';
    end if;
    insert into public.pickup_reports(pickup_request_id,guest_request_id,reason,details) values(p_id,p_id,reason,body) on conflict do nothing;
    if found then
      perform public.pickup_record_event(p_id,'conversation_reported',null,jsonb_build_object('reason',reason,'guest',true));
      insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
        select id,'support_message','in_app','Pickup conversation reported','Review the private pickup audit.',
          jsonb_build_object('kind','club_pickup','pickupRequestId',p_id,'url','/pickups/'||p_id),now()
        from public.app_users where role='admin' and account_state='active';
    end if;
  else raise exception using errcode='42501',message='Guest pickup action denied.';
  end if;
end $$;

revoke all on function public.pickup_require_guest(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.pickup_guest_create(uuid,text,text,uuid,text,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.pickup_guest_get(uuid,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.pickup_guest_command(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pickup_guest_create(uuid,text,text,uuid,text,integer,text,text,text) to service_role;
grant execute on function public.pickup_guest_get(uuid,text,bigint) to service_role;
grant execute on function public.pickup_guest_command(uuid,text,text,jsonb) to service_role;

-- A NULL guest customer must never satisfy the signed-in request retry check.
-- Keep the existing implementation/grants, replacing only its identity comparison.
do $$ declare definition text; begin
  select pg_get_functiondef('public.pickup_create_request(uuid,uuid,text,integer,text,text,text)'::regprocedure) into definition;
  if position('r.customer_user_id<>auth.uid()' in definition)=0 then raise exception 'Unexpected pickup_create_request definition'; end if;
  execute replace(definition,'r.customer_user_id<>auth.uid()','r.customer_user_id is distinct from auth.uid()');
end $$;

notify pgrst,'reload schema';
commit;
