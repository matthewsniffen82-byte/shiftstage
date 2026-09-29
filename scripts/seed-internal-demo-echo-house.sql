-- Operator-run fictional data setup; apply after the demo-roster migration.
-- Moves these five existing demo assignments to Echo House; does not simulate NFC or Ondato.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create temp table internal_demo_plan on commit drop as
select d.id dancer_id,d.slug,s.id shift_id,s.venue_id previous_venue_id
from public.dancer_profiles d
join auth.users u on u.id=d.user_id
join public.app_users a on a.id=d.user_id and a.role='dancer' and a.account_state='active'
join public.shifts s on s.dancer_id=d.id
where d.slug in ('layout-review-01','layout-review-02','layout-review-03','layout-review-04','layout-review-05')
  and u.email=d.slug || '@synthetic.mydancr.invalid'
  and u.raw_user_meta_data->>'dataset_marker'='mydancr-layout-review-v1'
  and u.banned_until>now()
  and d.status='approved' and d.verification_status='approved' and d.photo_review_status='approved'
  and d.disabled_at is null and d.is_public and nullif(d.avatar_storage_path,'') is not null
  and s.shift_source='demo_locked' and s.status='posted' and s.checked_in_at is not null
  and s.checked_out_at is null and s.location_status='club_confirmed'
  and s.location_verification_expires_at>now();

do $$
begin
  if (select count(*) from internal_demo_plan)<>5 or (select count(distinct dancer_id) from internal_demo_plan)<>5 then
    raise exception 'Expected exactly five eligible fictional profiles with one active demo shift each';
  end if;
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false) then
    raise exception 'Demo roster setup is disabled when real age enforcement is active';
  end if;
  if not exists(select 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
    where v.id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and v.name='Echo House'
      and v.is_active and u.role='venue' and u.account_state='active') then
    raise exception 'The intended active demo venue is unavailable';
  end if;
  if exists(select 1 from public.dancer_channel_preferences p join internal_demo_plan d on d.dancer_id=p.dancer_id where p.visibility<>'both') then
    raise exception 'Refusing to overwrite an existing visibility selection';
  end if;
  if exists(select 1 from public.venue_dancer_affiliations a join internal_demo_plan d on d.dancer_id=a.dancer_id
    where a.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and (a.status<>'active' or a.revoked_at is not null or a.reentry_blocked)) then
    raise exception 'Refusing to reverse a staff removal';
  end if;
  perform 1 from public.shifts s join internal_demo_plan d on d.shift_id=s.id for update of s;
end;
$$;

insert into public.venue_dancer_affiliations(venue_id,dancer_id)
select '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'::uuid,dancer_id from internal_demo_plan
on conflict(venue_id,dancer_id) do nothing;

update public.shifts s set
  venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af',venue_affiliation_id=a.id,updated_at=now(),
  shift_summary=s.shift_summary || jsonb_build_object('internalDemoRoster',true,
    'internalDemoPreviousVenueId',coalesce(s.shift_summary->'internalDemoPreviousVenueId',to_jsonb(p.previous_venue_id)))
from internal_demo_plan p join public.venue_dancer_affiliations a on a.dancer_id=p.dancer_id
  and a.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
where s.id=p.shift_id;

insert into public.dancer_channel_preferences(dancer_id,visibility)
select dancer_id,'both' from internal_demo_plan
on conflict(dancer_id) do nothing;

insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
select shift_id,dancer_id,'260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'::uuid,'both' from internal_demo_plan
on conflict(shift_id) do update set venue_id=excluded.venue_id,visibility=excluded.visibility,selected_at=now();

do $$
begin
  if (select count(*) from public.internal_roster_members('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'))<>5 then
    raise exception 'Internal roster did not contain exactly five dancers; rolling back';
  end if;
  if (select count(*) from public.venue_roster_members('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af') m
    join internal_demo_plan p on p.dancer_id=m.id where m.internal_visible and m.external_visible and m.working_until>now())<>5 then
    raise exception 'Staff roster did not show all five demo dancers as working; rolling back';
  end if;
end;
$$;
select stage_name,working_until from public.internal_roster_members('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af') order by stage_name;
commit;
