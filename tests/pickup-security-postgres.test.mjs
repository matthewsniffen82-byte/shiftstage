import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupFixture, pickupId as id } from './helpers/pickup-fixture.mjs';

const migrations = ['20260914190000_club_pickup_domain.sql','20260914191000_club_pickup_security_commands.sql'];
async function fixture() {
  const f = await pickupFixture(migrations);
  await f.asUser(3);
  await f.db.query('select pickup_set_enabled($1,true)',[id(10)]);
  await f.asUser(1);
  f.create = (request=20,venue=10,location='Synthetic hotel lobby') => f.db.query(
    "select pickup_create_request($1,$2,$3,2,'pickup-chat-v1') id",[id(request),id(venue),location]);
  f.consent = () => f.db.query("select pickup_accept_consent($1,'pickup-chat-v1')",[id(20)]);
  f.send = (message=30,text='Hello') => f.db.query('select pickup_send_message($1,$2,$3)',[id(20),id(message),text]);
  f.status = (next,previous,reason='') => f.db.query('select pickup_set_status($1,$2,$3,$4)',[id(20),next,previous,reason]);
  return f;
}

test('customer requests are authenticated, consented, opt-in and idempotent; active duplicates return the existing conversation',async()=>{
  const f=await fixture(); try {
    await assert.rejects(f.create(20,11),e=>e.code==='22023');
    assert.equal((await f.create()).rows[0].id,id(20));
    assert.equal((await f.create()).rows[0].id,id(20));
    assert.equal((await f.create(21)).rows[0].id,id(20));
    await assert.rejects(f.create(20,10,'Different location'),e=>e.code==='22023');
    const requests=(await f.db.query('select * from pickup_requests')).rows;
    assert.equal(requests.length,1); assert.equal(requests[0].customer_user_id,id(1));
    assert.equal((await f.db.query('select count(*)::int n from pickup_consents')).rows[0].n,1);
    for(const user of [3,6,7]) {await f.asUser(user); await assert.rejects(f.create(22),e=>e.code==='42501');}
    await f.asUser(null,'anon'); await assert.rejects(f.create(),e=>e.code==='42501');
  } finally {await f.db.close();}
});

test('RLS isolates customers, venues, staff and dancers, and rechecks active accounts and membership',async()=>{
  const f=await fixture(); try {
    await f.create();
    for(const user of [2,4,6,8]) {
      await f.asUser(user);
      for(const table of ['pickup_requests','pickup_messages','pickup_consents','pickup_arrival_evidence','pickup_events','pickup_reports'])
        assert.equal((await f.db.query(`select * from ${table}`)).rows.length,0,`${user} cannot read ${table}`);
      await assert.rejects(f.send(),e=>e.code==='42501');
      await assert.rejects(f.status('accepted','requested'),e=>e.code==='42501');
    }
    for(const user of [3,5]) {
      await f.asUser(user); assert.equal((await f.db.query('select * from pickup_requests')).rows.length,1);
      assert.equal((await f.db.query('select * from pickup_messages')).rows.length,0,'consent gates conversation');
      await f.consent(); assert.ok((await f.db.query('select * from pickup_messages')).rows.length);
    }
    await f.db.exec("reset role; update venue_team_members set status='removed'"); await f.asUser(5);
    assert.equal((await f.db.query('select * from pickup_requests')).rows.length,0);
    await f.db.exec(`reset role; update app_users set account_state='disabled' where id='${id(1)}'`); await f.asUser(1);
    assert.equal((await f.db.query('select * from pickup_requests')).rows.length,0);
    await f.asUser(7); assert.equal((await f.db.query('select * from pickup_requests')).rows.length,1);
    assert.ok((await f.db.query('select * from pickup_events')).rows.length);
    await assert.rejects(f.send(),e=>e.code==='42501');
  } finally {await f.db.close();}
});

