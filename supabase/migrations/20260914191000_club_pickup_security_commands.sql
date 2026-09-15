begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.pickup_actor_role() returns text language sql stable security definer
set search_path = pg_catalog, public as $$
  select role::text from public.app_users where id=auth.uid() and account_state='active' and role::text in ('customer','venue','admin')
$$;
create function public.pickup_venue_authorized(p_venue_id uuid) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select coalesce(public.pickup_actor_role()='venue' and exists (
    select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    where v.id=p_venue_id and owner.role='venue' and owner.account_state='active'
    and (v.owner_user_id=auth.uid() or exists(select 1 from public.venue_team_members m
      where m.venue_id=v.id and m.user_id=auth.uid() and m.role='manager' and m.status='active'))
  ),false)
$$;
create function public.pickup_viewer(p_request_id uuid) returns text language sql stable security definer
set search_path = pg_catalog, public as $$
  select case when public.pickup_actor_role()='admin' then 'admin'
    when public.pickup_actor_role()='customer' and r.customer_user_id=auth.uid() then 'customer'
    when public.pickup_venue_authorized(r.venue_id) then 'venue' end
  from public.pickup_requests r where r.id=p_request_id
$$;
create function public.pickup_has_consent(p_request_id uuid) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists(select 1 from public.pickup_consents where pickup_request_id=p_request_id
    and user_id=auth.uid() and consent_version='pickup-chat-v1')
$$;

grant select on public.pickup_requests,public.pickup_messages,public.pickup_events,public.pickup_consents,
  public.pickup_read_receipts,public.pickup_reports,public.pickup_arrival_evidence to authenticated;
create policy pickup_participants_read on public.pickup_requests for select to authenticated
  using (public.pickup_viewer(id) is not null);
create policy pickup_consented_messages on public.pickup_messages for select to authenticated
  using (public.pickup_viewer(pickup_request_id)='admin' or
    (public.pickup_viewer(pickup_request_id) in ('customer','venue') and public.pickup_has_consent(pickup_request_id)));
create policy pickup_admin_events on public.pickup_events for select to authenticated
  using (public.pickup_viewer(pickup_request_id)='admin');
create policy pickup_own_consent on public.pickup_consents for select to authenticated
  using (public.pickup_viewer(pickup_request_id)='admin' or
    (user_id=auth.uid() and public.pickup_viewer(pickup_request_id) is not null));
create policy pickup_own_receipt on public.pickup_read_receipts for select to authenticated
  using (user_id=auth.uid() and public.pickup_viewer(pickup_request_id) is not null);
create policy pickup_reports_private on public.pickup_reports for select to authenticated
  using (public.pickup_viewer(pickup_request_id)='admin' or
    (reporter_user_id=auth.uid() and public.pickup_viewer(pickup_request_id) is not null));
create policy pickup_evidence_read on public.pickup_arrival_evidence for select to authenticated
  using (public.pickup_viewer(pickup_request_id) is not null);

