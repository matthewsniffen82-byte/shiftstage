import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const snapshot=JSON.parse(readFileSync(new URL('../fixtures/account-provisioning-current.json',import.meta.url),'utf8'));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>"'"+value.replaceAll("'","''")+"'";

export async function createProvisioningDatabase(){
 const db=new PGlite();
 await db.exec("create schema auth;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');create table public.venues(id uuid primary key);");
 for(const e of snapshot.enums)await db.exec(`create type public.${quote(e.name)} as enum(${e.labels.map(literal).join(',')})`);
 for(const table of snapshot.relations){
  const columns=snapshot.columns.filter(c=>c.table_name===table.name);
  await db.exec(`create table public.${quote(table.name)} (${columns.map(c=>`${quote(c.column_name)} ${quote(c.udt_schema)}.${quote(c.udt_name)}${c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`).join(',')})`);
  if(table.rls)await db.exec(`alter table public.${quote(table.name)} enable row level security`);
  await db.exec(`grant all on public.${quote(table.name)} to service_role`);
 }
 for(const foreign of [false,true])for(const c of snapshot.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign)){
  await db.exec(`alter table public.${quote(c.table_name)} add constraint ${quote(c.name)} ${c.definition}`);
 }
 for(const name of ['slugify','unique_dancer_slug','assign_dancer_profile_link','handle_new_auth_user','provision_app_account_safely']){
  await db.exec(snapshot.functions.find(f=>f.name===name).definition+';');
 }
 for(const trigger of snapshot.triggers.filter(t=>t.definition.includes('on_auth_user_created')||t.definition.includes('assign_dancer_profile_link'))){
  await db.exec(trigger.definition);
 }
 await db.exec("revoke all on function public.provision_app_account_safely(uuid,text,text,text,text) from public,anon,authenticated;grant execute on function public.provision_app_account_safely(uuid,text,text,text,text) to service_role;");
 return db;
}

export async function insertIdentity(db,id,role='dancer',{bootstrap=true,trustedRole}={}){
 if(!bootstrap)await db.exec('alter table auth.users disable trigger on_auth_user_created');
 try{
  await db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)',[id,'synthetic@example.test',JSON.stringify({role}),JSON.stringify(trustedRole?{mydancr_provisioned_role:trustedRole}:{})]);
 }finally{if(!bootstrap)await db.exec('alter table auth.users enable trigger on_auth_user_created');}
}

export async function provision(db,id,role='dancer'){
 return (await db.query('select public.provision_app_account_safely($1,$2,$3,$4,$5) as acknowledged',[id,role,'synthetic@example.test','Synthetic',''])).rows[0].acknowledged;
}
