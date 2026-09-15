import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupFixture, pickupId as id } from './helpers/pickup-fixture.mjs';

test('pickup domain is opt-in, private by default, indexed, and enforces foreign keys and status constraints', async () => {
  const {db,asUser} = await pickupFixture();
  try {
    assert.equal((await db.query('select bool_or(club_pickup_enabled) enabled from venues')).rows[0].enabled,false);
    const tables = (await db.query("select relname,relrowsecurity from pg_class where relname like 'pickup_%' and relkind='r'")).rows;
    assert.equal(tables.length,7); assert.ok(tables.every(t => t.relrowsecurity));
    for (const role of ['anon','authenticated','service_role']) {
      await asUser(1,role);
      for (const {relname} of tables) {
        await assert.rejects(db.query(`select * from ${relname}`),e=>e.code==='42501');
      }
    }
    await db.exec('reset role');
    const insert = (customer, status) => db.query('insert into pickup_requests(id,customer_user_id,venue_id,party_size,pickup_location_text,status) values($1,$2,$3,2,$4,$5)',[id(20),customer,id(10),'Synthetic hotel lobby',status]);
    await assert.rejects(insert(id(99),'requested'),e=>e.code==='23503');
    await assert.rejects(insert(id(1),'driver_assigned'),e=>e.code==='23514');
    await insert(id(1),'requested');
    await assert.rejects(db.query('insert into pickup_requests(customer_user_id,venue_id,party_size,pickup_location_text) values($1,$2,1,$3)',[id(1),id(10),'Lobby']),e=>e.code==='23505');
    assert.ok((await db.query("select indexname from pg_indexes where indexname='pickup_message_order'")).rows.length);
  } finally {await db.close();}
});

test('messages, consent and attribution history cannot be rewritten even by privileged direct SQL', async () => {
  const {db} = await pickupFixture();
  try {
    await db.query('insert into pickup_requests(id,customer_user_id,venue_id,party_size,pickup_location_text) values($1,$2,$3,2,$4)',[id(20),id(1),id(10),'Synthetic lobby']);
    await db.query("insert into pickup_events(pickup_request_id,event_type) values($1,'request_created')",[id(20)]);
    await db.query("insert into pickup_consents(pickup_request_id,user_id,consent_version) values($1,$2,'pickup-chat-v1')",[id(20),id(1)]);
    await db.query("insert into pickup_messages(pickup_request_id,sender_user_id,sender_type,message_text) values($1,$2,'customer','Hello')",[id(20),id(1)]);
    await assert.rejects(db.query("insert into pickup_messages(pickup_request_id,sender_user_id,sender_type,message_text) values($1,$2,'driver','Hi')",[id(20),id(1)]),e=>e.code==='23514');
    for (const table of ['pickup_events','pickup_consents','pickup_messages']) {
      await assert.rejects(db.exec(`delete from ${table}`),e=>e.code==='42501');
      await assert.rejects(db.exec(`truncate ${table}`),e=>e.code==='42501');
    }
    await assert.rejects(db.exec("update pickup_messages set message_text='Rewritten'"),e=>e.code==='42501');
  } finally {await db.close();}
});