-- Internal helpers are never callable by browser or service-role clients.
create function public.pickup_record_event(p_id uuid,p_type text,p_actor uuid,p_metadata jsonb,p_message text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.pickup_events(pickup_request_id,event_type,actor_user_id,metadata) values(p_id,p_type,p_actor,p_metadata);
  if p_message is not null then
    insert into public.pickup_messages(pickup_request_id,sender_type,message_text) values(p_id,'system',p_message);
  end if;
end $$;

create function public.pickup_notify(p_id uuid,p_actor uuid,p_kind text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype; recipient uuid; recipients uuid[]; label text;
begin
  select * into strict r from public.pickup_requests where id=p_id;
  select array_agg(distinct a.id) into recipients from public.app_users a
  where a.account_state='active' and a.id is distinct from p_actor and
    ((a.id=r.customer_user_id and a.role='customer') or (a.role='venue' and exists (
      select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
      where v.id=r.venue_id and owner.account_state='active' and owner.role='venue' and
        (a.id=v.owner_user_id or exists(select 1 from public.venue_team_members m
          where m.venue_id=v.id and m.user_id=a.id and m.role='manager' and m.status='active')))));
  if cardinality(recipients)>100 then raise exception using errcode='54000',message='Pickup recipient limit reached.'; end if;
  label := case p_kind when 'request' then 'New club pickup request' when 'message' then 'New pickup message'
    when 'accepted' then 'Venue accepted your pickup request' when 'vehicle_dispatched' then 'Venue marked vehicle as dispatched'
    when 'cancelled' then 'Pickup request cancelled' when 'arrived' then 'Pickup arrival recorded'
    else 'Pickup status updated' end;
  foreach recipient in array coalesce(recipients,array[]::uuid[]) loop
    if p_kind<>'message' or not exists(select 1 from public.notifications n where n.recipient_id=recipient
      and n.payload->>'kind'='club_pickup' and n.payload->>'pickupRequestId'=p_id::text
      and n.created_at>now()-interval '60 seconds' and n.read_at is null) then
      insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
      values(recipient,'support_message','in_app',label,'Open your private pickup conversation for details.',
        jsonb_build_object('kind','club_pickup','pickupRequestId',p_id,'url','/pickups/'||p_id),now());
    end if;
  end loop;
end $$;

create function public.pickup_expire_requests() returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype;
begin
  -- Bounded, scoped cleanup on inbox/detail reads; no global table scan or cron dependency.
  for r in select * from public.pickup_requests where expires_at<=now()
    and status in ('requested','accepted','vehicle_dispatched','arriving','arrived')
    and public.pickup_viewer(id) is not null order by expires_at limit 100 for update skip locked loop
    update public.pickup_requests set status='expired',updated_at=now(),
      referral_outcome=case when referral_outcome in ('arrival_reported','arrival_verified') then referral_outcome else 'expired' end where id=r.id;
    perform public.pickup_record_event(r.id,'expired',null,'{}','This pickup request has expired. Contact the venue before making new plans.');
  end loop;
end $$;

create function public.pickup_create_request(p_id uuid,p_venue_id uuid,p_location text,p_party_size integer,p_consent_version text,
  p_details text default '',p_notes text default '') returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare r public.pickup_requests%rowtype; existing_id uuid;
begin
  if public.pickup_actor_role() is distinct from 'customer' then raise exception using errcode='42501',message='An active customer account is required.'; end if;
  if p_id is null or p_venue_id is null or p_location is null or length(trim(p_location)) not between 3 and 300
    or p_party_size is null or p_party_size not between 1 and 30 or p_details is null or length(p_details)>500
    or p_notes is null or length(p_notes)>1000 or p_consent_version is distinct from 'pickup-chat-v1' then
    raise exception using errcode='22023',message='Check the pickup details and accept the chat notice.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup-customer:'||auth.uid()::text,0));
  select * into r from public.pickup_requests where id=p_id;
  if found then
    if r.customer_user_id<>auth.uid() or r.venue_id<>p_venue_id or r.pickup_location_text<>trim(p_location)
      or r.party_size<>p_party_size or r.pickup_location_details<>trim(p_details) or r.customer_notes<>trim(p_notes) then
      raise exception using errcode='22023',message='Request ID already has different details.';
    end if;
    return r.id;
  end if;
  perform public.pickup_expire_requests();
  select id into existing_id from public.pickup_requests where customer_user_id=auth.uid() and venue_id=p_venue_id
    and status in ('requested','accepted','vehicle_dispatched','arriving','arrived');
  if found then return existing_id; end if;
  if not exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    where v.id=p_venue_id and v.club_pickup_enabled and v.is_active and v.page_review_status='published'
    and v.published_at is not null and owner.role='venue' and owner.account_state='active') then
    raise exception using errcode='22023',message='This venue is not accepting pickup requests.';
  end if;
  if (select count(*) from public.pickup_requests where customer_user_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then
    raise exception using errcode='P0001',message='Pickup request limit reached. Please try again later.';
  end if;
  insert into public.pickup_requests(id,customer_user_id,venue_id,party_size,pickup_location_text,pickup_location_details,customer_notes)
    values(p_id,auth.uid(),p_venue_id,p_party_size,trim(p_location),trim(p_details),trim(p_notes));
  insert into public.pickup_consents(pickup_request_id,user_id,consent_version) values(p_id,auth.uid(),p_consent_version);
  perform public.pickup_record_event(p_id,'request_created',auth.uid(),jsonb_build_object('referralSource','mydancr'),
    'Pickup requested from the venue. Transportation is not confirmed until the venue accepts.');
  perform public.pickup_record_event(p_id,'consent_recorded',auth.uid(),jsonb_build_object('version',p_consent_version));
  perform public.pickup_notify(p_id,auth.uid(),'request');
  return p_id;
end $$;

create function public.pickup_accept_consent(p_id uuid,p_version text) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if public.pickup_viewer(p_id) is null or public.pickup_viewer(p_id)='admin' then raise exception using errcode='42501',message='Pickup access denied.'; end if;
  if p_version is distinct from 'pickup-chat-v1' then raise exception using errcode='22023',message='Accept the current chat notice.'; end if;
  insert into public.pickup_consents(pickup_request_id,user_id,consent_version) values(p_id,auth.uid(),p_version) on conflict do nothing;
  if found then perform public.pickup_record_event(p_id,'consent_recorded',auth.uid(),jsonb_build_object('version',p_version)); end if;
end $$;

create function public.pickup_send_message(p_id uuid,p_message_id uuid,p_text text) returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare who text; r public.pickup_requests%rowtype; m public.pickup_messages%rowtype;
begin
  who := public.pickup_viewer(p_id);
  if who is null or who not in ('customer','venue') or not public.pickup_has_consent(p_id) then
    raise exception using errcode='42501',message='Pickup access and chat consent are required.';
  end if;
  if p_message_id is null or p_text is null or length(trim(p_text)) not between 1 and 2000 then
    raise exception using errcode='22023',message='Messages must contain 1 to 2000 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup-message:'||auth.uid()::text,0));
  -- Serialize against status changes, so a closed conversation never accepts a later send.
  select * into strict r from public.pickup_requests where id=p_id for update;
  select * into m from public.pickup_messages where id=p_message_id;
  if found then
    if m.pickup_request_id<>p_id or m.sender_user_id is distinct from auth.uid() or m.message_text<>trim(p_text) then
      raise exception using errcode='22023',message='Message ID already has different content.';
    end if;
    return m.id;
  end if;
  if r.status in ('completed','cancelled','no_show','expired') or r.expires_at<=now() then
    raise exception using errcode='22023',message='This pickup conversation is closed.';
  end if;
  if (select count(*) from public.pickup_messages where sender_user_id=auth.uid() and created_at>now()-interval '60 seconds')>=12 then
    raise exception using errcode='P0001',message='Message limit reached. Please wait a minute.';
  end if;
  insert into public.pickup_messages(id,pickup_request_id,sender_user_id,sender_type,message_text) values(p_message_id,p_id,auth.uid(),who,trim(p_text));
  update public.pickup_requests set updated_at=now() where id=p_id;
  perform public.pickup_notify(p_id,auth.uid(),'message');
  return p_message_id;
