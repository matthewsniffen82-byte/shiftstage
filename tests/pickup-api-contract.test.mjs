import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupDate,pickupPageOffset,pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { pickupId as id, pickupFixture } from './helpers/pickup-fixture.mjs';

test('pagination and filters reject malformed or unbounded requests',()=>{
  for(const value of ['-1','10001','1;select','NaN']) assert.throws(()=>pickupPageOffset(value),e=>e.status===400);
  assert.equal(pickupPageOffset('30'),30);
  assert.equal(pickupDate('2026-09-14'),'2026-09-14');
  assert.throws(()=>pickupDate('2026-02-31'),e=>e.status===400);
  assert.throws(()=>pickupUuid('not-an-id'),e=>e.status===400);
});
test('inbox queries return only authorized venues and unread counts even when supplied another request ID',async()=>{
  const {db,asUser}=await pickupFixture(['20260914190000_club_pickup_domain.sql','20260914191000_club_pickup_security_commands.sql','20260914192000_club_pickup_inbox_queries.sql']);
  try {
    await asUser(3); await db.query('select pickup_set_enabled($1,true)',[id(10)]);
    assert.equal((await db.query('select pickup_manageable_venues() v')).rows[0].v.length,1);
    await asUser(1); await db.query("select pickup_create_request($1,$2,'Synthetic lobby',2,'pickup-chat-v1')",[id(20),id(10)]);
    assert.equal((await db.query('select pickup_manageable_venues() v')).rows[0].v.length,0);
    assert.equal((await db.query('select * from pickup_unread_counts($1)',[[id(20)]])).rows[0].unread_count,1);
    await asUser(2); assert.equal((await db.query('select * from pickup_unread_counts($1)',[[id(20)]])).rows.length,0);
    await asUser(8); assert.equal((await db.query('select pickup_manageable_venues() v')).rows[0].v.length,0);
    await asUser(7); assert.equal((await db.query('select pickup_manageable_venues() v')).rows[0].v.length,2);
  } finally {await db.close();}
});
