-- Assign 49 existing login-disabled Echo fixtures plus the existing Star test
-- shift. Preserve media, verification, preferences, previous affiliations, and
-- all other clubs. This transaction is intentionally not a general roster tool.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create temporary table rhino_demo_club on commit drop as
select v.id,v.owner_user_id from public.venues v join auth.users u on u.id=v.owner_user_id
where v.slug='spearmint-rhino-las-vegas-demo'
  and u.email='spearmint-rhino-las-vegas-demo@synthetic.mydancr.invalid'
  and u.raw_app_meta_data->>'dataset_marker'='mydancr-spearmint-rhino-las-vegas-demo-v1'
  and u.banned_until>now();
do $$ begin
  if (select count(*) from rhino_demo_club)<>1 then raise exception 'Expected the prepared demo club'; end if;
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false) then raise exception 'Requires existing demonstration mode'; end if;
  if exists(select 1 from public.shifts where venue_id=(select id from rhino_demo_club)) then raise exception 'Club already has shifts; inspect instead of reassigning'; end if;
end $$;

create temporary table rhino_demo_roster on commit drop as
select s.id shift_id,d.id dancer_id,s.venue_id previous_venue_id,s.venue_affiliation_id previous_affiliation_id
from public.shifts s join public.dancer_profiles d on d.id=s.dancer_id
join auth.users u on u.id=d.user_id
join public.app_users a on a.id=d.user_id
join public.dancer_channel_preferences p on p.dancer_id=d.id and p.visibility='both'
where s.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
  and d.slug ~ '^echo-grid-(0[0-9][1-9]|0[1-9]0|100)$'
  and u.email=d.slug || '@synthetic.mydancr.invalid' and u.banned_until>now()
  and u.raw_user_meta_data->>'dataset_marker'='mydancr-echo-grid-v1'
  and a.role='dancer' and a.account_state='active'
  and d.status='approved' and d.verification_status='approved' and d.is_public and d.disabled_at is null
  and d.avatar_storage_path is not null and s.shift_source='demo_locked'
  and s.shift_summary @> '{"managedBy":"mydancr-echo-grid-v1","demoLocked":true,"internalDemoRoster":true}'::jsonb
  and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
order by d.slug limit 49;

insert into rhino_demo_roster
select s.id,d.id,s.venue_id,s.venue_affiliation_id from public.shifts s join public.dancer_profiles d on d.id=s.dancer_id
where d.id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and d.slug='lvdegen11'
  and s.id='5dc264bc-c618-4ace-a689-c2791cb3e880'
  and s.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and s.shift_source='nfc_presence'
  and s.shift_summary @> '{"managedBy":"codex-star-echo-assignment","demoLocked":true,"internalDemoRoster":true,"internalDemoProfile":"star-test-v1"}'::jsonb
  and d.status='approved' and d.verification_status='approved' and d.is_public and d.disabled_at is null
  and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>now();
do $$ begin
  if (select count(distinct dancer_id) from rhino_demo_roster)<>50 or (select count(*) from rhino_demo_roster)<>50 then raise exception 'Expected 49 Echo demos plus Star'; end if;
  if exists(select 1 from public.venue_dancer_affiliations a join rhino_demo_roster r on r.dancer_id=a.dancer_id
    where a.venue_id in (r.previous_venue_id,(select id from rhino_demo_club)) and (a.reentry_blocked or a.revoked_at is not null or a.status<>'active')) then raise exception 'Refusing to reverse a staff removal'; end if;
  if exists(select 1 from rhino_demo_roster r left join public.dancer_channel_preferences p on p.dancer_id=r.dancer_id and p.visibility='both' where p.dancer_id is null) then raise exception 'Preserve Both roster preference'; end if;
end $$;

insert into public.venue_dancer_affiliations(venue_id,dancer_id)
select c.id,r.dancer_id from rhino_demo_club c cross join rhino_demo_roster r on conflict(venue_id,dancer_id) do nothing;
update public.shifts s set venue_id=c.id,venue_affiliation_id=a.id,
  shift_summary=s.shift_summary || jsonb_build_object('demoAssignment','mydancr-spearmint-rhino-las-vegas-demo-v1',
    'previousDemoVenueId',r.previous_venue_id,'previousDemoAffiliationId',r.previous_affiliation_id,'demoAssignedAt',now())
from rhino_demo_roster r cross join rhino_demo_club c join public.venue_dancer_affiliations a on a.venue_id=c.id
where s.id=r.shift_id and a.dancer_id=r.dancer_id;
update public.dancer_shift_channels c set venue_id=v.id
from rhino_demo_roster r cross join rhino_demo_club v where c.shift_id=r.shift_id and c.dancer_id=r.dancer_id;
update public.venues set is_active=true,page_review_status='published',published_at=now()
where id=(select id from rhino_demo_club) and not is_active;
do $$ declare club uuid := (select id from rhino_demo_club); begin
  if (select count(*) from public.internal_roster_members(club))<>50 then raise exception 'Internal roster must show 50'; end if;
  if (select count(*) from public.venue_roster_members(club) where internal_visible and external_visible and working_until>now())<>50 then raise exception 'Both rosters must show 50'; end if;
  if not exists(select 1 from public.internal_roster_members(club) where id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2') then raise exception 'Star is missing'; end if;
  if not exists(select 1 from public.venues v where v.id=club and public.has_active_club_deal(v)) then raise exception 'Demo is not discoverable'; end if;
end $$;
insert into public.internal_roster_links(venue_id,kind,label)
select id,'table','Demo table' from rhino_demo_club c
where not exists(select 1 from public.internal_roster_links l where l.venue_id=c.id and l.kind='table' and l.label='Demo table');
commit;
