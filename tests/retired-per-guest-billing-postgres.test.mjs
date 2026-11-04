import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {before,after,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n?/g,'\n');
const migrations = readdirSync(new URL('../supabase/migrations/',import.meta.url))
  .filter(name=>name.endsWith('_retire_per_guest_billing_settlement.sql'));
assert.equal(migrations.length,1);
const migration = read('supabase/migrations/'+migrations[0]);
const fixture = JSON.parse(read('tests/fixtures/public-function-boundaries.json'));
const signature = 'public.settle_deal_revenue_event(uuid,text,text)';
const id = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const settle = () => db.query("select public.settle_deal_revenue_event($1,'venue_payment_received','synthetic reference')",[id(11)]);
let db, history, voidDefinition;
const ledger = async () => ({
  revenue:(await db.query('select * from public.deal_revenue_events order by id')).rows,
  commissions:(await db.query('select * from public.agent_commission_events order by id')).rows,
});
const definition = async name => (await db.query('select pg_get_functiondef($1::regprocedure) definition',[name])).rows[0].definition;

before(async()=>{
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.app_users(id uuid primary key,role text,account_state text,admin_workspace_role text);
    create table public.deal_revenue_events(id uuid primary key,status text,venue_payment_reference text,venue_payment_received_at timestamptz,audit jsonb default '{}');
    create table public.agent_commission_events(id uuid primary key,deal_revenue_event_id uuid,status text,venue_payment_received_at timestamptz,payable_at timestamptz,audit jsonb default '{}');
    create table public.qr_redemptions(id uuid primary key,status text,suspicious boolean,voided_at timestamptz,voided_by_admin uuid,audit jsonb default '{}');
    create table public.qr_redemption_events(qr_redemption_id uuid,event_type text,actor_user_id uuid,audit jsonb);
    insert into app_users values('${id(1)}','admin','active','owner'),('${id(2)}','dancer','active','owner');
    insert into deal_revenue_events(id,status) values('${id(10)}','pending_venue_payment'),('${id(11)}','pending_venue_payment');
    insert into agent_commission_events(id,deal_revenue_event_id,status) values('${id(20)}','${id(10)}','pending_venue_payment'),('${id(21)}','${id(11)}','pending_venue_payment');
    insert into qr_redemptions(id,status) values('${id(30)}','generated');`);
  for (const name of ['is_admin','void_generated_deal_redemption']) {
    const fn=fixture.functions.find(fn=>fn.name===name);assert.ok(fn);
    await db.exec(fn.definition);
    await db.exec('revoke all on function public.'+fn.signature+' from public,anon,authenticated,service_role;grant execute on function public.'+fn.signature+' to authenticated');
  }
  // Reproduce the former live writer from its historical migration, then apply
  // the forward retirement. Historical files remain untouched.
  const historical = read('supabase/migrations/202608220003_agent_commission_nats_settlement.sql');
  const start = historical.indexOf('create or replace function public.settle_deal_revenue_event(');
  assert.ok(start>=0);
  await db.exec(historical.slice(start,historical.indexOf('$$;',start)+3));
  await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;grant execute on function '+signature+' to authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  await db.exec('set role authenticated');
  await db.query("select public.settle_deal_revenue_event($1,'venue_payment_received','historical reference')",[id(10)]);
  await db.exec('reset role');
  history=await ledger();
  assert.equal(history.revenue[0].status,'settled');assert.equal(history.commissions[0].status,'payable');
  voidDefinition=await definition('public.void_generated_deal_redemption(uuid,text)');
  await db.exec(migration);
});
after(async()=>db?.close());

test('retirement preserves paid and pending ledger history and remains idempotent',async()=>{
  assert.deepEqual(await ledger(),history);
  await db.exec(migration);
  assert.deepEqual(await ledger(),history);
  const fn=fixture.functions.find(fn=>fn.name==='settle_deal_revenue_event');
  assert.equal(await definition(signature),fn.definition);
  const {rows:[access]}=await db.query("select prosecdef,proconfig,proacl::text[] acl from pg_proc where oid=$1::regprocedure",[signature]);
  assert.equal(access.prosecdef,false);assert.deepEqual(access.proconfig,['search_path=""']);
  assert.deepEqual(access.acl,['postgres=X/postgres']);
});

for(const [role,user] of [['anon',null],['authenticated',id(1)],['authenticated',id(2)],['service_role',id(1)]]) {
  test(`${role}/${user===id(1)?'owner admin':'other identity'} cannot use the retired settlement`,async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
    await db.exec('set role '+role);
    try {await assert.rejects(settle(),{code:'42501'});} finally {await db.exec('reset role');}
    assert.deepEqual(await ledger(),history);
  });
}
test('the database owner and accidental future re-grants still cannot mutate financial rows',async()=>{
  await assert.rejects(settle(),error=>error.code==='22023'&&/retired/.test(error.message));
  await db.exec('begin;grant execute on function '+signature+' to authenticated,service_role');
  try {
    for(const role of ['authenticated','service_role']) {
      await db.exec('savepoint attempt;set local role '+role);
      await assert.rejects(settle(),error=>error.code==='22023'&&/retired/.test(error.message));
      await db.exec('rollback to savepoint attempt;reset role');
    }
  } finally {await db.exec('rollback');}
  assert.deepEqual(await ledger(),history);
});
test('owner fraud voiding retains its definition, access and audit trail',async()=>{
  assert.equal(await definition('public.void_generated_deal_redemption(uuid,text)'),voidDefinition);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  await db.exec('set role authenticated');
  try {
    const result=await db.query("select public.void_generated_deal_redemption($1,'synthetic fraud review') result",[id(30)]);
    assert.equal(result.rows[0].result.status,'voided');
  } finally {await db.exec('reset role');}
  const audit=(await db.query('select actor_user_id,event_type from qr_redemption_events')).rows;
  assert.deepEqual(audit,[{actor_user_id:id(1),event_type:'voided'}]);
  assert.deepEqual(await ledger(),history);
});
