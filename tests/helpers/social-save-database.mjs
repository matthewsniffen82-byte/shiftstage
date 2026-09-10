import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
export const socialSchema=JSON.parse(readFileSync(new URL("../fixtures/social-save-schema.json",import.meta.url),"utf8").replace(/^\uFEFF/,""));
export const socialMigrationPath="supabase/migrations/20260910054000_add_atomic_social_link_saves.sql";
export const socialMigration=readFileSync(new URL("../../"+socialMigrationPath,import.meta.url),"utf8").replace(/\r\n/g,"\n");
export const socialSignature="public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[])";
export const socialTables=["social_links","approval_reviews"];
export const fixtureId=n=>"93000000-0000-4000-8000-"+String(n).padStart(12,"0");
export const link=(platform="instagram",handle="synthetic")=>({platform,handle,url:({
 instagram:"https://instagram.com/",tiktok:"https://tiktok.com/@",snapchat:"https://snapchat.com/add/",
 x:"https://x.com/",onlyfans:"https://onlyfans.com/"
})[platform]+handle,is_active:true});
const quote=value=>'"'+value.replaceAll('"','""')+'"';
export async function createSocialDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;");
  for(const [name,labels] of Object.entries(socialSchema.enums))await pg.exec("create type public."+quote(name)+" as enum("+labels.map(s=>"'"+s+"'").join(",")+")");
  // Account/profile/photo references are synthetic projections; target columns and constraints are captured exactly.
  await pg.exec(`create table public.app_users(id uuid primary key,role text,account_state text,dmca_suspended_at timestamptz);
   create table public.dancer_profiles(id uuid primary key,user_id uuid not null references public.app_users(id),stage_name text);
   create table public.dancer_photos(id uuid primary key,dancer_id uuid references public.dancer_profiles(id),review_status public.review_status);`);
  for(const table of socialTables){
   const columns=socialSchema.columns.filter(r=>r.table===table).map(r=>quote(r.name)+" "+quote(r.schema)+"."+quote(r.type)+(r.nullable==="NO"?" not null":"")+(r.default?" default "+r.default:""));
   await pg.exec("create table public."+quote(table)+"("+columns.join(",")+")");
   for(const r of socialSchema.constraints.filter(r=>r.table===table))await pg.exec("alter table public."+quote(table)+" add constraint "+quote(r.name)+" "+r.definition);
   await pg.exec("alter table public."+quote(table)+" enable row level security");
  }
  await pg.exec(socialSchema.indexes.find(r=>r.name==="approval_reviews_one_pending_content_idx").definition);
  await pg.exec(socialSchema.queue.definition);
  await pg.exec("revoke all on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) from public,anon,authenticated;grant execute on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) to service_role;grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role");
  if(migrate)await pg.exec(socialMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedSocialDatabase(pg){
 await pg.exec("reset role;set timezone='UTC'");
 for(const t of socialTables)await pg.exec("drop trigger if exists synthetic_failure on public."+t);
 await pg.exec("truncate public.approval_reviews,public.social_links,public.dancer_photos,public.dancer_profiles,public.app_users");
 for(const n of [1,2])await pg.query("insert into public.app_users values($1,'dancer','active',null)",[fixtureId(n)]);
 for(const n of [1,2])await pg.query("insert into public.dancer_profiles values($1,$2,'Preserve stage name')",[fixtureId(n+10),fixtureId(n)]);
 await pg.exec("set role service_role");
}
export async function saveSocials(pg,{dancer=fixtureId(11),actor=fixtureId(1),links=[link()],platforms=[]}={}){
 return (await pg.query("select public.save_dancer_social_links_safely($1,$2,$3::jsonb,$4::text[]) as result",[dancer,actor,JSON.stringify(links),platforms])).rows[0].result;
}
export async function socialSnapshot(pg){
 const out={};for(const t of [...socialTables,"app_users","dancer_profiles","dancer_photos"])out[t]=(await pg.query("select * from public."+t+" order by id")).rows;return out;
}
