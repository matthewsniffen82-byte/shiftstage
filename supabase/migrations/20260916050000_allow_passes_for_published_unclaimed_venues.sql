begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Admin-published venues can have a live admission offer before an owner claims
-- the page. Claiming a pass does not record arrival or redeem admission. Keep
-- active offer/publication checks and reject disabled linked owner accounts.
-- Staff authorization, arrival verification, RLS and redemption stay unchanged.
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
  if not found or (v.owner_user_id is not null and not exists(
    select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active')) then
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

notify pgrst,'reload schema';
commit;
