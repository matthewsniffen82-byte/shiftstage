// Explicit operator restoration: 20 working and 10 off-shift archived samples.
// Does not restore passwords, sessions, verification records, or real accounts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { photoStoragePaths, sqlText } from './lib/echo-demo-grid.mjs';

const marker='mydancr-rhino-restored-20261028';
const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');return [arg.slice(2,at),arg.slice(at+1)];}));
if(!['inspect','prepare'].includes(args.get('mode'))||!args.get('backup')||!args.get('out'))throw Error('Provide --mode=inspect|prepare, --backup= and --out=.');
if(args.get('mode')==='prepare'&&args.get('confirm')!==marker)throw Error('Exact sample marker required.');
const root=path.resolve(args.get('backup')),out=path.resolve(args.get('out'));
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report=read('public-backup-report.json');
function rows(name){const item=report.tables.find(row=>row.name===name);if(!item)throw Error('Missing backed-up table '+name);
 const bytes=readFileSync(path.join(root,item.file));if(hash(bytes)!==item.sha256)throw Error('Backup checksum failed: '+name);return JSON.parse(gunzipSync(bytes));}
const profiles=rows('dancer_profiles').filter(p=>/^echo-grid-(00[1-9]|0[12][0-9]|030)$/.test(p.slug)).sort((a,b)=>a.slug.localeCompare(b.slug));
if(profiles.length!==30||profiles.some(p=>p.status!=='approved'||p.verification_status!=='approved'||!p.approved_at||p.disabled_at||p.dmca_suspended_at))throw Error('Expected 30 previously approved sample profiles.');
const ids=profiles.map(p=>p.id),userIds=profiles.map(p=>p.user_id);
const accounts=rows('app_users').filter(a=>userIds.includes(a.id));
if(accounts.length!==30||accounts.some(a=>a.role!=='dancer'||a.account_state!=='active'||a.email!==profiles.find(p=>p.user_id===a.id).slug+'@synthetic.mydancr.invalid'))throw Error('Only archived synthetic accounts may be restored.');
const photos=rows('dancer_photos').filter(p=>ids.includes(p.dancer_id));
if(photos.length!==30||photos.some(p=>p.review_status!=='approved'||!p.is_primary))throw Error('Expected one approved original main photo per sample.');
const objects=read('storage-backup-report.json').objects,selected=new Map();
for(const p of profiles){const photo=photos.find(x=>x.dancer_id===p.id);
 for(const name of new Set([p.avatar_storage_path,...photoStoragePaths(photo.storage_path)])){
  if(!name?.startsWith(`${p.user_id}/${p.id}/`))throw Error('Unexpected photo ownership.');
  const object=objects.find(x=>x.bucket==='dancer-photos'&&x.name===name);if(!object)throw Error('Missing archived photo.');
  selected.set(name,object);
 }}
function bytesFor(object){const target=path.resolve(root,object.file);if(!target.startsWith(path.join(root,'files')+path.sep))throw Error('Invalid archive path.');
 const bytes=readFileSync(target);if(hash(bytes)!==object.sha256||bytes.length!==object.bytes)throw Error('Photo checksum failed.');return bytes;}