test('all direct writes and internal RPCs are denied; senders and attribution cannot be spoofed',async()=>{
  const f=await fixture(); try {
    await f.create();
    for(const user of [1,3,7]) {
      await f.asUser(user);
      await assert.rejects(f.db.query("update pickup_requests set status='completed',referral_outcome='arrival_verified'"),e=>e.code==='42501');
      await assert.rejects(f.db.query("insert into pickup_messages(pickup_request_id,sender_user_id,sender_type,message_text) values($1,$2,'venue','spoof')",[id(20),id(3)]),e=>e.code==='42501');
      await assert.rejects(f.db.query('delete from pickup_events'),e=>e.code==='42501');
      await assert.rejects(f.db.query("select pickup_record_event($1,'arrival_verified',$2,'{}')",[id(20),id(1)]),e=>e.code==='42501');
    }
    await f.asUser(1); await f.send(); await f.send();
    await assert.rejects(f.send(30,'Different'),e=>e.code==='22023');
    await f.asUser(3); await assert.rejects(f.send(31),e=>e.code==='42501');
    await f.consent(); await f.consent(); await f.send(31,'Venue response');
    const messages=(await f.db.query("select sender_type,sender_user_id from pickup_messages where sender_type<>'system' order by sequence")).rows;
    assert.deepEqual(messages,[{sender_type:'customer',sender_user_id:id(1)},{sender_type:'venue',sender_user_id:id(3)}]);
    await f.db.exec('reset role');
    const notices=(await f.db.query('select body,payload from notifications')).rows;
    assert.ok(notices.length); assert.ok(notices.every(n=>!JSON.stringify(n).includes('Synthetic hotel lobby')&&!JSON.stringify(n).includes('Venue response')));
  } finally {await f.db.close();}
});

test('state machine is atomic, rejects stale transitions, preserves audit and distinguishes reported arrivals',async()=>{
  const f=await fixture(); try {
    await f.create();
    await assert.rejects(f.status('accepted','requested'),e=>e.code==='42501');
    await assert.rejects(f.status('arrived','requested'),e=>e.code==='42501');
    await f.asUser(3); await f.consent();
    await assert.rejects(f.status('completed','requested'),e=>e.code==='42501');
    await f.status('accepted','requested');
    await assert.rejects(f.status('vehicle_dispatched','requested'),e=>e.code==='40001');
    await f.status('vehicle_dispatched','accepted');
    assert.equal((await f.db.query('select arrived_at from pickup_requests')).rows[0].arrived_at,null);
    await f.status('arriving','vehicle_dispatched');
    await f.asUser(1); await f.status('arrived','arriving');
    await f.asUser(3); await f.status('completed','arrived');
    assert.equal((await f.db.query('select referral_outcome from pickup_requests')).rows[0].referral_outcome,'completed_unverified');
    assert.equal((await f.db.query('select source from pickup_arrival_evidence')).rows[0].source,'customer_confirmation');
    await assert.rejects(f.send(),e=>e.code==='22023');
    await f.asUser(7);
    const events=(await f.db.query('select event_type from pickup_events')).rows.map(r=>r.event_type);
    for(const event of ['request_created','venue_accepted','vehicle_dispatched','arrival_confirmed','completed']) assert.ok(events.includes(event));
    await f.db.query("select pickup_admin_note($1,'Reviewed customer dispute')",[id(20)]);
    await assert.rejects(f.db.exec("update pickup_events set metadata='{}'"),e=>e.code==='42501');
  } finally {await f.db.close();}
});

test('cancellation, disabling pickup, expiry, reports and message limits have safe retry behavior',async()=>{
  const f=await fixture(); try {
    await f.create();
    await f.asUser(3); await f.consent(); await f.db.query('select pickup_set_enabled($1,false)',[id(10)]);
    await f.send(31,'Existing request remains open');
    await f.asUser(1);
    for(let n=0;n<12;n++) await f.send(40+n,'Synthetic message '+n);
    await assert.rejects(f.send(60),e=>e.code==='P0001');
    await f.db.query('select pickup_mark_read($1,999999)',[id(20)]);
    assert.ok((await f.db.query('select last_read_sequence from pickup_read_receipts')).rows[0].last_read_sequence<999999);
    for(let n=0;n<2;n++) await f.db.query("select pickup_report_conversation($1,'harassment','Synthetic report')",[id(20)]);
    assert.equal((await f.db.query('select * from pickup_reports')).rows.length,1);
    await f.status('cancelled','requested','Plans changed');
    await f.status('cancelled','requested','Plans changed');
    await assert.rejects(f.create(22),e=>e.code==='22023');
    await f.asUser(3); await f.db.query('select pickup_set_enabled($1,true)',[id(10)]);
    await f.asUser(1); await f.create(22);
    await f.db.exec(`reset role; update pickup_requests set requested_at=now()-interval '13 hours',expires_at=now()-interval '1 hour' where id='${id(22)}'`);
    await f.asUser(1); await f.db.query('select pickup_expire_requests()');
    assert.equal((await f.db.query('select status from pickup_requests where id=$1',[id(22)])).rows[0].status,'expired');
    assert.equal((await f.create(23)).rows[0].id,id(23));
  } finally {await f.db.close();}
});
