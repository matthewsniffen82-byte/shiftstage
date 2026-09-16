begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Reuse the existing attribution and redemption history. New admissions are
-- analytics events; they do not create revenue, invoices or commission entries.
alter table public.qr_redemptions
  add column admission_pass_version smallint,
  add column arrival_method text,
  add column redeemed_by_user_id uuid references public.app_users(id) on delete restrict,
  add column arrival_verified_at timestamptz,
  add constraint admission_pass_fields check (admission_pass_version is null or
    (admission_pass_version=1 and arrival_method is not null and arrival_method in
      ('self_drive','club_shuttle','autonomous_cab','waymo','zoox','cybercab')));
create index admission_pass_claims on public.qr_redemptions(venue_id,session_id,generated_at desc)
  where admission_pass_version=1;
create index admission_pass_arrivals on public.qr_redemptions(venue_id,redeemed_at)
  where status='redeemed';

-- Dancer attribution reports return sanitized aggregates through the server.
-- They must not reveal a guest's reusable admission token.
create policy admission_pass_private_tokens on public.qr_redemptions
  as restrictive for select to authenticated
  using (admission_pass_version is null or public.is_admin() or public.is_current_venue_owner(venue_id));

create or replace function public.protect_admission_pass()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.admission_pass_version=1 and current_user in ('anon','authenticated') then
    raise exception using errcode='42501',message='Use the authorized admission pass workflow.';
  end if;
  if tg_op='INSERT' then return new;end if;
  if row(new.admission_pass_version,new.arrival_method,new.expires_at,new.venue_id,new.club_deal_id,new.customer_id,new.session_id,new.redemption_token,new.source_type,new.dancer_id,new.shift_id,new.audit)
    is distinct from row(old.admission_pass_version,old.arrival_method,old.expires_at,old.venue_id,old.club_deal_id,old.customer_id,old.session_id,old.redemption_token,old.source_type,old.dancer_id,old.shift_id,old.audit)
    and (old.admission_pass_version is not null or new.admission_pass_version is not null) then
    raise exception using errcode='42501',message='Issued pass details cannot be changed.';
  end if;
  if old.admission_pass_version=1 and old.status='redeemed' and
    row(new.status,new.redeemed_at,new.redeemed_by_user_id,new.arrival_verified_at)
      is distinct from row(old.status,old.redeemed_at,old.redeemed_by_user_id,old.arrival_verified_at) then
    raise exception using errcode='42501',message='Recorded admission cannot be changed.';
  end if;
  return new;
end $$;
create trigger protect_admission_pass before insert or update on public.qr_redemptions
  for each row execute function public.protect_admission_pass();
revoke all on function public.protect_admission_pass() from public,anon,authenticated;

