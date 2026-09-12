import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260912234500_limit_notification_updates_to_read_marker.sql', import.meta.url), 'utf8');
const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// These unchanged policies were checked against the live catalog on 2026-09-12.
const policies = JSON.parse(readFileSync(new URL('./fixtures/rls-current-access.json', import.meta.url), 'utf8'))
  .policies.filter(p => p.tablename === 'notifications');
async function fixture(harden = true) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table app_users(id uuid primary key,role text,account_state text);
    create function is_admin() returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from public.app_users where id=auth.uid() and role='admin' and account_state='active')$$;
    create table notifications(id uuid primary key,recipient_id uuid not null references app_users(id),
      notification_type text,channel text,title text,body text,payload jsonb,read_at timestamptz,sent_at timestamptz,created_at timestamptz default now());
    alter table notifications enable row level security;
    grant select on notifications to anon;
    grant select,insert,update,delete on notifications to authenticated,service_role;
    insert into app_users values('${id(1)}','customer','active'),('${id(2)}','venue','active'),('${id(3)}','dancer','active'),('${id(4)}','admin','active');
    insert into notifications(id,recipient_id,title,body,payload) values
      ('${id(11)}','${id(1)}','Account notice','Original message','{"kind":"account"}'),
      ('${id(12)}','${id(2)}','Shuttle request','Original pickup','{"kind":"club_shuttle_request","partySize":2}'),
      ('${id(13)}','${id(3)}','Dancer notice','Original message','{}');`);
  for (const p of policies) await db.exec(`create policy "${p.policyname}" on notifications for ${p.cmd} to ${p.roles.join(',')}
    ${p.qual ? `using (${p.qual})` : ''} ${p.with_check ? `with check (${p.with_check})` : ''}`);
  if (harden) await db.exec(migration);
  return db;
}
async function actor(db,role,user,action) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user || '']);
    await db.exec(`set local role ${role}`);
    return await action();
  } finally { await db.exec('rollback'); }
}

test('initial permission reproduces recipient modification of pickup details',async()=>{
  const db=await fixture(false);
  try { assert.equal((await actor(db,'authenticated',id(2),()=>db.query("update notifications set payload='{}' where id=$1 returning id",[id(12)]))).rows.length,1); }
  finally { await db.close(); }
});

test('customer, venue manager and dancer retain read markers and own inbox cleanup',async()=>{
  const db=await fixture();
  try {
    for(const n of [1,2,3]) await actor(db,'authenticated',id(n),async()=>{
      assert.equal((await db.query('select id from notifications')).rows.length,1);
      assert.equal((await db.query('update notifications set read_at=now() where recipient_id=$1 returning read_at',[id(n)])).rows.length,1);
      assert.equal((await db.query('delete from notifications where recipient_id=$1 returning id',[id(n)])).rows.length,1);
    });
  } finally { await db.close(); }
});

test('owners cannot forge any message/provenance column, including legacy column grants',async()=>{
  const db=await fixture(false);
  try {
    await db.exec('grant update(payload) on notifications to authenticated');
    await db.exec(migration);
    for(const n of [1,2,3]) for(const column of ['id','recipient_id','notification_type','channel','title','body','payload','sent_at','created_at']) {
      await assert.rejects(actor(db,'authenticated',id(n),()=>db.query(`update notifications set ${column}=${column} where recipient_id=$1`,[id(n)])),e=>e.code==='42501');
    }
    for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_column_privilege($1,'notifications','payload','UPDATE') allowed",[role])).rows[0].allowed,false);
  } finally { await db.close(); }
});

test('anonymous and other recipients cannot read, mark or delete another inbox',async()=>{
  const db=await fixture();
  try {
    for(const [role,user] of [['anon',null],['authenticated',id(3)]]) await actor(db,role,user,async()=>{
      assert.equal((await db.query('select id from notifications where id=$1',[id(12)])).rows.length,0);
      for(const sql of ['update notifications set read_at=now() where id=$1 returning id','delete from notifications where id=$1 returning id']) {
        if(role==='anon') await assert.rejects(db.query(sql,[id(12)]),e=>e.code==='42501');
        else assert.equal((await db.query(sql,[id(12)])).rows.length,0);
        if(role==='anon') break; // A denied statement aborts this identity transaction.
      }
    });
  } finally { await db.close(); }
});

test('active admin insert/read and trusted server delivery remain functional',async()=>{
  const db=await fixture();
  try {
    await actor(db,'authenticated',id(4),async()=>{
      assert.equal((await db.query('select id from notifications')).rows.length,3);
      await db.query('insert into notifications(id,recipient_id,title) values($1,$2,$3)',[id(20),id(1),'Admin notice']);
    });
    await actor(db,'service_role',null,async()=>{
      assert.equal((await db.query('update notifications set sent_at=now(),payload=payload where id=$1 returning id',[id(12)])).rows.length,1);
    });
  } finally { await db.close(); }
});
