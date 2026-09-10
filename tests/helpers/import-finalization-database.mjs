import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const importSchema=JSON.parse(readFileSync(new URL('../fixtures/import-finalization-schema.json',import.meta.url),'utf8'));
export const importMigrationPath='supabase/migrations/20260910075000_add_atomic_import_finalization.sql';
export const importMigration=readFileSync(new URL('../../'+importMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const importSignature='public.finalize_platform_import_safely(uuid,uuid,text,jsonb)';
export const importTables=['admin_actions','mydancr_tv_videos'];
export const importVersionFields=['dancer_id','submitted_by','storage_path','status','review_notes','reviewed_by','submitted_at','reviewed_at','published_at','updated_at','moderation_started_at','moderation_completed_at'];
export const fixtureId=n=>'96000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createImportDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
  // Related entities are synthetic projections. Both target tables retain every inspected column, constraint, index and trigger.
  await pg.exec('create table public.app_users(id uuid primary key,role text,account_state text);create table public.dancer_profiles(id uuid primary key);create table public.venues(id uuid primary key);create table public.shifts(id uuid primary key,dancer_id uuid,venue_id uuid,location_status text);create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz)');
  for(const table of importTables){
   const columns=importSchema.columns.filter(r=>r.table===table).map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
   await pg.exec('create table public.'+quote(table)+'('+columns.join(',')+')');
   for(const r of importSchema.constraints.filter(r=>r.table===table))await pg.exec('alter table public.'+quote(table)+' add constraint '+quote(r.name)+' '+r.definition);
   await pg.exec('alter table public.'+quote(table)+' enable row level security');
  }
  const names=new Set(importSchema.constraints.map(r=>r.name));
  for(const r of importSchema.indexes)if(!names.has(r.name))await pg.exec(r.definition);
  for(const r of importSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  await pg.exec('grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role');
  if(migrate)await pg.exec(importMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedImportDatabase(pg){
 await pg.exec("reset role;set timezone='UTC';drop trigger if exists synthetic_failure on public.mydancr_tv_videos;drop trigger if exists synthetic_failure on public.admin_actions;truncate public.mydancr_tv_videos,public.admin_actions,public.app_users,public.dancer_profiles,public.venues,public.shifts,public.notifications");
 for(const [n,role,state]of [[1,'dancer','active'],[2,'admin','active'],[3,'admin','disabled'],[4,'customer','active'],[5,'venue','active'],[6,'admin','active']])await pg.query('insert into public.app_users values($1,$2,$3)',[fixtureId(n),role,state]);
 await pg.query('insert into public.dancer_profiles values($1)',[fixtureId(10)]);
 for(const n of [20,21])await pg.query("insert into public.mydancr_tv_videos(id,dancer_id,submitted_by,caption,storage_path,storage_mime,file_size_bytes,duration_seconds,width,height,status,review_notes,reviewed_by,reviewed_at,published_at,moderation_completed_at,like_count,is_pinned) values($1,$2,$3,'Synthetic caption',$4,'video/mp4',12000,12,720,1280,'approved','Keep exact moderation text  ', $5,'2026-01-01T12:34:56.123456Z','2026-01-01T12:34:56.123456Z','2026-01-01T12:34:56.123456Z',7,true)",[fixtureId(n),fixtureId(10),fixtureId(1),'synthetic/video-'+n,fixtureId(2)]);
 await pg.query("insert into public.admin_actions(id,admin_id,target_type,target_id,action,notes) values($1,$2,'mydancr_tv_video',$3,'approved','Preserve old audit')",[fixtureId(30),fixtureId(2),fixtureId(20)]);
 await pg.exec('set role service_role');
}
export async function importVersion(pg,video=fixtureId(20)){
 return (await pg.query('select jsonb_object_agg(key,value) version from public.mydancr_tv_videos v cross join lateral jsonb_each(to_jsonb(v)) where v.id=$1 and key=any($2::text[])',[video,importVersionFields])).rows[0].version;
}
export async function finalizeImport(pg,{admin=fixtureId(2),video=fixtureId(20),batch='synthetic-batch',expected}={}){
 const version=expected===undefined?await importVersion(pg,video):expected;
 return (await pg.query('select public.finalize_platform_import_safely($1,$2,$3,$4::jsonb) result',[admin,video,batch,JSON.stringify(version)])).rows[0].result;
}
export async function importSnapshot(pg){
 const snapshot={};for(const table of [...importTables,'app_users','dancer_profiles','venues','shifts','notifications'])snapshot[table]=(await pg.query('select to_jsonb(t) value from public.'+table+' t order by id')).rows.map(r=>r.value);return snapshot;
}
