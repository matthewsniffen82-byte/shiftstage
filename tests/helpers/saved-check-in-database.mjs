import {readFileSync} from 'node:fs';
import {createInternalRosterDatabase} from './internal-roster-database.mjs';
import {fixtureId as id} from './dancer-tap-database.mjs';
const source=file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');
export async function createSavedCheckInDatabase(){
  const pg=await createInternalRosterDatabase();
  await pg.exec(`reset role;alter table public.venue_dancer_affiliations add column reentry_blocked boolean not null default false;
    create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,true);`);
  for(const fn of JSON.parse(source('tests/fixtures/club-join-tap-functions.json')).functions) await pg.exec(fn.source);
  for(const dancer of [10,11])for(const n of [1,2])await pg.query("insert into public.dancer_photos(id,dancer_id,storage_path,review_status,sort_order) values($1,$2,$3,'approved',$4)",[id(dancer*100+n),id(dancer),`synthetic/extra-${dancer}-${n}`,n+1]);
  await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)',[id(30),id(5),id(49),'internal',{}]);
  await pg.exec(source('supabase/migrations/20261023091937_club_dancer_join_approval.sql'));
  await pg.exec(source('supabase/migrations/20261023093339_club_approval_returning_dancer_taps.sql'));
  await pg.exec(`create table public.club_media_permissions(venue_id uuid,dancer_id uuid,source text,media_id uuid,content_version text,decision text,
      primary key(venue_id,source,media_id));
    create function public.dancer_club_media(ids uuid[]) returns table(id uuid,dancer_id uuid,source text,kind text,content_version text,photo_id uuid,record jsonb)
      language sql as $$select p.id,p.dancer_id,'photo','photo',md5(p.storage_path),p.id,jsonb_build_object('upload_context','profile_gallery','status','approved')
        from public.dancer_photos p where p.dancer_id=any(ids) and p.review_status='approved'$$;
    create function public.club_public_media(venue uuid,ids uuid[]) returns jsonb language sql as $$
      select coalesce(jsonb_agg(jsonb_build_object('photoId',m.id)),'[]') from public.dancer_club_media(ids) m
        join public.club_media_permissions a on a.media_id=m.id and a.content_version=m.content_version
        and a.venue_id=venue and a.decision='approved'$$;
    create function public.has_active_club_deal(public.venues) returns boolean language sql as $$select true$$;
    grant all on public.club_media_permissions to service_role;`);
  const latest=source('supabase/migrations/20261023224617_club_profile_review_affiliation.sql');
  await pg.exec(latest.slice(0,latest.indexOf('create or replace function public.guard_dancer_media_decision()'))+'commit;');
  await pg.exec(source('supabase/migrations/20261023225653_club_review_completes_saved_checkin.sql'));
  await pg.exec(`create table public.dancer_agreement_versions(version text primary key,is_current boolean);
    create table public.dancer_agreement_acceptances(user_id uuid,version text,accepted_at timestamptz);
    insert into public.dancer_agreement_versions values('current',true);
    grant select on public.dancer_agreement_versions,public.dancer_agreement_acceptances to service_role;`);
  for(const user of [1,5]) await pg.query("insert into public.dancer_agreement_acceptances values($1,'current',now()-interval '1 day')",[id(user)]);
  await pg.exec(source('supabase/migrations/20261027085344_complete_saved_dancer_checkin.sql'));
  await pg.exec(`create table public.image_moderation_records(id uuid primary key,user_id uuid,decision text,temporary_storage_path text,
    upload_context text,photo_publication_mode text,replacement_photo_id uuid);
    grant all on public.image_moderation_records to service_role;
    update public.dancer_photos set is_primary=true where sort_order=1;`);
  const submission=source('supabase/migrations/20261020224618_venue_dancer_media_review.sql');
  await pg.exec(submission.slice(submission.indexOf('create or replace function public.dancer_submission_media('),submission.indexOf('create or replace function public.enforce_dancer_onboarding_photos()')));
  await pg.exec(source('supabase/migrations/20261027091753_allow_first_tap_while_media_pending.sql'));
  await pg.exec(`create schema if not exists private;
    create table public.mydancr_tv_videos(id uuid primary key,dancer_id uuid,status text,distribution_scope text default 'profile_and_feed',upload_validation_pending boolean default false,moderation_details jsonb default '{"fileChecksPassed":true}');
    grant all on public.mydancr_tv_videos to service_role;`);
  await pg.query("insert into public.mydancr_tv_videos(id,dancer_id,status) values($1,$2,'approved')",[id(300),id(10)]);
  await pg.exec(source('supabase/migrations/20261028034257_require_dancer_onboarding_video.sql'));
  await pg.exec('create trigger dancer_onboarding_photos before insert or update of status,verification_status,venue_approved_at on public.dancer_profiles for each row execute function public.enforce_dancer_onboarding_photos()');
 return pg;
}
