import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const tapSchema=JSON.parse(readFileSync(new URL('../fixtures/dancer-tap-schema.json',import.meta.url),'utf8'));
export const tapMigrationPath='supabase/migrations/20260910082000_add_atomic_dancer_tap_entry.sql';
export const tapMigration=readFileSync(new URL('../../'+tapMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const tapSignature='public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb)';
export const tapTables=[...new Set(tapSchema.columns.map(r=>r.table))];
export const fixtureId=n=>'97000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createTapDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;");
  for(const [name,labels]of Object.entries(tapSchema.enums))await pg.exec('create type public.'+quote(name)+' as enum('+labels.map(s=>"'"+s+"'").join(',')+')');
  // Auth identities and peripheral tables are synthetic projections; all eleven target tables and eight triggers retain the captured schema.
  await pg.exec('create table public.dancer_profile_slug_aliases(slug text primary key,dancer_id uuid);create table public.venue_team_members(venue_id uuid,user_id uuid,status text);create table public.club_deals(id uuid primary key default gen_random_uuid(),venue_id uuid,deal_title text,deal_description text,deal_terms text,is_active boolean,redemption_rules jsonb,payout_type text,payout_amount_cents integer,currency text)');
  for(const table of tapTables){
   const columns=tapSchema.columns.filter(r=>r.table===table).map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
   await pg.exec('create table public.'+quote(table)+'('+columns.join(',')+')');await pg.exec('alter table public.'+quote(table)+' enable row level security');
  }
  for(const foreign of [false,true])for(const r of tapSchema.constraints.filter(r=>r.definition.startsWith('FOREIGN KEY')===foreign))await pg.exec('alter table public.'+quote(r.table)+' add constraint '+quote(r.name)+' '+r.definition);
  const names=new Set(tapSchema.constraints.map(r=>r.name));for(const r of tapSchema.indexes)if(!names.has(r.name))await pg.exec(r.definition);
  for(const r of tapSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  for(const fn of tapSchema.functions){await pg.exec(fn.definition);const signature='public.'+fn.name+(fn.name==='finalize_pending_dancer_nfc_enrollment'?'(uuid,uuid,jsonb)':'(uuid,uuid,uuid,jsonb)');assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,fn.fingerprint);await pg.exec('revoke all on function '+signature+' from public,anon,authenticated;grant execute on function '+signature+' to service_role');}
  await pg.exec('grant usage on schema public,auth to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant all on auth.users to service_role');
  if(migrate)await pg.exec(tapMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedTapDatabase(pg){
 await pg.exec("reset role;set timezone='UTC';set request.jwt.claim.role='service_role'");
 for(const table of tapTables)await pg.exec('drop trigger if exists synthetic_failure on public.'+table);
 for(const fn of tapSchema.functions)await pg.exec(fn.definition);
 await pg.exec('truncate '+tapTables.map(t=>'public.'+t).concat(['auth.users','public.dancer_profile_slug_aliases','public.venue_team_members','public.club_deals']).join(','));
 for(const [n,role]of [[1,'dancer'],[2,'venue'],[3,'admin'],[4,'customer'],[5,'dancer'],[6,'venue']]){await pg.query('insert into auth.users values($1)',[fixtureId(n)]);await pg.query("insert into public.app_users(id,role,account_state) values($1,$2,'active')",[fixtureId(n),role]);}
 for(const [n,owner]of [[20,2],[21,6]])await pg.query("insert into public.venues(id,name,slug,city,owner_user_id,is_active,timezone) values($1,'Synthetic club',$2,'Las Vegas',$3,true,'America/Los_Angeles')",[fixtureId(n),'synthetic-club-'+n,fixtureId(owner)]);
 for(const [n,venue]of [[30,20],[31,21]])await pg.query("insert into public.nfc_tags(id,venue_id,tag_type,label,token_digest,status) values($1,$2,'dressing_room','Synthetic dressing room',repeat($3,64),'active')",[fixtureId(n),fixtureId(venue),String(n-29)]);
 for(const [n,owner]of [[10,1],[11,5]]){
  await pg.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,city,status,verification_status,photo_review_status,avatar_storage_path,is_public) values($1,$2,'Synthetic name','Synthetic dancer',$3,'Las Vegas','pending_review','pending','approved','synthetic/avatar',false)",[fixtureId(n),fixtureId(owner),'synthetic-dancer-'+n]);
  await pg.query("insert into public.dancer_photos(id,dancer_id,storage_path,review_status,sort_order) values($1,$2,$3,'approved',1)",[fixtureId(n+100),fixtureId(n),'synthetic/photo-'+n]);
 }
 await pg.exec('set role service_role');
}
export async function tap(pg,{tag=fixtureId(30),dancer=fixtureId(1),session=fixtureId(50),audit={}}={}){
 return (await pg.query('select public.register_and_activate_dancer_tap($1,$2,$3,$4::jsonb) result',[tag,dancer,session,JSON.stringify(audit)])).rows[0].result;
}
export async function tapSnapshot(pg){
 const out={};for(const table of tapTables)out[table]=(await pg.query('select to_jsonb(t) row from public.'+table+' t order by id')).rows.map(r=>r.row);return out;
}