end $$;

create function public.pickup_set_status(p_id uuid,p_status text,p_expected_status text,p_reason text default '') returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare who text; r public.pickup_requests%rowtype; event_name text; label text; evidence_source text;
begin
  who := public.pickup_viewer(p_id);
  if who is null or who not in ('customer','venue') or not public.pickup_has_consent(p_id) then
    raise exception using errcode='42501',message='Pickup access and chat consent are required.';
  end if;
  if p_status is null or p_expected_status is null or p_reason is null or length(p_reason)>500 then
    raise exception using errcode='22023',message='Invalid pickup status.';
  end if;
  select * into strict r from public.pickup_requests where id=p_id for update;
  if r.status=p_status then return; end if;
  if r.status<>p_expected_status then raise exception using errcode='40001',message='Pickup status changed. Refresh before trying again.'; end if;
  if r.status in ('completed','cancelled','no_show','expired') or r.expires_at<=now() then
    raise exception using errcode='22023',message='This pickup request is closed.';
  end if;
  if not ((who='customer' and (p_status='cancelled' and r.status<>'arrived' or
      p_status='arrived' and r.status in ('accepted','vehicle_dispatched','arriving'))) or
    (who='venue' and (
      p_status='cancelled' and r.status<>'arrived' or
      p_status='accepted' and r.status='requested' or
      p_status='vehicle_dispatched' and r.status='accepted' or
      p_status='arriving' and r.status='vehicle_dispatched' or
      p_status='arrived' and r.status in ('accepted','vehicle_dispatched','arriving') or
      p_status='completed' and r.status='arrived' or
      p_status='no_show' and r.status in ('accepted','vehicle_dispatched','arriving')
    ))) then raise exception using errcode='42501',message='This status change is not permitted.'; end if;
  if p_status='cancelled' and length(trim(p_reason))<3 then raise exception using errcode='22023',message='Provide a short cancellation reason.'; end if;
  update public.pickup_requests set status=p_status,updated_at=now(),
    accepted_at=case when p_status='accepted' then now() else accepted_at end,
    vehicle_dispatched_at=case when p_status='vehicle_dispatched' then now() else vehicle_dispatched_at end,
    arrived_at=case when p_status='arrived' then coalesce(arrived_at,now()) else arrived_at end,
    completed_at=case when p_status='completed' then now() else completed_at end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,
    cancelled_by=case when p_status='cancelled' then auth.uid() else cancelled_by end,
    cancellation_reason=case when p_status='cancelled' then trim(p_reason) else cancellation_reason end,
    referral_outcome=case when referral_outcome='arrival_verified' then referral_outcome
      when p_status='arrived' then 'arrival_reported' when p_status='completed' then 'completed_unverified'
      when p_status in ('cancelled','no_show') then p_status else referral_outcome end where id=p_id;
  if p_status='arrived' then
    evidence_source := case who when 'customer' then 'customer_confirmation' else 'venue_confirmation' end;
    insert into public.pickup_arrival_evidence(pickup_request_id,source,actor_user_id) values(p_id,evidence_source,auth.uid()) on conflict do nothing;
  end if;
  event_name := case p_status when 'accepted' then 'venue_accepted' when 'vehicle_dispatched' then 'vehicle_dispatched'
    when 'cancelled' then who||'_cancelled' when 'arrived' then 'arrival_confirmed'
    when 'completed' then 'completed' when 'no_show' then 'no_show' else 'status_changed' end;
  label := case p_status when 'accepted' then 'Venue accepted your pickup request.'
    when 'vehicle_dispatched' then 'Venue marked vehicle as dispatched.' when 'arriving' then 'Venue marked the vehicle as arriving.'
    when 'arrived' then case who when 'customer' then 'Customer reported arrival.' else 'Venue reported customer arrival.' end
    when 'completed' then 'Venue marked pickup coordination complete.' when 'no_show' then 'Venue marked this request as no-show.'
    when 'cancelled' then case who when 'customer' then 'Customer cancelled the request.' else 'Venue cancelled or declined the request.' end end;
  perform public.pickup_record_event(p_id,event_name,auth.uid(),jsonb_build_object('from',r.status,'to',p_status,'reason',trim(p_reason)),label);
  perform public.pickup_notify(p_id,auth.uid(),p_status);
