import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('private email receipts bind to the worker recipient and outlive delivery retention until successful entry', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema private;
      create table public.app_users(id uuid primary key, role text, account_state text, email text);
      create table public.venues(id uuid primary key);
      create table public.venue_email_deliveries(id uuid primary key, recipient_id uuid, venue_id uuid, status text, destination text, payload jsonb);
      create table public.venue_email_events(event_key text primary key, created_at timestamptz default now());
      create table public.dancer_media_email_deliveries(id uuid primary key, recipient_id uuid, status text, destination text);
      create table public.club_offer_digests(like public.dancer_media_email_deliveries including all);
      create table public.lifecycle_retention_rules(source text primary key,policy_id uuid,policy_revision int,due_expression text);
      insert into public.lifecycle_retention_rules values('venue_email_deliveries',gen_random_uuid(),1,'now()');
    `);
    const { readdir } = await import('node:fs/promises');
    const root = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(root)).filter(name => /_(notification_email_signins|confirm_email_signin_arrival)\.sql$/.test(name)).sort()) {
      await db.exec(await readFile(new URL(file, root), 'utf8'));
    }
    const id = '11111111-1111-4111-8111-111111111111';
    const venue = '22222222-2222-4222-8222-222222222222';
    const delivery = '33333333-3333-4333-8333-333333333333';
    const email = 'recipient@example.test';
    const prepare = async (source, role, dest = email) => (await db.query('select public.prepare_notification_email_signin($1,$2,$3,$4,$5,$6,$7) as id',
      [source, delivery, id, role, dest, 'mailtag', 'delivery-'+source])).rows[0].id;
    await db.query("insert into app_users values ($1,'venue','active',$2)", [id,email]);
    await db.query('insert into venues values ($1)', [venue]);
    await db.query("insert into venue_email_deliveries values ($1,$2,$3,'sending',$4,$5)", [delivery,id,venue,email,{kind:'venue_media_pending',emailPath:'/dashboard/venue#venue-media-reviews'}]);
    for (const [source, role, table] of [['venue','venue','venue_email_deliveries'], ['dancer','dancer','dancer_media_email_deliveries'], ['digest','customer','club_offer_digests']]) {
      await db.query('update app_users set role=$1', [role]);
      if (source !== 'venue') await db.query('insert into '+table+" values ($1,$2,'sending',$3)",[delivery,id,email]);
      assert.equal(await prepare(source,role,'other@example.test'), null);
      const first = await prepare(source,role);
      assert.ok(first);
      await db.query('update notification_email_signins set used_at=now() where id=$1', [first]);
      assert.equal(await prepare(source,role), first);
      assert.ok((await db.query('select used_at from notification_email_signins where id=$1', [first])).rows[0].used_at);
      await db.query("update "+table+" set status='accepted' where id=$1",[delivery]);
      assert.equal(await prepare(source,role),null);
    }
    assert.ok(await prepare('notification','customer'));
    const record = () => db.query('select review_kind,used_at from notification_email_signins where id=$1',[delivery]);
    assert.deepEqual((await record()).rows[0], { review_kind:'media', used_at:null });
    await db.query("insert into venue_email_events(event_key) values ($1)",['review-login:'+delivery]);
    await db.query('delete from venue_email_deliveries');
    assert.ok((await record()).rows[0].used_at);
    const rules = await db.query("select due_expression from lifecycle_retention_rules where source='notification_email_signins'");
    assert.match(rules.rows[0].due_expression,/used_at/);
    const privileges = await db.query("select has_table_privilege('authenticated','notification_email_signins','update') as can_write");
    assert.equal(privileges.rows[0].can_write,false);
  } finally { await db.close(); }
});
