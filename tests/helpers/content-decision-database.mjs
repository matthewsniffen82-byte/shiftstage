import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {socialSchema,socialMigration} from "./social-save-database.mjs";
export const decisionSchema=JSON.parse(readFileSync(new URL("../fixtures/content-decision-schema.json",import.meta.url),"utf8").replace(/^\uFEFF/,""));
export const decisionMigrationPath="supabase/migrations/20260910061000_add_atomic_content_review_decisions.sql";
export const decisionMigration=readFileSync(new URL("../../"+decisionMigrationPath,import.meta.url),"utf8").replace(/\r\n/g,"\n");
export const decisionSignature="public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb)";
export const decisionTables=["dancer_profiles","dancer_photos","social_links","approval_reviews","admin_actions"];
export const fixtureId=n=>"94000000-0000-4000-8000-"+String(n).padStart(12,"0");
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createDecisionDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;");
  for(const [name,labels]of Object.entries(decisionSchema.enums))await pg.exec("create type public."+quote(name)+" as enum("+labels.map(s=>"'"+s+"'").join(",")+")");
  // Target tables use all captured columns/constraints. Related account, venue and alias tables are synthetic projections.
  await pg.exec("create table public.app_users(id uuid primary key,role text,account_state text,dmca_suspended_at timestamptz);create table public.venues(id uuid primary key,name text);create table public.dancer_profile_slug_aliases(slug text primary key,dancer_id uuid)");
  for(const table of decisionTables){
   const columns=decisionSchema.columns.filter(r=>r.table===table).map(r=>quote(r.name)+" "+quote(r.schema)+"."+quote(r.type)+(r.nullable==="NO"?" not null":"")+(r.default?" default "+r.default:""));
   await pg.exec("create table public."+quote(table)+"("+columns.join(",")+")");
   for(const r of decisionSchema.constraints.filter(r=>r.table===table))await pg.exec("alter table public."+quote(table)+" add constraint "+quote(r.name)+" "+r.definition);
   await pg.exec("alter table public."+quote(table)+" enable row level security");
  }
  const constraintNames=new Set(decisionSchema.constraints.map(r=>r.name));
  for(const r of decisionSchema.indexes)if(!constraintNames.has(r.name))await pg.exec(r.definition);
  for(const r of decisionSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  await pg.exec(socialSchema.queue.definition);
  await pg.exec("revoke all on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) from public,anon,authenticated;grant execute on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) to service_role");
  await pg.exec(socialMigration);
  await pg.exec("grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role");
  if(migrate)await pg.exec(decisionMigration);
  return pg;
 }catch(e){await pg.close();throw e;}
}
export async function seedDecisionDatabase(pg){
 await pg.exec("reset role;set timezone='UTC'");
 for(const t of decisionTables)await pg.exec("drop trigger if exists synthetic_failure on public."+t);
 await pg.exec("truncate public.admin_actions,public.approval_reviews,public.social_links,public.dancer_photos,public.dancer_profiles,public.app_users,public.venues,public.dancer_profile_slug_aliases");
 for(const [n,role]of [[1,"dancer"],[2,"dancer"],[3,"admin"],[4,"admin"],[5,"customer"]])await pg.query("insert into public.app_users values($1,$2,'active',null)",[fixtureId(n),role]);
 await pg.query("insert into public.venues values($1,'Synthetic venue')",[fixtureId(20)]);
 for(const n of [1,2])await pg.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,status,verification_status,photo_review_status,is_public,venue_approved_at,venue_approved_by_user_id,venue_approved_venue_id,avatar_storage_path) values($1,$2,'Synthetic legal name','Synthetic Dancer',$3,'approved','approved','pending',true,'2026-01-01Z',$4,$5,'keep-avatar')",[fixtureId(n+10),fixtureId(n),"synthetic-"+n,fixtureId(3),fixtureId(20)]);
 for(const [n,status,sort]of [[100,"approved",1],[101,"pending",2]])await pg.query("insert into public.dancer_photos(id,dancer_id,storage_path,review_status,sort_order,is_pinned,like_count) values($1,$2,$3,$4,$5,true,7)",[fixtureId(n),fixtureId(11),"synthetic/photo-"+n,status,sort]);
 await pg.query("insert into public.social_links(id,dancer_id,platform,handle,url,updated_at) values($1,$2,'instagram','synthetic','https://instagram.com/synthetic','2026-01-01T12:34:56.123456Z')",[fixtureId(200),fixtureId(11)]);
 for(const [n,type,target,status]of [[300,"photo",101,"pending"],[301,"photo",100,"approved"],[302,"social_link",200,"pending"],[303,"social_link",200,"approved"]])await pg.query("insert into public.approval_reviews(id,dancer_id,review_type,status,notes,created_at,reviewed_at,reviewer_id) values($1,$2,$3,$4,'Keep prior notes','2026-01-01Z',$5,$6)",[fixtureId(n),fixtureId(11),type+":"+fixtureId(target),status,status==="pending"?null:"2026-01-02Z",status==="pending"?null:fixtureId(4)]);
 await pg.query("insert into public.admin_actions(id,admin_id,target_type,target_id,action,notes) values($1,$2,'photo',$3,'prior_action','Preserve old audit')",[fixtureId(400),fixtureId(4),fixtureId(11)]);
 await pg.exec("set role service_role");
}
export async function decisionVersion(pg,type="photo",target=fixtureId(101),dancer=fixtureId(11)){
 const targetSql=type==="photo"?"jsonb_build_object('storage_path',storage_path,'is_primary',is_primary,'sort_order',sort_order,'review_status',review_status)":"jsonb_build_object('platform',platform,'handle',handle,'url',url,'is_active',is_active,'updated_at',updated_at)";
 const result=(await pg.query("select "+targetSql+" as target from public."+(type==="photo"?"dancer_photos":"social_links")+" where id=$1 and dancer_id=$2",[target,dancer])).rows[0];
 const review=(await pg.query("select jsonb_build_object('id',id,'status',status,'reviewed_at',reviewed_at) as review from public.approval_reviews where dancer_id=$1 and review_type=$2 order by (status='pending') desc,coalesce(reviewed_at,created_at) desc,id desc limit 1",[dancer,type+":"+target])).rows[0];
 return {target:result?.target,review:review?.review||null};
}
export async function decideContent(pg,{reviewer=fixtureId(3),dancer=fixtureId(11),type="photo",target=fixtureId(101),status="approved",notes=null,label="Synthetic item",expected}={}){
 const version=expected===undefined?await decisionVersion(pg,type,target,dancer):expected;
 return (await pg.query("select public.review_dancer_content_safely($1,$2,$3,$4,$5,$6,$7,$8::jsonb) as result",[reviewer,dancer,type,target,status,notes,label,JSON.stringify(version)])).rows[0].result;
}
export async function decisionSnapshot(pg){
 const out={};for(const t of [...decisionTables,"app_users","venues","dancer_profile_slug_aliases"])out[t]=(await pg.query("select * from public."+t+" order by "+(t==="dancer_profile_slug_aliases"?"slug":"id"))).rows;return out;
}
