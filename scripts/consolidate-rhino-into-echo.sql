-- Rebrand the existing Echo account in place. Keep its IDs, login, offers,
-- QR/NFC links and history; return the 50 previously transferred demo shifts.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare
  target uuid := '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
  source_venue uuid := '11fd5e46-d24f-4a02-87f6-2aa18b0876ae';
  target_owner uuid := '02b3af5c-779e-4d3c-af08-b70ae0b31de5';
  before_roster integer;
  before_sessions integer;
  affected integer;
  relation record;
  has_rows boolean;
begin
  perform 1 from public.venues where id in (target,source_venue) order by id for update;
  if not exists(select 1 from public.venues where id=target and slug='talk-of-the-town'
    and owner_user_id=target_owner and is_active and name='Echo House') then
    raise exception 'Expected original active Echo House account; inspect before retrying';
  end if;
  if not exists(select 1 from public.venues v join auth.users u on u.id=v.owner_user_id
    where v.id=source_venue and v.slug='spearmint-rhino-las-vegas-demo' and v.is_active
      and u.raw_app_meta_data->>'dataset_marker'='mydancr-spearmint-rhino-las-vegas-demo-v1'
      and u.banned_until>now()) then raise exception 'Expected the separate disabled-login Rhino demo'; end if;
  if not exists(select 1 from public.club_deals where venue_id=target and is_active
    and offer_type='admission' and deal_title='Free admission' and payout_amount_cents>0) then
    raise exception 'Existing Free Entry offer must remain available';
  end if;
  if exists(select 1 from public.club_deals where venue_id=source_venue and is_active) then
    raise exception 'Source now has an active offer; review before merging';
  end if;
  -- Fail closed if new operational data has appeared since this merge was reviewed.
  for relation in select c.table_name from information_schema.columns c
    join information_schema.tables t using(table_schema,table_name)
    where c.table_schema='public' and c.column_name='venue_id' and t.table_type='BASE TABLE'
      and c.table_name not in ('club_deals','dancer_shift_channels','internal_roster_links','shifts',
        'venue_dancer_affiliations','venue_dancer_work_sessions','venue_guest_colors','venue_interactions','venue_page_events')
  loop
    execute format('select exists(select 1 from public.%I where venue_id=$1)',relation.table_name) into has_rows using source_venue;
    if has_rows then raise exception 'New source data in %, review merge first',relation.table_name; end if;
  end loop;
  perform 1 from public.shifts where venue_id=source_venue for update;
  if (select count(*) from public.shifts where venue_id=source_venue)<>50
    or (select count(*) from public.shifts s join public.venue_dancer_affiliations a
      on a.id=(s.shift_summary->>'previousDemoAffiliationId')::uuid and a.dancer_id=s.dancer_id and a.venue_id=target
      where s.venue_id=source_venue and s.shift_summary->>'demoAssignment'='mydancr-spearmint-rhino-las-vegas-demo-v1'
        and s.shift_summary->>'previousDemoVenueId'=target::text and a.status='active' and not a.reentry_blocked
        and a.revoked_at is null and s.checked_out_at is null)<>50 then
    raise exception 'Expected 50 original shifts with active Echo affiliations';
  end if;
  select count(*) into before_roster from public.internal_roster_members(target);
  select count(*) into before_sessions from public.venue_dancer_work_sessions where venue_id in (target,source_venue);

  -- Move existing sessions before shifts so the attendance trigger preserves each
  -- session instead of inventing another checkout/check-in during the merge.
  update public.dancer_shift_channels set venue_id=target where venue_id=source_venue;
  update public.venue_dancer_work_sessions set venue_id=target where venue_id=source_venue;
  update public.shifts set venue_id=target,
    venue_affiliation_id=(shift_summary->>'previousDemoAffiliationId')::uuid,
    shift_summary=shift_summary || jsonb_build_object('rhinoConsolidatedAt',now(),'rhinoConsolidatedInto',target)
    where venue_id=source_venue;
  get diagnostics affected=row_count;
  if affected<>50 then raise exception 'Incomplete shift transfer'; end if;
  update public.internal_roster_links set venue_id=target where venue_id=source_venue;
  update public.venue_interactions set venue_id=target where venue_id=source_venue;
  -- The same session's daily page view counts once after consolidation.
  delete from public.venue_page_events s using public.venue_page_events t
    where s.venue_id=source_venue and t.venue_id=target and s.event_type=t.event_type
      and s.source=t.source and s.session_id=t.session_id and s.occurred_on=t.occurred_on;
  update public.venue_page_events set venue_id=target where venue_id=source_venue;
  insert into public.venue_guest_colors(venue_id,internal_accent,embed_accent,updated_by)
    values(target,'#b8860b','#b8860b',target_owner)
    on conflict(venue_id) do update set internal_accent=excluded.internal_accent,
      embed_accent=excluded.embed_accent,updated_by=excluded.updated_by,updated_at=now();
  update public.venues set name='Spearmint Rhino Las Vegas',
    address='3340 S Highland Dr, Las Vegas, NV 89109',phone='702-796-3600',website='https://spearmintrhinolv.com/',
    latitude=null,longitude=null,
    logo_storage_path=target_owner::text || '/' || target::text || '/spearmint-rhino-las-vegas.png',
    logo_updated_at=now(),updated_at=now()
    where id=target;
  update public.app_users set display_name='Spearmint Rhino Las Vegas',updated_at=now() where id=target_owner;
  update public.venues set is_active=false,
    page_review_notes='Consolidated into original Echo House account 260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af; retained for history.',updated_at=now()
    where id=source_venue;

  if (select count(*) from public.internal_roster_members(target))<>before_roster+50 then raise exception 'Merged roster does not match'; end if;
  if not exists(select 1 from public.internal_roster_members(target) where id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2') then raise exception 'Star missing'; end if;
  if (select count(*) from public.venue_dancer_work_sessions where venue_id=target)<>before_sessions then raise exception 'Attendance history changed'; end if;
  if exists(select 1 from public.internal_roster_members(source_venue)) then raise exception 'Duplicate roster still visible'; end if;
end $$;
commit;