end $$;

create function public.pickup_mark_read(p_id uuid,p_sequence bigint) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare latest bigint;
begin
  if public.pickup_viewer(p_id) is null or not public.pickup_has_consent(p_id) then raise exception using errcode='42501',message='Pickup access denied.'; end if;
  if p_sequence is null or p_sequence<0 then raise exception using errcode='22023',message='Invalid message position.'; end if;
  select coalesce(max(sequence),0) into latest from public.pickup_messages where pickup_request_id=p_id;
  insert into public.pickup_read_receipts(pickup_request_id,user_id,last_read_sequence) values(p_id,auth.uid(),least(p_sequence,latest))
    on conflict(pickup_request_id,user_id) do update set last_read_sequence=greatest(pickup_read_receipts.last_read_sequence,excluded.last_read_sequence),updated_at=now();
end $$;
create function public.pickup_report_conversation(p_id uuid,p_reason text,p_details text default '') returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if public.pickup_viewer(p_id) is null or public.pickup_viewer(p_id)='admin' then raise exception using errcode='42501',message='Pickup access denied.'; end if;
  if p_reason is null or p_reason not in ('sexual_services','illegal_drugs','threats','harassment','private_information','other')
    or p_details is null or length(p_details)>1000 then raise exception using errcode='22023',message='Check the report details.'; end if;
  insert into public.pickup_reports(pickup_request_id,reporter_user_id,reason,details) values(p_id,auth.uid(),p_reason,trim(p_details)) on conflict do nothing;
  if found then
    perform public.pickup_record_event(p_id,'conversation_reported',auth.uid(),jsonb_build_object('reason',p_reason));
    insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
      select id,'support_message','in_app','Pickup conversation reported','Review the private pickup audit.',
        jsonb_build_object('kind','club_pickup','pickupRequestId',p_id,'url','/pickups/'||p_id),now()
      from public.app_users where role='admin' and account_state='active';
  end if;
