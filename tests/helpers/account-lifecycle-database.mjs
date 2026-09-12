import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const accountLifecycleSchema=JSON.parse(readFileSync(new URL('../fixtures/account-lifecycle-current.json',import.meta.url),'utf8'));
export const accountLifecycleSource=readFileSync(new URL('../../supabase/migrations/20260912113200_make_self_service_account_transitions_atomic.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const accountLifecycleId=n=>'a2700000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";

export async function createAccountLifecycleDatabase({migrate=true}={}) {
  const schema=accountLifecycleSchema,db=new PGlite();
  try {
    await db.exec(`create schema auth;create schema storage;create schema supabase_migrations;
      create role anon;create role authenticated;create role service_role bypassrls;
      create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
      create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');
      create table public.dancer_profile_slug_aliases(slug text primary key,dancer_id uuid);
      create table public.dancer_photos(id uuid primary key,dancer_id uuid,storage_path text);
      create table public.image_moderation_records(id uuid primary key,final_storage_path text);
      create table public.gallery_media_reference_history(id uuid primary key default gen_random_uuid(),source_kind text,source_id uuid,profile_id uuid,storage_path text,event_kind text,created_at timestamptz default now());
      create table public.gallery_storage_retirements(storage_path text primary key);
      create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant all on all tables in schema public,auth to service_role;
      set timezone='UTC';select set_config('request.jwt.claim.role','service_role',false);`);
    for(const e of schema.enums)await db.exec(`create type public.${quote(e.name)} as enum(${e.labels.map(literal).join(',')})`);
    for(const table of schema.scope.tables) {
      const columns=schema.columns.filter(c=>c.table_name===table);
      await db.exec(`create table public.${quote(table)}(${columns.map(c=>quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')})`);
    }
    await db.exec(schema.functions.find(f=>f.name==='club_deal_is_liquor_related').definition+';');
    for(const type of ['p','u','c','f'])for(const c of schema.constraints.filter(c=>c.type===type)) {
      await db.exec(`alter table public.${quote(c.table_name)} add constraint ${quote(c.name)} ${c.definition}`);
    }
    const keys=new Set(schema.constraints.map(c=>c.name));
    for(const index of schema.indexes)if(!keys.has(index.indexname))await db.exec(index.indexdef);
    for(const f of [...schema.functions].sort((a,b)=>(a.name==='slugify'?-1:0)-(b.name==='slugify'?-1:0))) {
      await db.exec(f.definition+';');
      assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+f.signature])).rows[0].hash,f.fingerprint,f.name);
      if(f.acl!==null)await db.exec(`revoke all on function public.${f.signature} from public,anon,authenticated,service_role`);
      for(const [role,key] of [['anon','anon'],['authenticated','authenticated'],['service_role','service']])if(f[key])await db.exec(`grant execute on function public.${f.signature} to ${role}`);
    }
    for(const p of schema.policies)await db.exec(`create policy ${quote(p.policyname)} on public.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''}`);
    for(const r of schema.relations) {
      if(r.rls)await db.exec(`alter table public.${quote(r.name)} enable row level security`);
      if(r.force_rls)await db.exec(`alter table public.${quote(r.name)} force row level security`);
      for(const [role,rights] of Object.entries(r.grants)) {
        const names=Object.entries(rights).filter(([,allow])=>allow).map(([right])=>right);
        if(names.length)await db.exec(`grant ${names.join(',')} on public.${quote(r.name)} to ${role}`);
      }
    }
    for(const c of schema.columnAccess)if(c.acl!==null) {
      assert.equal(c.acl,'{anon=r/postgres,authenticated=r/postgres}');
      await db.exec(`grant select(${quote(c.column)})on public.${quote(c.table)} to anon,authenticated`);
    }
    for(const trigger of schema.triggers)await db.exec(trigger.definition);
    if(migrate)await db.exec(accountLifecycleSource);
    return db;
  } catch(error) {await db.close();throw error;}
}

export async function seedAccountLifecycle(db,{n=1,role='customer',state='active',venueActive=true,profilePublic=true,metadata={},forgedMetadata={}}={}) {
  const userId=accountLifecycleId(n),venueId=accountLifecycleId(n+100),dancerId=accountLifecycleId(n+200);
  await db.query('insert into auth.users(id,raw_app_meta_data,raw_user_meta_data)values($1,$2,$3)',[userId,JSON.stringify({provider:'email',trusted_extra:'preserve',...metadata}),JSON.stringify(forgedMetadata)]);
  await db.query('insert into public.app_users(id,role,display_name,email,account_state)values($1,$2,$3,$4,$5)',[userId,role,'Synthetic','synthetic@example.invalid',state]);
  if(role==='venue')await db.query("insert into public.venues(id,owner_user_id,name,slug,city,is_active,page_review_status,published_at)values($1,$2,'Synthetic Venue',$3,'Las Vegas',$4,'published','2026-01-01Z')",[venueId,userId,'synthetic-venue-'+n,venueActive]);
  if(role==='dancer')await db.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,status,verification_status,photo_review_status,is_public,approved_at,venue_approved_at)values($1,$2,'Synthetic Name','Synthetic Dancer',$3,'approved','approved','approved',$4,'2026-01-01Z','2026-01-01Z')",[dancerId,userId,'synthetic-dancer-'+n,profilePublic]);
  return {userId,venueId:role==='venue'?venueId:null,dancerId:role==='dancer'?dancerId:null};
}

export async function transitionOwnAccount(db,userId,state) {
  return (await db.query('select public.transition_own_account_safely($1,$2)account',[userId,state])).rows[0].account;
}

export async function accountLifecycleSnapshot(db) {
  const result={};
  for(const table of ['auth.users',...accountLifecycleSchema.scope.tables.map(name=>'public.'+name),'public.account_self_pauses']) {
    result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]')rows from ${table} t`)).rows[0].rows;
  }
  return result;
}

export async function asAccountLifecycleRole(db,role,userId,callback) {
  assert.ok(['anon','authenticated','service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[userId||'',role]);
    await db.exec('set local role '+role);
    const result=await callback();await db.exec('commit');return result;
  } catch(error) {await db.exec('rollback');throw error;}
}
