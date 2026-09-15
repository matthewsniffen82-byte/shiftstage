begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Recheck authorization after waiting for request locks, retain disputed attribution,
-- and avoid repeated writes when the same messages are already marked read.
create or replace function public.pickup_create_request(p_id uuid,p_venue_id uuid,p_location text,p_party_size integer,p_consent_version text,
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
  if public.pickup_actor_role() is distinct from 'customer' then raise exception using errcode='42501',message='An active customer account is required.'; end if;
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

create or replace function public.pickup_send_message(p_id uuid,p_message_id uuid,p_text text) returns uuid language plpgsql security definer
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
  if public.pickup_viewer(p_id) is distinct from who or not public.pickup_has_consent(p_id) then
    raise exception using errcode='42501',message='Pickup authorization changed.';
  end if;
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

create or replace function public.pickup_set_status(p_id uuid,p_status text,p_expected_status text,p_reason text default '') returns void
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
  if public.pickup_viewer(p_id) is distinct from who or not public.pickup_has_consent(p_id) then
    raise exception using errcode='42501',message='Pickup authorization changed.';
  end if;
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
    referral_outcome=case when referral_outcome in ('arrival_verified','arrival_disputed') then referral_outcome
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

create or replace function public.pickup_mark_read(p_id uuid,p_sequence bigint) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare latest bigint;
begin
  if public.pickup_viewer(p_id) is null or not public.pickup_has_consent(p_id) then raise exception using errcode='42501',message='Pickup access denied.'; end if;
  if p_sequence is null or p_sequence<0 then raise exception using errcode='22023',message='Invalid message position.'; end if;
  select coalesce(max(sequence),0) into latest from public.pickup_messages where pickup_request_id=p_id;
  insert into public.pickup_read_receipts(pickup_request_id,user_id,last_read_sequence) values(p_id,auth.uid(),least(p_sequence,latest))
    on conflict(pickup_request_id,user_id) do update set last_read_sequence=greatest(pickup_read_receipts.last_read_sequence,excluded.last_read_sequence),updated_at=now()
    where pickup_read_receipts.last_read_sequence<excluded.last_read_sequence;
end $$;

notify pgrst,'reload schema';
commit;
