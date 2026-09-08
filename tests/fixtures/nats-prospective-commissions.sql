-- Run ONLY in the same transaction as the candidate migration, ending in
-- ROLLBACK. No NATS API, payment provider, media operation, or user notification
-- is invoked. Existing accounts are referenced but never changed.
create function pg_temp.redeem_nats_fixture(
  p_venue uuid, p_deal uuid, p_tag uuid, p_dancer uuid, p_shift uuid
) returns jsonb language plpgsql as $$
begin
  return public.issue_and_confirm_deal_redemption_from_nfc(
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_tag, gen_random_uuid(), p_venue, p_deal, 'dancer_profile',
    p_dancer, p_shift, null, clock_timestamp() + interval '1 hour',
    '{"test":"nats_enrollment_rollback_only"}'::jsonb
  );
end;
$$;

do $$
declare
  v_venue uuid; v_deal uuid; v_tag uuid; v_dancer uuid; v_shift uuid; v_admin uuid;
  v_result jsonb; v_pre uuid; v_pre_requested uuid; v_post uuid;
  v_disabled uuid; v_reactivated uuid; v_earning uuid;
  v_started timestamptz := clock_timestamp(); v_activated timestamptz;
  v_reactivated_at timestamptz; v_bps integer; v_base integer; v_i integer;
  v_login bigint := 900000000 + floor(random() * 100000000)::bigint;
