-- Publish only the 20 samples prepared by prepare-club-card-demo.mjs. Existing
-- sample eligibility keeps age verification enabled and sends no club emails.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('mydancr-club-card-demo-20261103'));
create temporary table club_card_demo on commit drop as
select d.id dancer_id,d.user_id,d.slug,d.stage_name,
  d.user_id::text||'/'||d.id::text||'/mydancr-club-card-demo-20261103/main.jpg' storage_path
from public.dancer_profiles d join auth.users u on u.id=d.user_id
where u.raw_app_meta_data->>'demo_operation'='mydancr-club-card-demo-20261103'
  and u.raw_app_meta_data->>'demo_venue_id'='103e9b1b-77b5-43d2-9eb8-88aa11ed906d'
  and d.slug ~ '^echo-grid-(00[1-9]|01[0-9]|020)$'
  and private.is_restored_rhino_sample(d.user_id);
do $$ begin
  if (select count(*) from club_card_demo)<>20 then raise exception 'Expected 20 prepared samples'; end if;
  if exists(select 1 from public.dancer_profiles d where not exists(select 1 from club_card_demo p where p.dancer_id=d.id)) then
    raise exception 'Dancer baseline changed'; end if;
  if exists(select 1 from club_card_demo p where not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p.storage_path)
    or not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p.storage_path||'.avatar.jpg')) then
    raise exception 'Prepared photo or avatar missing'; end if;
  if exists(select 1 from public.dancer_photos p join club_card_demo d on d.dancer_id=p.dancer_id where p.storage_path<>d.storage_path)
    or exists(select 1 from public.shifts s join club_card_demo d on d.dancer_id=s.dancer_id
      where s.shift_summary->>'demoOperation' is distinct from 'mydancr-club-card-demo-20261103') then
    raise exception 'Unexpected media or shift on a sample'; end if;
end $$;

insert into public.dancer_photos(dancer_id,storage_path,is_primary,sort_order,review_status,alt_text)
select dancer_id,storage_path,true,0,'approved',stage_name||' — synthetic sample'
from club_card_demo d where not exists(select 1 from public.dancer_photos p where p.dancer_id=d.dancer_id and p.storage_path=d.storage_path);
insert into public.dancer_internal_main_photos(dancer_id,photo_id)
select d.dancer_id,p.id from club_card_demo d join public.dancer_photos p on p.dancer_id=d.dancer_id and p.storage_path=d.storage_path
on conflict(dancer_id) do nothing;
insert into public.club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision,notes)
select '103e9b1b-77b5-43d2-9eb8-88aa11ed906d',m.dancer_id,m.source,m.id,m.content_version,'approved','Requested synthetic club-card demo'
from public.dancer_club_media(array(select dancer_id from club_card_demo)) m
on conflict(venue_id,source,media_id) do nothing;
-- Samples join through the existing operator approval path, with no fabricated NFC tap.
insert into public.club_dancer_approvals(venue_id,dancer_id,status,reviewed_at,grandfathered)
select '103e9b1b-77b5-43d2-9eb8-88aa11ed906d',dancer_id,'approved',now(),true from club_card_demo
on conflict(venue_id,dancer_id) do nothing;
-- Record this operator-approved sample cohort before publication. These are
-- grandfathered demo fixtures, not new applications or real verification results.
-- Record email handling too, so no approval email is queued for synthetic users.
update public.dancer_profiles d set venue_approved_at=coalesce(venue_approved_at,now()),
  venue_approved_venue_id='103e9b1b-77b5-43d2-9eb8-88aa11ed906d',approval_email_recorded_at=coalesce(approval_email_recorded_at,now())
from club_card_demo p where d.id=p.dancer_id;
update public.dancer_profiles d set status='approved',verification_status='approved',photo_review_status='approved',
  is_public=true,approved_at=coalesce(approved_at,now())
from club_card_demo p where d.id=p.dancer_id;
insert into public.venue_dancer_affiliations(venue_id,dancer_id)
select '103e9b1b-77b5-43d2-9eb8-88aa11ed906d',dancer_id from club_card_demo on conflict(venue_id,dancer_id) do nothing;
insert into public.dancer_channel_preferences(dancer_id,visibility)
select dancer_id,'both' from club_card_demo on conflict(dancer_id) do nothing;
insert into public.shifts(dancer_id,venue_id,venue_affiliation_id,starts_at,ends_at,timezone,status,shift_date,shift_source,
  checked_in_at,location_status,last_location_verified_at,location_verification_expires_at,working_status,shift_summary)
select p.dancer_id,a.venue_id,a.id,now(),'2099-12-31 23:59:59+00','America/Los_Angeles','posted',
  (now() at time zone 'America/Los_Angeles')::date,'demo_locked',now(),'club_confirmed',now(),'2099-12-31 23:59:59+00','club_confirmed',
  jsonb_build_object('managedBy','mydancr-rhino-restored-20261028','demoLocked',true,'internalDemoRoster',true,'demoOperation','mydancr-club-card-demo-20261103')
from club_card_demo p join public.venue_dancer_affiliations a on a.dancer_id=p.dancer_id and a.venue_id='103e9b1b-77b5-43d2-9eb8-88aa11ed906d'
where not exists(select 1 from public.shifts s where s.dancer_id=p.dancer_id);
insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
select s.id,s.dancer_id,s.venue_id,'both' from public.shifts s join club_card_demo p on p.dancer_id=s.dancer_id on conflict(shift_id) do nothing;

do $$ begin
  if (select count(*) from private.club_media_eligibility('103e9b1b-77b5-43d2-9eb8-88aa11ed906d',array(select dancer_id from club_card_demo)) where eligible)<>20 then
    raise exception 'Every sample must have eligible club media'; end if;
  if (select count(*) from jsonb_array_elements(public.get_public_directory_candidates('Las Vegas',null)) c
    where c->>'venueId'='103e9b1b-77b5-43d2-9eb8-88aa11ed906d' and (c->>'availableUntil')::timestamptz>now())<>20 then
    raise exception 'Public discovery must show exactly 20 working now'; end if;
  if exists(select 1 from public.dancer_age_verifications a join club_card_demo p on p.user_id=a.user_id) then
    raise exception 'Samples must not have identity verification records'; end if;
end $$;
commit;
