import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260912235000_scope_public_deals_to_published_venues.sql', import.meta.url), 'utf8');
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(harden=true) {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table app_users(id uuid primary key,role text,account_state text);
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from public.app_users where id=auth.uid() and role='admin' and account_state='active')$$;
    create table venues(id uuid primary key,owner_user_id uuid,is_active boolean,published_at timestamptz,page_review_status text);
    create function is_current_venue_owner(p_venue_id uuid) returns boolean language sql stable security definer set search_path='' as $$
      select case when auth.uid() is null then false else exists(select 1 from public.venues v where v.id=p_venue_id and v.owner_user_id=auth.uid())end$$;
    create table club_deals(id uuid primary key,venue_id uuid references venues(id),is_active boolean,deal_title text,payout_amount_cents integer,redemption_rules jsonb);
    alter table venues enable row level security;alter table club_deals enable row level security;
    create policy "active venues are public" on venues for select using(is_active=true or is_admin());
    create policy "venue owners read own venue" on venues for select using(owner_user_id=auth.uid());
    create policy "admins manage venues" on venues for all using(is_admin()) with check(is_admin());
    create policy "Active club deals are public" on club_deals for select using(is_active=true);
    create policy "Admins manage club deals" on club_deals for all using(is_admin()) with check(is_admin());
    create policy "Venue owners read own club deals" on club_deals for select using(exists(select 1 from venues v where v.id=club_deals.venue_id and is_current_venue_owner(v.id)));
    grant select(id,is_active,published_at) on venues to anon,authenticated;
    grant select(id,venue_id,is_active,deal_title) on club_deals to anon,authenticated;
    grant all on venues,club_deals to service_role;
    insert into app_users values('${id(1)}','venue','active'),('${id(2)}','venue','active'),('${id(3)}','admin','active'),('${id(4)}','customer','active'),('${id(5)}','dancer','active'),('${id(6)}','venue','active');
    insert into venues values('${id(11)}','${id(1)}',true,now(),'published'),('${id(12)}','${id(2)}',false,now(),'draft'),('${id(13)}','${id(2)}',true,null,'draft');
    insert into club_deals values('${id(21)}','${id(11)}',true,'Public offer',100,'{}'),('${id(22)}','${id(12)}',true,'Withdrawn venue offer',100,'{}'),('${id(23)}','${id(13)}',true,'Unpublished venue offer',100,'{}'),('${id(24)}','${id(12)}',false,'Historical offer',100,'{}');`);
  if(harden)await db.exec(migration);
  return db;
}
async function actor(db,role,user,action) {
  await db.exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);await db.exec(`set local role ${role}`);return await action();}
  finally {await db.exec('rollback');}
}
const visible=db=>db.query('select id from club_deals order by id').then(r=>r.rows.map(r=>r.id));

test('initial public policy exposes active offers from withdrawn and unpublished venues',async()=>{
  const db=await fixture(false);
  try {assert.deepEqual(await actor(db,'anon',null,()=>visible(db)),[id(21),id(22),id(23)]);}
  finally {await db.close();}
});
test('anonymous, customer, dancer and unrelated venue manager see only published venue offers',async()=>{
  const db=await fixture();
  try {for(const [role,user] of [['anon',null],...([1,4,5,6].map(n=>['authenticated',id(n)]))])assert.deepEqual(await actor(db,role,user,()=>visible(db)),[id(21)]);}
  finally {await db.close();}
});
test('venue owner, active administrator and server retain management/history reads',async()=>{
  const db=await fixture();
  try {for(const [role,user] of [['authenticated',id(2)],['authenticated',id(3)],['service_role',null]])assert.deepEqual(await actor(db,role,user,()=>visible(db)),[id(21),id(22),id(23),id(24)]);}
  finally {await db.close();}
});
test('public visibility follows venue withdrawal and republication without editing deals',async()=>{
  const db=await fixture();
  try {
    await db.query('update venues set is_active=false where id=$1',[id(11)]);
    assert.deepEqual(await actor(db,'anon',null,()=>visible(db)),[]);
    await db.query('update venues set is_active=true where id=$1',[id(11)]);
    assert.deepEqual(await actor(db,'anon',null,()=>visible(db)),[id(21)]);
  } finally {await db.close();}
});
test('public deal policy does not require private venue columns or grant private financial access',async()=>{
  const db=await fixture();
  try {
    for(const role of ['anon','authenticated'])for(const sql of ['select payout_amount_cents from club_deals','select redemption_rules from club_deals','select owner_user_id from venues','select page_review_status from venues','update club_deals set is_active=true'])await assert.rejects(actor(db,role,id(4),()=>db.query(sql)),e=>e.code==='42501');
    assert.deepEqual(await actor(db,'anon',null,()=>visible(db)),[id(21)]);
  } finally {await db.close();}
});
