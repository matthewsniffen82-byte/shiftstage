import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountLifecycleDatabase,accountLifecycleSchema,seedAccountLifecycle,accountLifecycleId,asAccountLifecycleRole} from './account-lifecycle-database.mjs';
export {asAccountLifecycleRole as asOwnerPolicyRole};
export const ownerPolicyFixture=JSON.parse(readFileSync(new URL('../fixtures/public-owner-policy-current.json',import.meta.url),'utf8'));
export const ownerPrivacySource=readFileSync(new URL('../../supabase/migrations/20260912150921_hide_public_account_identifiers.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const tvPrivacySource=readFileSync(new URL('../../supabase/migrations/20260912150922_protect_public_tv_moderation_columns.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const quote=s=>'"'+s.replaceAll('"','""')+'"';

export async function createOwnerPolicyDatabase({migrate=true}={}) {
 const db=await createAccountLifecycleDatabase();
 try {
  const fixture=ownerPolicyFixture,full=new Set(accountLifecycleSchema.scope.tables);
  for(const table of fixture.tables){
   if(full.has(table))continue;
   const columns=fixture.columns.filter(c=>c.table_name===table);
   if(!(await db.query('select to_regclass($1)r',['public.'+table])).rows[0].r)await db.exec(`create table public.${quote(table)}()`);
   for(const c of columns)await db.exec(`alter table public.${quote(table)} add column if not exists ${quote(c.column_name)} ${quote(c.udt_schema)}.${quote(c.udt_name)}`);
   const relation=fixture.relations.find(r=>r.name===table);assert.ok(relation);
   if(relation.rls)await db.exec(`alter table public.${quote(table)} enable row level security`);
   if(relation.force_rls)await db.exec(`alter table public.${quote(table)} force row level security`);
   await db.exec(`revoke all on public.${quote(table)} from public,anon,authenticated,service_role`);
   for(const [role,rights]of Object.entries(relation.grants)){
    const allowed=Object.entries(rights).filter(([,yes])=>yes).map(([right])=>right);
    if(allowed.length)await db.exec(`grant ${allowed.join(',')} on public.${quote(table)} to ${quote(role)}`);
   }
   for(const c of fixture.columnAccess.filter(c=>c.table===table))for(const [role,key]of [['anon','anon_select'],['authenticated','authenticated_select']])if(c[key])await db.exec(`grant select(${quote(c.column)})on public.${quote(table)} to ${quote(role)}`);
  }
  for(const p of fixture.policies){
   if(full.has(p.tablename))continue;
   await db.exec(`create policy ${quote(p.policyname)} on public.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''}`);
  }
  for(const filename of ['20260912110619_minimize_public_shift_location_columns.sql','20260912123000_minimize_public_venue_review_columns.sql'])await db.exec(readFileSync(new URL('../../supabase/migrations/'+filename,import.meta.url),'utf8'));
  // The older effective-access capture covered CRUD only. Preserve the complete
  // captured service ACL for all three deployment targets, including MAINTAIN.
  for(const relation of fixture.rawTargetAcls.relations){
   assert.ok(['venues','dancer_profiles','mydancr_tv_videos'].includes(relation.table));
   await db.exec(`grant truncate,references,trigger,maintain on public.${quote(relation.table)} to service_role`);
   assert.equal((await db.query('select relacl::text acl from pg_class where oid=$1::regclass',['public.'+relation.table])).rows[0].acl,relation.acl,'Complete captured ACL for '+relation.table);
  }
  const view=fixture.publicView;
  await db.exec(`create view public.public_dancer_profiles with(${view.options.join(',')})as ${view.definition};grant select on public.public_dancer_profiles to anon,authenticated,service_role`);
  if(migrate){await db.exec(ownerPrivacySource);await db.exec(tvPrivacySource);}
  return db;
 }catch(error){await db.close();throw error;}
}

export async function seedOwnerPolicyRows(db){
 const ids={};
 for(const [name,n,role,state]of [['owner',1,'venue','active'],['otherOwner',2,'venue','active'],['dancer',3,'dancer','active'],['otherDancer',4,'dancer','active'],['customer',5,'customer','active'],['admin',6,'admin','active'],['disabledAdmin',7,'admin','disabled']])ids[name]=await seedAccountLifecycle(db,{n,role,state});
 await db.exec("update public.club_deals set is_active=false");
 const full=new Set(accountLifecycleSchema.scope.tables);
 const linked={};
 for(const [i,table]of ownerPolicyFixture.tables.entries()){
  if(full.has(table))continue;
  const idType=ownerPolicyFixture.columns.find(c=>c.table_name===table&&c.column_name==='id')?.udt_name;
  linked[table]=idType==='uuid'?[accountLifecycleId(1000+i*10),accountLifecycleId(1001+i*10)]:[1000+i*10,1001+i*10];
 }
 for(const [table,pair]of Object.entries(linked))for(let side=0;side<2;side++){
  const columns=ownerPolicyFixture.columns.filter(c=>c.table_name===table),names=new Set(columns.map(c=>c.column_name));
  const owner=side?ids.otherOwner:ids.owner,dancer=side?ids.otherDancer:ids.dancer;
  const possible={id:pair[side],venue_id:owner.venueId,dancer_id:dancer.dancerId,user_id:owner.userId,dancer_user_id:dancer.userId,actor_user_id:dancer.userId,submitted_by:dancer.userId,
   invoice_id:linked.club_invoices?.[side],video_id:linked.mydancr_tv_videos?.[side],qr_redemption_id:linked.qr_redemptions?.[side],earning_id:linked.commission_events?.[side],payout_batch_id:linked.dancer_payout_batches?.[side],
   status:table==='shifts'?'draft':table==='mydancr_tv_videos'?(side?'pending_review':'approved'):undefined,review_status:table==='dancer_photos'?'pending':undefined,is_active:false,
   duration_seconds:table==='mydancr_tv_videos'?10:undefined,published_at:table==='mydancr_tv_videos'&&!side?'2026-01-01Z':undefined};
  const values=Object.entries(possible).filter(([key,value])=>names.has(key)&&value!==undefined);
  await db.query(`insert into public.${quote(table)}(${values.map(([key])=>quote(key)).join(',')})values(${values.map((_,i)=>'$'+(i+1)).join(',')})`,values.map(([,value])=>value));
 }
 ids.linked=linked;
 return ids;
}

export async function readOwnerPolicyRows(db,role,userId){
 const result={};
 for(const table of ownerPolicyFixture.tables){
  const columns=ownerPolicyFixture.columns.filter(c=>c.table_name===table);
  const key=['id','dancer_id','venue_id','user_id'].find(key=>columns.some(c=>c.column_name===key));assert.ok(key,table+' requires a stable row selector');
  try{result[table]=await asAccountLifecycleRole(db,role,userId,async()=> (await db.query(`select ${quote(key)} as id from public.${quote(table)} order by ${quote(key)}`)).rows.map(r=>r.id));}
  catch(error){assert.equal(error.code,'42501','Unexpected policy evaluation error for '+table);result[table]={denied:error.code};}
 }
 try{result.public_dancer_profiles=await asAccountLifecycleRole(db,role,userId,async()=> (await db.query('select id from public.public_dancer_profiles order by id')).rows.map(r=>r.id));}catch(error){assert.equal(error.code,'42501','Unexpected public view evaluation error');result.public_dancer_profiles={denied:error.code};}
 return result;
}