begin
  select v.id, d.id, t.id into strict v_venue, v_deal, v_tag
  from public.venues v join public.app_users u on u.id=v.owner_user_id
  join public.nfc_tags t on t.venue_id=v.id
  join public.club_deals d on d.venue_id=v.id
  join public.venue_referral_fee_terms f on f.venue_id=v.id
  where v.is_active and u.role='venue' and u.account_state='active'
    and t.status='active' and t.tag_type='cashier' and d.is_active
    and f.superseded_at is null and f.effective_from<=clock_timestamp()
    and (f.effective_until is null or f.effective_until>clock_timestamp())
  order by v.id, d.id, t.id limit 1;
  select s.dancer_id, s.id into strict v_dancer, v_shift
  from public.shifts s
  where not exists(select 1 from public.nats_affiliate_accounts a where a.dancer_id=s.dancer_id)
  order by s.id limit 1;
  select id into strict v_admin from public.app_users where role='admin' order by id limit 1;

  -- No account: redeem normally, retain attribution, create no dancer earning.
  v_result := pg_temp.redeem_nats_fixture(v_venue,v_deal,v_tag,v_dancer,v_shift);
  v_pre := (v_result->>'revenueEventId')::uuid;
  if (v_result->>'dancerCommissionCents')::integer <> 0
    or (v_result->>'dancerCommissionEligible')::boolean
    or (v_result->>'grossCommissionCents')::integer <>
      (v_result->>'platformCommissionCents')::integer + (v_result->>'agentCommissionCents')::integer
    or not exists(select 1 from public.deal_revenue_events where id=v_pre and dancer_id=v_dancer and source_type='dancer_profile')
    or exists(select 1 from public.commission_events where qr_redemption_id=(v_result->>'redemptionId')::uuid)
  then raise exception 'Unenrolled redemption allocation failed'; end if;

  insert into public.nats_affiliate_accounts(dancer_id,login_id,status,activated_at)
  values(v_dancer,v_login,'requested',clock_timestamp()-interval '1 year');
  if exists(select 1 from public.nats_affiliate_accounts where dancer_id=v_dancer and activated_at is not null)
  then raise exception 'Requested account accepted a fake enrollment time'; end if;
  v_result := pg_temp.redeem_nats_fixture(v_venue,v_deal,v_tag,v_dancer,v_shift);
  v_pre_requested := (v_result->>'revenueEventId')::uuid;
  if (v_result->>'dancerCommissionCents')::integer <> 0
  then raise exception 'Requested account earned commission'; end if;

  update public.nats_affiliate_accounts set status='active', verified_by=v_admin,
    activated_at=clock_timestamp()-interval '1 year' where dancer_id=v_dancer
  returning activated_at into v_activated;
  if v_activated < v_started then raise exception 'Activation was backdated'; end if;
  update public.nats_affiliate_accounts set activated_at=clock_timestamp()-interval '1 year'
  where dancer_id=v_dancer;
  if (select activated_at from public.nats_affiliate_accounts where dancer_id=v_dancer) <> v_activated
  then raise exception 'Active enrollment time was changed'; end if;
  if exists(select 1 from public.deal_revenue_events where id in(v_pre,v_pre_requested) and dancer_commission_eligible)
    or exists(select 1 from public.commission_events c join public.deal_revenue_events r on r.qr_redemption_id=c.qr_redemption_id where r.id in(v_pre,v_pre_requested))
  then raise exception 'Enrollment created back pay'; end if;

  -- Existing eligible events, if any, retain their monthly progress.
  select count(*)::integer into v_base from public.deal_revenue_events r
  join public.venues v on v.id=v_venue
  where r.dancer_id=v_dancer and r.dancer_commission_eligible
    and r.commission_month=date_trunc('month',timezone(coalesce(nullif(v.timezone,''),'UTC'),clock_timestamp()))::date
    and r.status not in('voided','refunded');
  for v_i in 1..25 loop
    v_result := pg_temp.redeem_nats_fixture(v_venue,v_deal,v_tag,v_dancer,v_shift);
    v_bps := case when v_base+v_i>=25 then 5000 when v_base+v_i>=10 then 4000 else 3000 end;
    if (v_result->>'successfulRedemptionNumber')::integer <> v_base+v_i
      or (v_result->>'dancerShareBps')::integer <> v_bps
      or (v_result->>'dancerCommissionCents')::integer <>
        round((v_result->>'grossCommissionCents')::integer*v_bps/10000.0)::integer
      or not (v_result->>'dancerCommissionEligible')::boolean
    then raise exception 'Eligible redemption tier % failed', v_i; end if;
    if v_i=1 then
      v_post := (v_result->>'revenueEventId')::uuid;
      select id into strict v_earning from public.commission_events
      where qr_redemption_id=(v_result->>'redemptionId')::uuid;
    end if;
  end loop;

  update public.commission_events set status='available' where id=v_earning;
  update public.commission_events set review_flag=null where id=v_earning;
  if (select count(*) from public.nats_commission_exports where commission_event_id=v_earning) <> 1
  then raise exception 'Duplicate or missing eligible export'; end if;

  update public.nats_affiliate_accounts set status='disabled' where dancer_id=v_dancer;
  v_result := pg_temp.redeem_nats_fixture(v_venue,v_deal,v_tag,v_dancer,v_shift);
  v_disabled := (v_result->>'revenueEventId')::uuid;
  if (v_result->>'dancerCommissionCents')::integer <> 0
  then raise exception 'Disabled account earned new commission'; end if;
  if exists(select 1 from public.claim_nats_commission_exports(500) where commission_event_id=v_earning)
  then raise exception 'Disabled account export was claimed'; end if;

  update public.nats_affiliate_accounts set status='requested', activated_at=null where dancer_id=v_dancer;
  update public.nats_affiliate_accounts set status='active', verified_by=v_admin where dancer_id=v_dancer
  returning activated_at into v_reactivated_at;
  if v_reactivated_at <= v_activated then raise exception 'Reactivation did not start a new enrollment'; end if;
  if exists(select 1 from public.deal_revenue_events where id=v_disabled and dancer_commission_eligible)
  then raise exception 'Reactivation credited a disabled-period tap'; end if;
  if not public.is_nats_eligible_club_deal_earning(v_earning)
  then raise exception 'Reactivation invalidated a previously earned commission'; end if;
  if not exists(select 1 from public.claim_nats_commission_exports(500) where commission_event_id=v_earning)
  then raise exception 'Previously earned commission could not be claimed after reactivation'; end if;
  if exists(select 1 from public.claim_nats_commission_exports(500) where commission_event_id=v_earning)
  then raise exception 'Export was claimed twice'; end if;
  v_result := pg_temp.redeem_nats_fixture(v_venue,v_deal,v_tag,v_dancer,v_shift);
  v_reactivated := (v_result->>'revenueEventId')::uuid;
  if not exists(select 1 from public.deal_revenue_events where id=v_reactivated and dancer_nats_activated_at=v_reactivated_at)
  then raise exception 'New redemption did not snapshot reactivation'; end if;

  begin
    update public.deal_revenue_events set confirmed_at=clock_timestamp() where id=v_post;
    raise exception 'Expected immutable eligibility rejection';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.commission_events(qr_redemption_id,venue_id,club_deal_id,dancer_id,
      status,amount_cents,payout_type,gross_commission_cents,dancer_share_bps,platform_amount_cents)
    select qr_redemption_id,venue_id,club_deal_id,dancer_id,'pending',100,'flat',gross_commission_cents,3000,platform_commission_cents
    from public.deal_revenue_events where id=v_pre;
    raise exception 'Expected back-pay insert rejection';
  exception when sqlstate '22023' then null;
  end;
  if has_function_privilege('anon','public.is_nats_eligible_club_deal_earning(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb)','EXECUTE')
  then raise exception 'Browser role can access financial RPC'; end if;
end;
$$;
select 'nats_prospective_redemption_checks_passed' as result;