end $$;

create function public.pickup_admin_note(p_id uuid,p_note text) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if public.pickup_viewer(p_id) is distinct from 'admin' then raise exception using errcode='42501',message='Admin access required.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 1000 then raise exception using errcode='22023',message='Enter a short audit note.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup-admin:'||auth.uid()::text,0));
  if (select count(*) from public.pickup_events where actor_user_id=auth.uid() and event_type='admin_action' and created_at>now()-interval '60 seconds')>=12 then
    raise exception using errcode='P0001',message='Audit note limit reached. Please wait a minute.';
  end if;
  perform public.pickup_record_event(p_id,'admin_action',auth.uid(),jsonb_build_object('note',trim(p_note)));
end $$;

create function public.pickup_set_enabled(p_venue_id uuid,p_enabled boolean) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if not public.pickup_venue_authorized(p_venue_id) then raise exception using errcode='42501',message='Venue manager access required.'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='Choose whether pickup is enabled.'; end if;
  update public.venues set club_pickup_enabled=p_enabled where id=p_venue_id;
end $$;
create function public.pickup_guard_enabled() returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if (tg_op='INSERT' and new.club_pickup_enabled) or (tg_op='UPDATE' and new.club_pickup_enabled is distinct from old.club_pickup_enabled) then
    if not public.pickup_venue_authorized(new.id) or
      (new.club_pickup_enabled and (not new.is_active or new.page_review_status<>'published' or new.published_at is null)) then
      raise exception using errcode='42501',message='Only an authorized manager of a published venue can enable pickup.';
    end if;
  end if;
  return new;
end $$;
create trigger pickup_venue_setting_guard before insert or update on public.venues for each row execute function public.pickup_guard_enabled();

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'pickup\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname not in ('pickup_record_event','pickup_notify','pickup_guard_enabled') then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;

-- Only private RLS-filtered requests/messages are published, never reports or audit notes.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.pickup_requests,public.pickup_messages;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
