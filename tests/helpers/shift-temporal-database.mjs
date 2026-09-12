import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
export const shiftSchema=JSON.parse(readFileSync(new URL('../fixtures/shift-temporal-schema.json',import.meta.url),'utf8'));
export const shiftMigration=readFileSync(new URL('../../supabase/migrations/20260912083000_preserve_shift_local_dates.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const shiftId=n=>'a1610000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createShiftDatabase({migrate=true}={}) {
  const db=new PGlite();
  try {
    // The target is complete. Related identity/affiliation controls are projections.
    await db.exec(`create schema auth;create schema storage;
      create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
      create table public.app_users(id uuid primary key,role text,account_state text);
      create table public.dancer_profiles(id uuid primary key,user_id uuid,status text,verification_status text,venue_approved_at timestamptz,is_public boolean,disabled_at timestamptz);
      create table public.venues(id uuid primary key);
      create table public.nfc_tags(id uuid primary key);
      create table public.venue_dancer_affiliations(id uuid primary key,dancer_id uuid,venue_id uuid,status text);
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant all on public.dancer_profiles,public.venues,public.nfc_tags,public.venue_dancer_affiliations to service_role;
      set search_path=pg_catalog,public,pg_temp;set timezone='UTC';`);
    for(const e of shiftSchema.enums)await db.exec('create type public.'+quote(e.name)+' as enum('+e.labels.map(s=>"'"+s+"'").join(',')+')');
    await db.exec("alter table public.dancer_profiles alter column status type public.dancer_status using status::public.dancer_status,alter column verification_status type public.review_status using verification_status::public.review_status");
    const columns=shiftSchema.columns;
    await db.exec('create table public.shifts('+columns.map(c=>quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+')');
    const relation=shiftSchema.relations[0];
    if(relation.rls)await db.exec('alter table public.shifts enable row level security');
    for(const [role,rights]of Object.entries(relation.grants)){const names=Object.entries(rights).filter(([,allow])=>allow).map(([right])=>right);if(names.length)await db.exec('grant '+names.join(',')+' on public.shifts to '+role);}
    for(const c of shiftSchema.constraints)await db.exec('alter table public.shifts add constraint '+quote(c.name)+' '+c.definition);
    const constraintNames=new Set(shiftSchema.constraints.map(c=>c.name));
    for(const i of shiftSchema.indexes)if(!constraintNames.has(i.indexname))await db.exec(i.indexdef);
    for(const f of shiftSchema.functions){await db.exec(f.definition+';');assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+f.signature])).rows[0].hash,f.fingerprint);if(f.acl!==null)await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');}
    for(const p of shiftSchema.policies)await db.exec('create policy '+quote(p.policyname)+' on public.shifts as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(quote).join(',')+(p.qual?' using('+p.qual+')':'')+(p.with_check?' with check('+p.with_check+')':''));
    for(const t of shiftSchema.triggers)await db.exec(t.definition);
    if(migrate)await db.exec(shiftMigration);
    return db;
  }catch(error){await db.close();throw error;}
}
export async function seedShifts(db) {
  await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false);truncate public.shifts,public.venue_dancer_affiliations,public.nfc_tags,public.venues,public.dancer_profiles");
  await db.query("insert into public.dancer_profiles(id,user_id,status) values($1,$2,'approved'),($3,$4,'approved')",[shiftId(1),shiftId(11),shiftId(2),shiftId(12)]);
  await db.query('insert into public.venues values($1),($2)',[shiftId(100),shiftId(101)]);
  await db.query('insert into public.nfc_tags values($1)',[shiftId(200)]);
  await db.query("insert into public.venue_dancer_affiliations values($1,$2,$3,'active')",[shiftId(300),shiftId(1),shiftId(100)]);
  await db.exec('set role service_role');
}
export async function insertShift(db, change={}) {
  const values={id:shiftId(1000),dancer_id:shiftId(1),venue_id:shiftId(100),starts_at:'2026-10-04T07:01:00Z',ends_at:'2026-10-05T07:01:00Z',timezone:'America/Los_Angeles',shift_date:'2026-10-04',...change};
  return(await db.query('insert into public.shifts('+Object.keys(values).map(quote).join(',')+')values('+Object.keys(values).map((_,i)=>'$'+(i+1)).join(',')+')returning *',Object.values(values))).rows[0];
}
export async function shiftSnapshot(db){return(await db.query("select coalesce(jsonb_agg(to_jsonb(s)order by id),'[]')snapshot from public.shifts s")).rows[0].snapshot;}
