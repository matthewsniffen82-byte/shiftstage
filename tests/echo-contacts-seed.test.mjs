import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const seed = read('../scripts/seed-echo-contacts.sql');
const venue = '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role anon; create role authenticated; create role service_role bypassrls;
    create function pg_advisory_xact_lock(integer) returns void language sql as 'select null::void';
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,banned_until timestamptz);
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,name text,is_active boolean,owner_user_id uuid);
    create table venue_follows(customer_id uuid references app_users,venue_id uuid references venues,primary key(customer_id,venue_id));
    create table qr_redemptions(id uuid primary key,venue_id uuid,customer_id uuid,status text,expires_at timestamptz,audit jsonb);
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,guest_name text,email text,phone text,created_at timestamptz default now());
    insert into app_users values('${id(1)}','venue','active');
    insert into venues values('${venue}','Echo House',true,'${id(1)}'),('${id(2)}','Other venue',true,'${id(1)}');
  `);
  await db.exec(read('../supabase/migrations/20261007200000_venue_customer_sharing.sql'));
  await db.exec(read('../supabase/migrations/20261012012829_venue_guest_update_opt_ins.sql').split('-- The server first')[0] + '\ncommit;');
  const operations = read('../supabase/migrations/20261012053733_venue_operations_workspace.sql');
  await db.exec(operations.slice(operations.indexOf('create function public.search_venue_customers'), operations.lastIndexOf('commit;')));
  for (let n = 1; n <= 13; n++) {
    // The thirteenth guest is a private real-account stand-in: never seed sharing or update consent for it.
    const email = n === 13 ? 'private@example.test' : `echo-experience-guest-${String(n).padStart(2, '0')}@synthetic.mydancr.invalid`;
    await db.query('insert into auth.users values($1,$2,$3,now()+interval \'100 years\')', [id(100+n), email, { dataset_marker: 'mydancr-echo-dashboard-v1' }]);
    await db.query("insert into app_users values($1,'customer','active')", [id(100+n)]);
    await db.query('insert into venue_follows values($1,$2),($1,$3)', [id(100+n), venue, id(2)]);
    await db.query("insert into qr_redemptions values($1,$2,$3,'generated',now()+interval '1 day',$4)", [id(200+n), venue, id(100+n), { dataset_marker: 'mydancr-echo-dashboard-v1' }]);
    await db.query('insert into venue_guest_list_entries(pass_id,venue_id,guest_name,email,phone) values($1,$2,$3,$4,$5)', [id(200+n), venue, `Sample guest ${String(n).padStart(2,'0')}`, email, `+170255501${String(n).padStart(2,'0')}`]);
  }
  return db;
}

test('sample Contacts populate every filter with linked fictional records and preserve edits on replay', async () => {
  const db = await fixture();
  try {
    await db.exec(seed);
    for (const source of ['all', 'followers', 'guests']) {
      const { rows } = await db.query('select * from search_venue_customers($1,$2,0,\'Sample guest\')', [venue, source]);
      assert.equal(rows.filter(r => r.email.endsWith('@synthetic.mydancr.invalid')).length, 12);
      if (source === 'followers') assert.equal(rows.length, 12, 'Private follows must not become shared contacts');
    }
    const { rows: search } = await db.query("select * from search_venue_customers($1,'followers',0,'guest 07')", [venue]);
    assert.equal(search.length, 1);
    assert.equal(search[0].city, 'Las Vegas');
    assert.equal(search[0].phone, '+17025550107');
    assert.equal(search[0].is_guest, true);
    assert.deepEqual((await db.query('select channel,count(*)::int n from venue_update_subscriptions group by channel order by channel')).rows,
      [{channel:'email',n:8},{channel:'text',n:6}]);
    assert.equal((await db.query('select count(*)::int n from venue_update_consent_events e join venue_guest_list_entries g on g.pass_id=e.source_id join venue_update_subscriptions s on s.id=e.subscription_id where s.destination in(g.email,g.phone)')).rows[0].n, 14);
    assert.equal((await db.query('select count(distinct manage_token)::int n from venue_update_subscriptions')).rows[0].n, 14);
    assert.equal((await db.query('select count(*)::int n from venue_customer_shares where venue_id<>$1 or customer_id=$2', [venue,id(113)])).rows[0].n, 0);

    await db.query("update venue_customer_shares set name='Edited sample name' where customer_id=$1", [id(101)]);
    await db.exec("update venue_update_subscriptions set withdrawn_at=now() where channel='text'");
    const snapshot = (await db.query('select * from venue_update_subscriptions order by id')).rows;
    await db.exec(seed);
    assert.deepEqual((await db.query('select * from venue_update_subscriptions order by id')).rows, snapshot);
    assert.equal((await db.query('select count(*)::int n from venue_update_consent_events')).rows[0].n, 14);
    assert.equal((await db.query('select name from venue_customer_shares where customer_id=$1', [id(101)])).rows[0].name, 'Edited sample name');
    assert.equal((await db.query("select count(*)::int n from venue_update_subscriptions where channel='text' and withdrawn_at is null")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('seed fails before writes if the venue or fictional cohort no longer matches', async () => {
  const db = await fixture();
  try {
    for (const change of [
      "update venues set name='Different venue' where id='"+venue+"'",
      "update auth.users set banned_until=null where id='"+id(101)+"'",
      "update auth.users set raw_user_meta_data='{}' where id='"+id(101)+"'",
      "update app_users set account_state='disabled' where id='"+id(101)+"'",
      "update venue_guest_list_entries set phone='+17025559999' where pass_id='"+id(201)+"'",
    ]) {
      await db.exec('begin;'+change);
      await assert.rejects(db.exec(seed), /Expected/);
      await db.exec('rollback');
      assert.equal((await db.query('select count(*)::int n from venue_customer_shares')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from venue_update_subscriptions')).rows[0].n, 0);
    }
  } finally { await db.close(); }
});