create or replace function public.issue_admission_pass(
  p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,
  p_source text,p_dancer_id uuid,p_shift_id uuid,p_arrival_method text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.club_deals; v public.venues; r public.qr_redemptions; stamp timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_session_id is null
    or p_source is null or p_source not in ('club_page','dancer_profile')
    or p_arrival_method is null or p_arrival_method not in ('self_drive','club_shuttle','autonomous_cab','waymo','zoox','cybercab')
    or (p_source='dancer_profile' and (p_dancer_id is null or p_shift_id is null))
    or (p_source='club_page' and (p_dancer_id is not null or p_shift_id is not null)) then
    raise exception using errcode='22023',message='Check the admission pass details.';
  end if;
  select * into d from public.club_deals where id=p_deal_id and is_active=true;
  if not found then raise exception using errcode='22023',message='This offer is no longer available.';end if;
  perform pg_advisory_xact_lock(hashtext(d.venue_id::text),hashtext(p_session_id::text));
  if p_customer_id is not null then
    perform pg_advisory_xact_lock(hashtext(d.venue_id::text),hashtext(p_customer_id::text));
    if not exists(select 1 from public.app_users where id=p_customer_id and role='customer' and account_state='active') then
      raise exception using errcode='42501',message='An active customer account is required.';
    end if;
  end if;
  select * into v from public.venues where id=d.venue_id and is_active=true
    and page_review_status='published' and published_at is not null;
  if not found or not exists(select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active') then
    raise exception using errcode='22023',message='This venue is unavailable.';
  end if;
  stamp:=clock_timestamp();
  if exists(select 1 from public.qr_redemptions where venue_id=v.id and status='redeemed'
    and redeemed_at>stamp-interval '24 hours' and (session_id=p_session_id::text or customer_id=p_customer_id)) then
    raise exception using errcode='23505',message='Admission has already been redeemed at this venue in the last 24 hours.';
  end if;
  -- Repeated submissions return the same usable pass. A changed selection
  -- supersedes an unused pass, without rewriting its historical attribution.
  select * into r from public.qr_redemptions where venue_id=v.id and admission_pass_version=1
    and status='generated' and expires_at>stamp and (session_id=p_session_id::text or customer_id=p_customer_id)
    order by generated_at desc limit 1;
  if found and r.club_deal_id=d.id and r.arrival_method=p_arrival_method then
    return jsonb_build_object('token',r.redemption_token,'expiresAt',r.expires_at);
  end if;
  update public.qr_redemptions set status='voided' where venue_id=v.id and admission_pass_version=1
    and status='generated' and (session_id=p_session_id::text or customer_id=p_customer_id);
  insert into public.qr_redemptions(redemption_token,venue_id,club_deal_id,source_type,dancer_id,shift_id,
    attribution_locked_at,customer_id,session_id,expires_at,admission_pass_version,arrival_method,audit)
  values(p_token,v.id,d.id,p_source,p_dancer_id,p_shift_id,case when p_source='dancer_profile' then stamp end,
    p_customer_id,p_session_id::text,stamp+interval '12 hours',1,p_arrival_method,
    jsonb_build_object('admission_policy','staff-verified-v1','deal_snapshot',jsonb_build_object(
      'dealTitle',d.deal_title,'dealDescription',d.deal_description,'dealTerms',d.deal_terms,'offerType',d.offer_type,'bookingUrl',null)))
    returning * into r;
  return jsonb_build_object('token',r.redemption_token,'expiresAt',r.expires_at);
end $$;
revoke all on function public.issue_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text) to service_role;

create or replace function public.confirm_admission_pass(p_token text,p_arrival_verified boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.qr_redemptions; d public.club_deals; v public.venues; actor uuid:=auth.uid();
  stamp timestamptz; local_time timestamp; offer_day date;
begin
  if actor is null then raise exception using errcode='42501',message='Venue staff sign-in is required.';end if;
  select * into r from public.qr_redemptions where redemption_token=p_token and admission_pass_version=1;
  if not found then raise exception using errcode='22023',message='This admission pass is unavailable.';end if;
  perform pg_advisory_xact_lock(hashtext(r.venue_id::text),hashtext(r.session_id));
  if r.customer_id is not null then perform pg_advisory_xact_lock(hashtext(r.venue_id::text),hashtext(r.customer_id::text));end if;
  select * into r from public.qr_redemptions where redemption_token=p_token for update;
  -- Recheck current authorization after waiting for locks. auth.uid() is the
  -- authenticated Supabase identity; no client-supplied staff/venue ID is used.
  select * into v from public.venues where id=r.venue_id and is_active=true
    and page_review_status='published' and published_at is not null;
  if not found or not exists(select 1 from public.app_users where id=actor and role='venue' and account_state='active')
    or not exists(select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active')
    or not (v.owner_user_id=actor or exists(select 1 from public.venue_team_members
      where venue_id=v.id and user_id=actor and status='active' and role in ('manager','staff'))) then
    raise exception using errcode='42501',message='Only authorized staff for this venue can redeem this pass.';
  end if;
  if r.status='redeemed' then
    return jsonb_build_object('status','redeemed','alreadyRedeemed',true,'redeemedAt',r.redeemed_at);
  end if;
  stamp:=clock_timestamp();
  if r.status<>'generated' or r.expires_at<=stamp then
    raise exception using errcode='22023',message='This admission pass has expired or is no longer valid.';
  end if;
  if p_arrival_verified is distinct from true then
    raise exception using errcode='22023',message='Verify the guest arrival method before admitting them.';
  end if;
  select * into d from public.club_deals where id=r.club_deal_id and venue_id=r.venue_id and is_active=true;
  if not found then raise exception using errcode='22023',message='This offer is no longer available.';end if;
  local_time:=stamp at time zone coalesce(nullif(v.timezone,''),'UTC');
  offer_day:=local_time::date;
  if d.valid_start_time is not null and d.valid_end_time is not null and d.valid_start_time>d.valid_end_time then
    if local_time::time>=d.valid_end_time and local_time::time<d.valid_start_time then
      raise exception using errcode='22023',message='This offer is outside its valid admission hours.';
    end if;
    if local_time::time<d.valid_end_time then offer_day:=offer_day-1;end if;
  elsif (d.valid_start_time is not null and local_time::time<d.valid_start_time and d.valid_start_time is distinct from d.valid_end_time)
    or (d.valid_end_time is not null and local_time::time>=d.valid_end_time and d.valid_start_time is distinct from d.valid_end_time) then
    raise exception using errcode='22023',message='This offer is outside its valid admission hours.';
  end if;
  if cardinality(d.valid_days)>0 and not exists(select 1 from unnest(d.valid_days) day
    where lower(left(trim(day),3))=lower(to_char(offer_day,'Dy'))) then
    raise exception using errcode='22023',message='This offer is not valid on this admission date.';
  end if;
  if exists(select 1 from public.qr_redemptions where id<>r.id and venue_id=r.venue_id and status='redeemed'
    and redeemed_at>stamp-interval '24 hours' and (session_id=r.session_id or customer_id=r.customer_id)) then
    raise exception using errcode='23505',message='Admission has already been redeemed at this venue in the last 24 hours.';
  end if;
  update public.qr_redemptions set status='redeemed',redeemed_at=stamp,confirmed_at=stamp,
    first_scanned_at=coalesce(first_scanned_at,stamp),redeemed_by_user_id=actor,arrival_verified_at=stamp where id=r.id;
  insert into public.qr_redemption_events(qr_redemption_id,event_type,actor_user_id,audit)
    values(r.id,'venue_confirmed',actor,jsonb_build_object('method','staff_qr_scan','arrival_method',r.arrival_method,'admission_policy','staff-verified-v1'));
  return jsonb_build_object('status','redeemed','alreadyRedeemed',false,'redeemedAt',stamp);
end $$;
revoke all on function public.confirm_admission_pass(text,boolean) from public,anon,service_role;
grant execute on function public.confirm_admission_pass(text,boolean) to authenticated;

-- Aggregate-only access lets authorized door staff see venue totals without
-- granting them access to customer IDs, pass tokens or individual pass rows.
create or replace function public.get_venue_admission_metrics(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not exists(select 1 from public.venues v join public.app_users owner_account on owner_account.id=v.owner_user_id
    join public.app_users viewer on viewer.id=auth.uid()
    where v.id=p_venue_id and v.is_active=true and owner_account.role='venue' and owner_account.account_state='active'
    and viewer.role='venue' and viewer.account_state='active' and (v.owner_user_id=auth.uid() or exists(
      select 1 from public.venue_team_members m where m.venue_id=v.id and m.user_id=auth.uid() and m.status='active' and m.role in ('manager','staff')))) then
    raise exception using errcode='42501',message='Venue access denied.';
  end if;
  if p_since is null or p_until is null or p_until<=p_since or p_until-p_since>interval '32 days' then
    raise exception using errcode='22023',message='Choose a valid analytics period.';
  end if;
  select jsonb_build_object(
    'claims',count(*) filter(where admission_pass_version=1 and generated_at>=p_since and generated_at<p_until),
    'cohortRedemptions',count(*) filter(where admission_pass_version=1 and generated_at>=p_since and generated_at<p_until and status='redeemed'),
    'redemptions',count(*) filter(where status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until),
    'previousRedemptions',count(*) filter(where status='redeemed' and redeemed_at>=p_since-(p_until-p_since) and redeemed_at<p_since)
  ) into result from public.qr_redemptions where venue_id=p_venue_id
    and (generated_at>=p_since or redeemed_at>=p_since-(p_until-p_since));
  return result;
end $$;
revoke all on function public.get_venue_admission_metrics(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.get_venue_admission_metrics(uuid,timestamptz,timestamptz) to authenticated;

-- Existing NFC stickers still authorize dancer verification/check-in. Retire
-- only the customer cashier money-creation paths, including stale applications.
revoke all on function public.confirm_deal_redemption(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.issue_and_confirm_deal_redemption_from_nfc(text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,jsonb)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