for(const object of selected.values())bytesFor(object);
console.log(JSON.stringify({profiles:profiles.length,working:20,notWorking:10,verifiedPhotoFiles:selected.size,names:profiles.map(p=>p.stage_name)}));
if(args.get('mode')==='inspect')process.exit(0);
nextEnv.loadEnvConfig(process.cwd());
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='hfmzwadzabmgxkjzmqun.supabase.co')throw Error('Unexpected project.');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=async promise=>{const {data,error}=await promise;if(error)throw error;return data;};
const venue=await check(admin.from('venues').select('id,slug,name,is_active').eq('slug','spearmint-rhino').single());
if(venue.name!=='Spearmint Rhino'||!venue.is_active)throw Error('Expected the current active Rhino venue.');
mkdirSync(out,{recursive:true});
for(const [index,p] of profiles.entries()){
 const existing=await admin.auth.admin.getUserById(p.user_id);let user=existing.data?.user;
 if(!user&&existing.error?.status!==404)throw existing.error||Error('Unexpected account lookup.');
 if(!user)user=(await check(admin.auth.admin.createUser({id:p.user_id,email:p.slug+'@synthetic.mydancr.invalid',password:randomBytes(40).toString('base64url'),email_confirm:false,ban_duration:'876000h',
  app_metadata:{dataset_marker:marker,demo_venue_id:venue.id,demo_profile_id:p.id},
  user_metadata:{role:'dancer',display_name:p.stage_name,stage_name:p.stage_name,city:'Las Vegas'}}))).user;
 if(user.id!==p.user_id||user.email!==p.slug+'@synthetic.mydancr.invalid'||user.app_metadata?.dataset_marker!==marker||user.app_metadata?.demo_profile_id!==p.id||user.app_metadata?.demo_venue_id!==venue.id||!(Date.parse(user.banned_until)>Date.now())||user.email_confirmed_at)throw Error('Unexpected sample account state.');
 const draft=await check(admin.from('dancer_profiles').select('id,status,is_public').eq('user_id',p.user_id).single());
 if(draft.status!=='draft'||draft.is_public)throw Error('Already published or changed; inspect before rerunning.');
 for(const object of selected.values())if(object.name.startsWith(p.user_id+'/')){
  const present=await admin.storage.from('dancer-photos').info(object.name);
  if(present.error){if(!['404','400'].includes(String(present.error.statusCode)))throw present.error;
   await check(admin.storage.from('dancer-photos').upload(object.name,bytesFor(object),{contentType:object.name.endsWith('.webp')?'image/webp':'image/jpeg',upsert:false,cacheControl:'3600'}));}
  const downloaded=await check(admin.storage.from('dancer-photos').download(object.name));
  if(hash(Buffer.from(await downloaded.arrayBuffer()))!==object.sha256)throw Error('Uploaded photo verification failed.');
 }
 if((index+1)%5===0)console.log(`Prepared ${index+1}/30 archived samples`);
}
const plan=profiles.map((p,i)=>({id:p.id,user_id:p.user_id,slug:p.slug,name:p.stage_name,approved_at:p.approved_at,avatar:p.avatar_storage_path,working:i<20,photo:photos.find(x=>x.dancer_id===p.id)}));
const literal=sqlText(JSON.stringify(plan));
const sql=`-- User-requested restoration of 30 archived synthetic profiles only.
begin;
set local lock_timeout='3s';set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('${marker}'));
create temp table rhino_sample_plan on commit drop as select * from jsonb_to_recordset(${literal}::jsonb)
 as p(id uuid,user_id uuid,slug text,name text,approved_at timestamptz,avatar text,working boolean,photo jsonb);
create temp table rhino_sample_baseline on commit drop as select
 (select md5(coalesce(jsonb_agg(to_jsonb(d) order by d.id)::text,'')) from dancer_profiles d where user_id not in(select user_id from rhino_sample_plan)) profiles,
 (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from shifts s) shifts,
 (select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.user_id)::text,'')) from dancer_age_verifications v) ages;
do $$ begin
 if not exists(select 1 from venues where id='${venue.id}' and slug='spearmint-rhino' and is_active) then raise exception 'Rhino changed';end if;
 if (select count(*) from rhino_sample_plan p join auth.users u on u.id=p.user_id join dancer_profiles d on d.user_id=p.user_id
  where u.raw_app_meta_data->>'dataset_marker'='${marker}' and u.raw_app_meta_data->>'demo_profile_id'=p.id::text
   and u.raw_app_meta_data->>'demo_venue_id'='${venue.id}' and u.email=p.slug||'@synthetic.mydancr.invalid'
   and u.banned_until>now() and u.email_confirmed_at is null and d.status='draft' and not d.is_public)<>30 then raise exception 'Sample identity guard failed';end if;
 if exists(select 1 from dancer_photos f join dancer_profiles d on d.id=f.dancer_id where d.user_id in(select user_id from rhino_sample_plan)) then raise exception 'Draft has media';end if;
end $$;
delete from dancer_profiles where user_id in(select user_id from rhino_sample_plan) and status='draft' and not is_public;
insert into dancer_profiles(id,user_id,real_name,stage_name,slug,city,status,verification_status,photo_review_status,approved_at,is_public)
 select id,user_id,'Fictional demo profile',name,slug,'Las Vegas','draft','approved','approved',approved_at,false from rhino_sample_plan;
insert into dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status,alt_text)
 select (photo->>'id')::uuid,id,photo->>'storage_path',true,0,'approved',name||' · fictional demo profile restored from backup' from rhino_sample_plan;
insert into dancer_internal_main_photos(dancer_id,photo_id) select id,(photo->>'id')::uuid from rhino_sample_plan;
insert into dancer_channel_preferences(dancer_id,visibility) select id,'both' from rhino_sample_plan;
update dancer_profiles d set status='approved',is_public=true,avatar_storage_path=p.avatar,
 venue_approved_at=p.approved_at,venue_approved_venue_id='${venue.id}',updated_at=now() from rhino_sample_plan p where d.id=p.id;
insert into club_dancer_approvals(venue_id,dancer_id,status,grandfathered,reviewed_at)
 select '${venue.id}',id,'approved',true,approved_at from rhino_sample_plan;
insert into venue_dancer_affiliations(venue_id,dancer_id) select '${venue.id}',id from rhino_sample_plan;
insert into club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision,provenance,notes)
 select '${venue.id}',m.dancer_id,m.source,m.id,m.content_version,'approved','existing_display','Previously approved fictional sample restored from backup.'
 from dancer_club_media(array(select id from rhino_sample_plan)) m;
insert into shifts(id,dancer_id,venue_id,venue_affiliation_id,starts_at,ends_at,timezone,status,shift_source,checked_in_at,location_status,last_location_verified_at,location_verification_expires_at,working_status,shift_summary)
 select md5('${marker}'||p.id)::uuid,p.id,'${venue.id}',a.id,now(),'2099-12-31 23:59:59+00','America/Los_Angeles','posted','demo_locked',now(),'club_confirmed',now(),'2099-12-31 23:59:59+00','club_confirmed',
 jsonb_build_object('managedBy','${marker}','demoLocked',true,'internalDemoRoster',true,'restoredFromBackup','20261024-adminlv-reset')
 from rhino_sample_plan p join venue_dancer_affiliations a on a.dancer_id=p.id and a.venue_id='${venue.id}' where p.working;
insert into dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
 select s.id,s.dancer_id,s.venue_id,'both' from shifts s join rhino_sample_plan p on p.id=s.dancer_id where p.working;
-- These are samples, so retain no pending approval emails for their invalid addresses.
delete from dancer_media_email_deliveries where recipient_id in(select user_id from rhino_sample_plan) and status='pending';
do $$ begin
 if (select count(*) from venue_roster_members('${venue.id}') m join rhino_sample_plan p on p.id=m.id)<>30
 or (select count(*) from venue_roster_members('${venue.id}') m join rhino_sample_plan p on p.id=m.id where internal_visible and external_visible and working_until>now())<>20
 or (select count(*) from internal_roster_members('${venue.id}') m join rhino_sample_plan p on p.id=m.id)<>20
 or (select count(distinct x->>'dancerId') from jsonb_array_elements(club_public_media('${venue.id}',array(select id from rhino_sample_plan))) x)<>30
 or exists(select 1 from shifts s join rhino_sample_plan p on p.id=s.dancer_id where not p.working) then raise exception 'Expected 20 working and 10 off-shift samples';end if;
 if (select profiles from rhino_sample_baseline) is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(d) order by d.id)::text,'')) from dancer_profiles d where user_id not in(select user_id from rhino_sample_plan))
 or (select shifts from rhino_sample_baseline) is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from shifts s where dancer_id not in(select id from rhino_sample_plan))
 or (select ages from rhino_sample_baseline) is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.user_id)::text,'')) from dancer_age_verifications v) then raise exception 'Existing data changed';end if;
end $$;
commit;
`;
writeFileSync(path.join(out,'publish.sql'),sql);writeFileSync(path.join(out,'plan.json'),JSON.stringify({marker,venueId:venue.id,plan},null,2));
console.log(JSON.stringify({prepared:30,working:20,notWorking:10,publicWrites:false,output:out}));
