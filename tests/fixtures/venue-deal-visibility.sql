-- Run after the migration in a transaction that will be rolled back.
do $$
declare
  v_venue public.venues;
  v_admin uuid;
  v_deal_one uuid;
  v_deal_two uuid;
  v_request public.venue_club_deal_requests;
  v_rejected boolean := false;
begin
  select id into strict v_admin from public.app_users where role = 'admin' and account_state = 'active' limit 1;
  insert into public.venues(name, slug, city, state, address, latitude, longitude, is_active)
    values ('Visibility QA', 'visibility-qa-' || gen_random_uuid(), 'Phoenix', 'AZ', 'QA', 33.45, -112.07, true)
    returning * into v_venue;
  if public.has_active_club_deal(v_venue) then raise exception 'No-deal venue must be hidden'; end if;
  insert into public.club_deals(venue_id, deal_title, is_active, payout_type, payout_amount_cents, offer_type)
    values(v_venue.id, 'Free admission', true, 'flat', 100, 'admission') returning id into v_deal_one;
  insert into public.club_deals(venue_id, deal_title, is_active, payout_type, payout_amount_cents, offer_type)
    values(v_venue.id, 'Skip the line', true, 'flat', 100, 'admission') returning id into v_deal_two;
  if not public.has_active_club_deal(v_venue) then raise exception 'Active deal must show venue'; end if;
  update public.club_deals set is_active = false where id = v_deal_one;
  if not public.has_active_club_deal(v_venue) then raise exception 'One remaining deal must show venue'; end if;
  insert into public.venue_club_deal_requests(venue_id, requested_by_user_id, request_type, target_deal_id, offer_key, offer_title)
    values(v_venue.id, v_admin, 'remove', v_deal_two, 'skip_the_line', 'Skip the line') returning * into v_request;
  begin
    perform public.approve_venue_deal_removal(v_request.id, v_venue.id, gen_random_uuid());
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Non-admin approval must fail'; end if;
  v_request := public.approve_venue_deal_removal(v_request.id, v_venue.id, v_admin);
  if v_request.status <> 'approved' then raise exception 'Removal must be recorded'; end if;
  if not exists (select 1 from public.club_deals where id = v_deal_two and removed_at is not null and not is_active) then raise exception 'Removed deal history must be retained'; end if;
  if public.has_active_club_deal(v_venue) then raise exception 'Last-deal removal must hide venue'; end if;
  if not (select is_active from public.venues where id = v_venue.id) then raise exception 'Page approval must be preserved'; end if;
  v_rejected := false;
  begin
    perform public.approve_venue_deal_removal(v_request.id, v_venue.id, v_admin);
  exception when raise_exception then v_rejected := true; end;
  if not v_rejected then raise exception 'Already-reviewed removal must fail'; end if;
  update public.club_deals set is_active = true where id = v_deal_one;
  if not public.has_active_club_deal(v_venue) then raise exception 'Venue must return when a deal returns'; end if;
  if has_function_privilege('authenticated', 'public.approve_venue_deal_removal(uuid,uuid,uuid)', 'execute') then raise exception 'Removal RPC must be server only'; end if;
end;
$$;
select 'VENUE_DEAL_VISIBILITY_AND_REMOVAL_PASS' as result;
