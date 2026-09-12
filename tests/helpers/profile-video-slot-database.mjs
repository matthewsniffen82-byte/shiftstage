import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const slotSchema=JSON.parse(readFileSync(new URL('../fixtures/profile-video-slot-schema.json',import.meta.url),'utf8'));
export const slotMigrationPath='supabase/migrations/20260912052200_enforce_profile_video_slot_limit.sql';
export const slotMigration=readFileSync(new URL('../../supabase/migrations/20260912052200_enforce_profile_video_slot_limit.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const slotId=n=>'a1400000-0000-4000-8000-'+String(n).padStart(12,'0');
export const occupiedStatuses=['uploading','moderating','submitted','approved','rejected'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';

export async function createSlotDatabase({migrate=true}={}){
 const db=new PGlite();
 try{
  // Only the video table is a full current-schema fixture. These are the
  // identity/link and notification/audit projections its actual triggers use.
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.app_users(id uuid primary key);
   create table public.dancer_profiles(id uuid primary key);
   create table public.venues(id uuid primary key);
   create table public.shifts(id uuid primary key,dancer_id uuid,venue_id uuid,location_status text);
   create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);
   create table public.admin_actions(id uuid primary key default gen_random_uuid(),admin_id uuid,target_type text,target_id uuid,action text,notes text);`);
  await db.exec('create table public.mydancr_tv_videos('+slotSchema.columns.map(c=>quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+');');
  for(const foreign of [false,true])for(const c of slotSchema.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign))await db.exec('alter table public.mydancr_tv_videos add constraint '+quote(c.name)+' '+c.definition);
  const constraintNames=new Set(slotSchema.constraints.map(c=>c.name));
  for(const i of slotSchema.indexes)if(!constraintNames.has(i.indexname))await db.exec(i.indexdef);
  for(const f of slotSchema.functions){await db.exec(f.definition+';');await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');}
  for(const t of slotSchema.triggers)await db.exec(t.definition);
  await db.exec('alter table public.mydancr_tv_videos enable row level security;grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant select on public.mydancr_tv_videos to anon,authenticated');
  // Browser read policy evaluation is tested by the separate full RLS matrix.
  // This fixture preserves actual table write grants, RLS and function access.
  if(migrate)await db.exec(slotMigration);
  return db;
 }catch(error){await db.close();throw error;}
}

export async function seedSlots(db){
 await db.exec('reset role;truncate public.mydancr_tv_videos,public.shifts,public.dancer_profiles,public.venues,public.app_users,public.notifications,public.admin_actions');
 await db.query('insert into public.app_users values($1),($2)',[slotId(1),slotId(2)]);
 await db.query('insert into public.dancer_profiles values($1),($2)',[slotId(1),slotId(2)]);
 await db.query('insert into public.venues values($1)',[slotId(3)]);
 await db.query("insert into public.shifts values($1,$2,$3,'club_confirmed')",[slotId(4),slotId(1),slotId(3)]);
 await db.exec('set role service_role');
}

export async function addSlots(db,{count=1,start=100,dancer=slotId(1),status='approved',scope='profile_and_feed',shift=null}={}){
 return (await db.query(`insert into public.mydancr_tv_videos(id,dancer_id,submitted_by,caption,storage_path,storage_mime,file_size_bytes,duration_seconds,width,height,status,distribution_scope,shift_id)
 select ('a1400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$1,'Synthetic video','synthetic/'||n||'.mp4','video/mp4',1024,10,720,1280,$2,$3,$4 from generate_series($5::integer,$6::integer)n returning id`,[dancer,status,scope,shift,start,start+count-1])).rows;
}
export async function slotCount(db,dancer=slotId(1)){
 return (await db.query("select count(*)::integer n from public.mydancr_tv_videos where dancer_id=$1 and distribution_scope='profile_and_feed' and status=any($2)",[dancer,occupiedStatuses])).rows[0].n;
}
export async function slotSnapshot(db){
 return (await db.query("select count(*)::integer n,md5(coalesce(string_agg(to_jsonb(v)::text,'' order by id),'')) fingerprint from public.mydancr_tv_videos v")).rows[0];
}
