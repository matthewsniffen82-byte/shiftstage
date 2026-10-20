-- One-time sample activity requested for Spearmint Rhino's dashboard.
-- Rehearse with the final COMMIT changed to ROLLBACK, then apply unchanged.
-- Fictional contacts only. No notifications, transport dispatch, billing,
-- subscriptions, real guest accounts, or dancer attribution are created.
-- Stable IDs make retries safe and preserve subsequent staff decisions.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('mydancr-rhino-guest-rides-20261020-v1'));

do $seed$
declare
  marker constant text := 'mydancr-rhino-guest-rides-20261020-v1';
  venue constant uuid := '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
  manager constant uuid := 'e7adabbd-5d07-46ba-bb18-0081094162fb';
  deal uuid;
  stamp timestamptz := now();
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  names text[] := array['Jordan Ellis','Morgan Hayes','Alex Carter','Taylor Brooks',
    'Casey Bennett','Riley Parker','Jamie Collins','Avery Reed'];
  locations text[] := array['Bellagio, main valet pickup','ARIA, main entrance valet',
    'The Venetian, main lobby pickup','Wynn, south entrance valet',
    'Caesars Palace, main valet pickup','The Cosmopolitan, main valet pickup'];
  ride_states text[] := array['received','received','contacted','arranged','completed','cancelled'];
  party_sizes integer[] := array[2,4,3,6,2,5];
  n integer;
  key uuid;
  issued timestamptz;
  guest_email text;
  guest_phone text;
  details jsonb;
begin
  if not exists(select 1 from public.venues where id=venue and name='Spearmint Rhino'
    and slug='talk-of-the-town' and city='Las Vegas' and is_active
    and timezone='America/Los_Angeles') then
    raise exception 'Expected the active Spearmint Rhino Las Vegas venue';
  end if;
  if not exists(select 1 from public.venue_team_members where venue_id=venue
    and user_id=manager and role='manager' and status='active') then
    raise exception 'Expected the existing Rhino dashboard manager';
  end if;
  select id into strict deal from public.club_deals
    where id='4bdab0c0-f3a4-4716-a958-f51cca470dcc' and venue_id=venue
      and is_active and removed_at is null and offer_type='admission';

  for n in 1..8 loop
    key := md5(marker||':guest:'||n)::uuid;
    issued := greatest(day_start + interval '1 minute', stamp - make_interval(mins => n*3));
    guest_email := 'rhino-guest-'||n||'@synthetic.mydancr.invalid';
    guest_phone := '+170255501'||lpad((70+n)::text,2,'0');
    if exists(select 1 from public.qr_redemptions where id=key
      and (venue_id<>venue or audit->>'dataset_marker' is distinct from marker)) then
      raise exception 'Sample pass ID conflicts with existing data';
    end if;
    insert into public.qr_redemptions(id,redemption_token,venue_id,club_deal_id,
      source_type,session_id,generated_at,created_at,expires_at,status,redeemed_at,
      admission_pass_version,arrival_method,audit)
    values(key,gen_random_uuid()::text||gen_random_uuid()::text,venue,deal,
      'club_page',marker||':guest:'||n,issued,issued,stamp+interval '24 hours',
      case when n<=6 then 'generated' else 'redeemed' end,
      case when n>6 then stamp-interval '1 minute' end,1,'guest_list',
      jsonb_build_object('dataset_marker',marker,'fictional',true,'simulated_consent',true,
        'simulated_admission',n>6,'admission_policy','staff-verified-v1',
        'deal_snapshot',jsonb_build_object('dealTitle','Free admission','offerType','admission')))
    on conflict(id) do nothing;
    insert into public.venue_guest_list_entries(pass_id,venue_id,guest_name,phone,email,consented_at,created_at)
    values(key,venue,names[n],guest_phone,guest_email,issued,issued)
    on conflict(pass_id) do nothing;

    if n<=6 then
      -- The ride reader requires UUID v4 version/variant bits.
      key := overlay(overlay(md5(marker||':ride:'||n) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
      if exists(select 1 from public.club_shuttle_requests where id=key
        and (venue_id<>venue or notification_rows->0->'payload'->>'dataset_marker' is distinct from marker)) then
        raise exception 'Sample ride ID conflicts with existing data';
      end if;
      details := jsonb_build_object('kind','club_shuttle_request','requestId',key,
        'venueId',venue,'dealId',deal,'name',names[n],'email',guest_email,'phone',guest_phone,
        'location',locations[n],'partySize',party_sizes[n],
        'dataset_marker',marker,'fictional',true,'notifications_suppressed',true);
      -- Keep the receipt in its completed handoff state so retries cannot send
      -- the synthetic payload to the manager. Do not create notifications.
      insert into public.club_shuttle_requests(id,venue_id,deal_id,details_hash,notification_rows,
        venue_phone,created_at,handed_off_at,staff_status)
      values(key,venue,deal,encode(sha256(convert_to(details::text,'UTF8')),'hex'),
        jsonb_build_array(jsonb_build_object('id',md5(marker||':notice:'||n)::uuid,
          'recipient_id',manager,'notification_type','support_message','channel','in_app',
          'title','Sample shuttle request','body','Fictional dashboard sample; no ride dispatched.',
          'payload',details)),null,issued,stamp,ride_states[n])
      on conflict(id) do nothing;
    end if;
  end loop;

  if (select count(*) from public.qr_redemptions q join public.venue_guest_list_entries g on g.pass_id=q.id
      where q.venue_id=venue and g.venue_id=venue and q.audit->>'dataset_marker'=marker)<>8
    or (select count(*) from public.club_shuttle_requests where venue_id=venue
      and notification_rows->0->'payload'->>'dataset_marker'=marker)<>6 then
    raise exception 'Incomplete Rhino sample lists';
  end if;
  if exists(select 1 from public.notifications where payload->>'dataset_marker'=marker) then
    raise exception 'Sample records must not send notifications';
  end if;
end $seed$;

set constraints all immediate;
select 'mydancr-rhino-guest-rides-20261020-v1' dataset_marker,
  (select count(*) from public.qr_redemptions q join public.venue_guest_list_entries g on g.pass_id=q.id
    where q.audit->>'dataset_marker'='mydancr-rhino-guest-rides-20261020-v1') guest_entries,
  (select count(*) from public.club_shuttle_requests
    where notification_rows->0->'payload'->>'dataset_marker'='mydancr-rhino-guest-rides-20261020-v1') ride_requests;
commit;
