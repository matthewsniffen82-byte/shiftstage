import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupCommand,pickupCreateArgs,pickupDate,pickupPageOffset,pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { pickupStatusActions,pickupClosed,PICKUP_CONSENT_VERSION } from '../src/lib/dancr/pickup-domain.ts';
import { pickupId as id, pickupFixture } from './helpers/pickup-fixture.mjs';

test('pickup input accepts only allowed bounded fields and cannot forward spoofed identities or attribution',()=>{
  const input={requestId:id(20),venueId:id(10),location:' Synthetic lobby ',partySize:2,consentVersion:PICKUP_CONSENT_VERSION};
  assert.deepEqual(pickupCreateArgs(input),{p_id:id(20),p_venue_id:id(10),p_location:'Synthetic lobby',p_party_size:2,p_consent_version:PICKUP_CONSENT_VERSION,p_details:'',p_notes:''});
  for(const field of ['customer_user_id','sender_user_id','sender_type','referral_outcome','arrived_at'])
    assert.throws(()=>pickupCreateArgs({...input,[field]:id(99)}),e=>e.status===400);
  for(const partySize of [0,31,2.5,'2',null]) assert.throws(()=>pickupCreateArgs({...input,partySize}),e=>e.status===400);
  assert.throws(()=>pickupCreateArgs({...input,location:'x'.repeat(301)}),e=>e.status===400);
  assert.throws(()=>pickupCommand(id(20),{action:'message',messageId:id(30),text:'Hi',sender_type:'venue'}),e=>e.status===400);
  assert.equal(pickupCommand(id(20),{action:'message',messageId:id(30),text:' Hi '}).args.p_text,'Hi');
  assert.throws(()=>pickupCommand(id(20),{action:'message',messageId:id(30),text:' '}),e=>e.status===400);
  assert.throws(()=>pickupCommand(id(20),{action:'status',status:'__proto__',expectedStatus:'requested'}),e=>e.status===400);
  assert.throws(()=>pickupCommand(id(20),{action:'read',sequence:Infinity}),e=>e.status===400);
});
test('pagination and filters reject malformed or unbounded requests; UI exposes only role-appropriate actions',()=>{
  for(const value of ['-1','10001','1;select','NaN']) assert.throws(()=>pickupPageOffset(value),e=>e.status===400);
  assert.equal(pickupPageOffset('30'),30);
  assert.equal(pickupDate('2026-09-14'),'2026-09-14');
  assert.throws(()=>pickupDate('2026-02-31'),e=>e.status===400);
  assert.throws(()=>pickupUuid('not-an-id'),e=>e.status===400);
  assert.deepEqual(pickupStatusActions('customer','requested'),['cancelled']);
  assert.deepEqual(pickupStatusActions('venue','requested'),['accepted','cancelled']);
  assert.deepEqual(pickupStatusActions('admin','requested'),[]);
  for(const status of ['completed','cancelled','expired','no_show']) {assert.equal(pickupClosed(status),true);assert.deepEqual(pickupStatusActions('venue',status),[]);}
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
