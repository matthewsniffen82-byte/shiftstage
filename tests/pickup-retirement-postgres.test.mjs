import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pickupFixture, pickupId as id } from './helpers/pickup-fixture.mjs';

const migration = '20260916020000_retire_pickup_chat.sql';
test('retirement blocks direct chat access and commands while retaining history and manager contact authorization', async () => {
  const { db, asUser } = await pickupFixture([
    '20260914190000_club_pickup_domain.sql', '20260914191000_club_pickup_security_commands.sql',
    '20260914192000_club_pickup_inbox_queries.sql', '20260914193000_public_club_pickup_availability.sql',
    '20260914194000_club_pickup_arrival_attribution.sql', '20260914195000_harden_pickup_transitions.sql',
    '20260915180000_guest_pickup_chat.sql', '20260916010000_guest_pickup_unread_count.sql',
  ]);
  try {
    await asUser(3); await db.query('select pickup_set_enabled($1,true)', [id(10)]);
    await asUser(1); await db.query("select pickup_create_request($1,$2,'Synthetic hotel',2,'pickup-chat-v1')", [id(20),id(10)]);
    await db.exec('reset role');
    const counts = (await db.query('select (select count(*) from pickup_requests) requests, (select count(*) from pickup_messages) messages')).rows;
    await db.exec(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select (select count(*) from pickup_requests) requests, (select count(*) from pickup_messages) messages')).rows, counts);
    assert.equal((await db.query('select bool_or(club_pickup_enabled) enabled from venues')).rows[0].enabled, false);
    assert.equal((await db.query("select count(*) n from pg_trigger where tgname='pickup_nfc_arrival'")).rows[0].n, 0);
    for (const role of ['anon','authenticated','service_role']) {
      const grants = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and (p.proname like 'pickup\\_%' escape '\\' or p.proname='club_pickup_available')
        and has_function_privilege($1,p.oid,'EXECUTE') order by p.proname`, [role])).rows.map(row=>row.proname);
      assert.deepEqual(grants, role==='authenticated' ? ['pickup_actor_role','pickup_manageable_venues'] : []);
      await asUser(role==='authenticated'?1:null,role);
      for (const table of ['pickup_requests','pickup_messages','pickup_events','pickup_consents','pickup_read_receipts','pickup_reports','pickup_arrival_evidence']) {
        await assert.rejects(db.query('select * from ' + table), error=>error.code==='42501');
      }
      await assert.rejects(db.query("select pickup_send_message($1,$2,'Blocked')",[id(20),id(30)]), error=>error.code==='42501');
      await assert.rejects(db.query('select pickup_guest_get($1,$2,null)',[id(20),'a'.repeat(64)]), error=>error.code==='42501');
      await db.exec('reset role');
    }
    for (const [user,expected] of [[3,1],[5,1],[7,2],[1,0],[6,0],[8,0]]) {
      await asUser(user); assert.equal((await db.query('select pickup_manageable_venues() v')).rows[0].v.length,expected);
    }
    await db.exec('reset role');
    await assert.rejects(db.query('update venues set club_pickup_enabled=true where id=$1',[id(10)]), error=>error.code==='42501');
  } finally { await db.close(); }
});
