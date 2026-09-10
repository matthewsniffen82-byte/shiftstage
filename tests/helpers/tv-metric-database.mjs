import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const tvMetricSchema=JSON.parse(readFileSync(new URL('../fixtures/tv-metric-schema.json',import.meta.url),'utf8'));
export const tvMetricMigrationPath='supabase/migrations/20260910105400_add_bounded_tv_metric_aggregation.sql';
export const tvMetricMigration=readFileSync(new URL('../../'+tvMetricMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const tvMetricSignature='public.get_mydancr_tv_metric_counts(uuid[],timestamptz)';
export const tvMetricId=n=>'97000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const metricTypes=['impression','engaged_view','completed','profile_click','venue_click','shift_click','follow','going','reminder','applause','share','report'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createTvMetricDatabase({migrate=true}={}){
 const db=new PGlite();
 try{
  await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create table public.app_users(id uuid primary key);create table public.mydancr_tv_videos(id uuid primary key)');
  // Video/account identity references are synthetic; the event schema is complete.
  const columns=tvMetricSchema.columns.map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
  await db.exec('create table public.mydancr_tv_events('+columns.join(',')+');alter table public.mydancr_tv_events enable row level security');
  for(const foreign of [false,true])for(const r of tvMetricSchema.constraints.filter(r=>r.definition.startsWith('FOREIGN KEY')===foreign))await db.exec('alter table public.mydancr_tv_events add constraint '+quote(r.name)+' '+r.definition);
  const names=new Set(tvMetricSchema.constraints.map(r=>r.name));for(const r of tvMetricSchema.indexes)if(!names.has(r.name))await db.exec(r.definition);
  for(const r of tvMetricSchema.triggers){await db.exec(r.function_definition);await db.exec(r.definition);}
  await db.exec('grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant select on public.mydancr_tv_events to anon,authenticated');
  if(migrate)await db.exec(tvMetricMigration);return db;
 }catch(error){await db.close();throw error;}
}
export async function seedTvMetricDatabase(db){
 await db.exec("reset role;set timezone='UTC';truncate public.mydancr_tv_events,public.mydancr_tv_videos,public.app_users");
 await db.query('insert into public.mydancr_tv_videos select unnest($1::uuid[])',[Array.from({length:101},(_,i)=>tvMetricId(i+1))]);await db.exec('set role service_role');
}
export const recentMetricCutoff=()=>new Date(Date.now()-30*86400000).toISOString();
export async function tvMetricCounts(db,ids=[tvMetricId(1)],since=recentMetricCutoff()){
 return (await db.query('select public.get_mydancr_tv_metric_counts($1,$2) counts',[ids,since])).rows[0].counts;
}
export async function addMetricEvents(db,{video=tvMetricId(1),type='impression',count=1,at=new Date(Date.now()-86400000).toISOString(),prefix='synthetic'}={}){
 await db.query("insert into public.mydancr_tv_events(video_id,event_type,session_id,occurred_at,occurred_on) select $1,$2,$3||'-'||n,$4::timestamptz,($4::timestamptz at time zone 'UTC')::date from generate_series(1,$5::integer) n",[video,type,prefix,at,count]);
}
export async function tvMetricSnapshot(db){return (await db.query("select count(*)::int n,md5(coalesce(string_agg(to_jsonb(e)::text,E'\\n' order by id),'')) fingerprint from public.mydancr_tv_events e")).rows[0];}
