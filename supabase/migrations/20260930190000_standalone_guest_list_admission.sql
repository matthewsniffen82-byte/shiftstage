begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Guest-list registration is a third admission path, separate from transportation.
alter table public.qr_redemptions drop constraint admission_pass_fields;
alter table public.qr_redemptions add constraint admission_pass_fields check (
  admission_pass_version is null or
  (admission_pass_version=1 and arrival_method is not null and arrival_method in
    ('self_drive','club_shuttle','autonomous_cab','waymo','zoox','cybercab','guest_list'))
);

create or replace function public.issue_admission_pass(
  p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,
  p_source text,p_dancer_id uuid,p_shift_id uuid,p_arrival_method text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.club_deals; v public.venues; r public.qr_redemptions; stamp timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_session_id is null
    or p_source is null or p_source not in ('club_page','dancer_profile')
    or p_arrival_method is null or p_arrival_method not in ('self_drive','club_shuttle','autonomous_cab','waymo','zoox','cybercab','guest_list')
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

-- The guest-list RPC writes the pass and private contact details in one transaction.
-- A direct call to the generic issuer cannot leave a guest-list pass without details.
create function public.require_guest_list_pass_details()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.qr_redemptions where id=new.id)
    and not exists(select 1 from public.venue_guest_list_entries where pass_id=new.id and venue_id=new.venue_id) then
    raise exception using errcode='22023',message='Enter your guest-list details and agree to share them with the club.';
  end if;
  return null;
end $$;
revoke all on function public.require_guest_list_pass_details() from public,anon,authenticated,service_role;
create constraint trigger guest_list_pass_requires_details
  after insert or update on public.qr_redemptions deferrable initially deferred
  for each row when (new.admission_pass_version=1 and new.arrival_method='guest_list')
  execute function public.require_guest_list_pass_details();

notify pgrst,'reload schema';
commit;
