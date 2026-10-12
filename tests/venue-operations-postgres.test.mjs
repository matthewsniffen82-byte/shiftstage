import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
  pg=new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,owner_user_id uuid);
    create table venue_team_members(venue_id uuid,user_id uuid,role text,status text);
    create table club_shuttle_requests(id uuid primary key,venue_id uuid,created_at timestamptz default now(),notification_rows jsonb);
    alter table club_shuttle_requests enable row level security;
    create table nfc_tags(venue_id uuid,tag_type text,status text);
    create table venue_vip_requests(venue_id uuid,status text);
    create table internal_roster_requests(venue_id uuid,status text,created_at timestamptz default now());
    create table qr_redemptions(id uuid primary key,venue_id uuid,customer_id uuid,status text,expires_at timestamptz,arrival_method text,redeemed_at timestamptz,admission_pass_version smallint default 1);
    create table venue_guest_list_entries(pass_id uuid,venue_id uuid,guest_name text,phone text,email text,created_at timestamptz default now());
    create table venue_customer_shares(customer_id uuid,venue_id uuid,name text,email text,city text,consented_at timestamptz default now());
    grant usage on schema public to service_role;
    grant select,insert on all tables in schema public to service_role;
  `);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261012053733_venue_operations_workspace.sql',import.meta.url),'utf8'));
  for(const n of [1,2,3,4])await pg.query("insert into app_users values($1,'venue','active')",[id(n)]);
  await pg.query('insert into venues values($1,$2),($3,$4)',[id(10),id(1),id(11),id(4)]);
  await pg.query("insert into venue_team_members values($1,$2,'manager','active'),($1,$3,'staff','active')",[id(10),id(2),id(3)]);
  await pg.query('insert into club_shuttle_requests(id,venue_id) values($1,$2),($3,$4)',[id(20),id(10),id(21),id(11)]);
});
after(async()=>pg?.close());
const set=(actor,venue,ride,status,version)=>pg.query('select set_venue_ride_status($1,$2,$3,$4,$5) value',[id(actor),id(venue),id(ride),status,version]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}

test('owner and manager ride updates are versioned, audited and leave receipts untouched',()=>isolated(async()=>{
  await pg.exec('set local role service_role');
  let row=(await set(1,10,20,'contacted',0)).rows[0].value;
  assert.equal(row.staff_status_version,1);assert.equal(row.staff_status,'contacted');
  row=(await set(2,10,20,'arranged',1)).rows[0].value;
  assert.equal(row.staff_status_version,2);
  assert.equal((await pg.query('select count(*)::int n from venue_ride_status_events')).rows[0].n,2);
  assert.equal((await pg.query('select notification_rows from club_shuttle_requests where id=$1',[id(20)])).rows[0].notification_rows,null);
}));
test('stale updates cannot overwrite another staff member or create an extra history entry',()=>isolated(async()=>{
  await set(1,10,20,'completed',0);await pg.exec('savepoint stale');
  await assert.rejects(set(2,10,20,'cancelled',0),e=>e.code==='40001');await pg.exec('rollback to stale');
  assert.equal((await pg.query('select staff_status from club_shuttle_requests where id=$1',[id(20)])).rows[0].staff_status,'completed');
  assert.equal((await pg.query('select count(*)::int n from venue_ride_status_events')).rows[0].n,1);
}));
test('staff, another club, removed managers and disabled accounts cannot update rides',async()=>{
  for(const args of [[3,10,20],[4,10,20],[1,10,21]])await isolated(async()=>assert.rejects(set(...args,'contacted',0)));
  for(const sql of ["update venue_team_members set status='removed'",`update app_users set account_state='disabled' where id='${id(2)}'`,`update app_users set account_state='disabled' where id='${id(1)}'`])await isolated(async()=>{
    await pg.exec(sql);await assert.rejects(set(2,10,20,'contacted',0),e=>e.code==='42501');
  });
});
test('guest search filters before pagination, respects the club and excludes invalid passes',()=>isolated(async()=>{
  for(let n=100;n<160;n++){
    await pg.query("insert into qr_redemptions values($1,$2,null,'generated',now()+interval '1 hour','guest_list',null,1)",[id(n),id(10)]);
    await pg.query("insert into venue_guest_list_entries(pass_id,venue_id,guest_name,phone) values($1,$2,$3,'+17025550100')",[id(n),id(10),n===100?'María Special':'Other Guest']);
  }
  const search=async(venue,term,status='all',offset=0)=>(await pg.query('select * from search_venue_guests($1,$2,$3,null,$4)',[id(venue),term,status,offset])).rows;
  assert.equal((await search(10,'maría'))[0].name,'María Special');
  assert.equal((await search(10,'')).length,51);assert.equal((await search(10,'','all',50)).length,10);
  assert.equal((await search(11,'')).length,0);assert.equal((await search(10,'%')).length,0);
  await pg.query("update qr_redemptions set status='redeemed',redeemed_at=now() where id=$1",[id(100)]);
  assert.equal((await search(10,'maría','generated')).length,0);assert.equal((await search(10,'maría','redeemed')).length,1);
  await pg.query("update qr_redemptions set expires_at=now()-interval '1 minute' where id=$1",[id(100)]);assert.equal((await search(10,'maría')).length,0);
}));
test('live queue counts exclude old table and ride requests, completed rides and other clubs',()=>isolated(async()=>{
  await pg.query("insert into internal_roster_requests values($1,'pending',now()),($1,'pending',now()-interval '7 hours'),($2,'pending',now())",[id(10),id(11)]);
  await pg.query("insert into club_shuttle_requests(id,venue_id,created_at) values($1,$2,now()-interval '49 hours')",[id(22),id(10)]);
  const read=async()=>(await pg.query("select get_venue_operations($1,now()-interval '1 hour',now()+interval '1 hour') value",[id(10)])).rows[0].value;
  assert.equal((await read()).ridesOpen,1);assert.equal((await read()).tablePending,1);
  await set(1,10,20,'completed',0);assert.equal((await read()).ridesOpen,0);
}));
test('contact search uses only current sharing and filters before paging',()=>isolated(async()=>{
  await pg.query("insert into app_users values($1,'customer','active')",[id(50)]);
  await pg.query("insert into venue_customer_shares values($1,$2,'Searchable Guest','shared@example.test','Vegas',now())",[id(50),id(10)]);
  const search=async venue=>(await pg.query("select * from search_venue_customers($1,'all',0,'searchable')",[id(venue)])).rows;
  assert.equal((await search(10)).length,1);assert.equal((await search(11)).length,0);
  await pg.query('delete from venue_customer_shares where customer_id=$1',[id(50)]);assert.equal((await search(10)).length,0);
}));
test('browser roles cannot read status history or call server-only operations',async()=>{
  for(const role of ['anon','authenticated'])for(const statement of ['select * from venue_ride_status_events',`select get_venue_operations('${id(10)}',now(),now())`,`select set_venue_ride_status('${id(1)}','${id(10)}','${id(20)}','completed',0)`])await isolated(async()=>{
    await pg.exec(`set local role ${role}`);await assert.rejects(pg.exec(statement),e=>e.code==='42501');
  });
});
