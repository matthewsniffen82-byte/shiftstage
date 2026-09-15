import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupFixture,pickupId as id } from './helpers/pickup-fixture.mjs';
const migrations=['20260914190000_club_pickup_domain.sql','20260914191000_club_pickup_security_commands.sql','20260914194000_club_pickup_arrival_attribution.sql'];
async function fixture(){
  const f=await pickupFixture(migrations);
  await f.asUser(3);await f.db.query('select pickup_set_enabled($1,true)',[id(10)]);
  await f.asUser(1);await f.db.query("select pickup_create_request($1,$2,'Synthetic lobby',2,'pickup-chat-v1')",[id(20),id(10)]);
  await f.asUser(3);await f.db.query("select pickup_accept_consent($1,'pickup-chat-v1')",[id(20)]);
  f.accept=()=>f.db.query("select pickup_set_status($1,'accepted','requested')",[id(20)]);
  f.redeem=async({n=50,customer=1,venue=10,nfc=true,status='redeemed',suspicious=false,confirmed=true}={})=>{
    await f.db.exec('reset role');
    return f.db.query('insert into qr_redemptions(id,customer_id,venue_id,status,redeemed_at,nfc_tag_id,confirmed_at,suspicious,club_deal_id) values($1,$2,$3,$4,now(),$5,$6,$7,$8)',
      [id(n),customer?id(customer):null,id(venue),status,nfc?id(80):null,confirmed?new Date().toISOString():null,suspicious,id(90)]);
  };
  return f;
}
test('trusted NFC redemption links one accepted customer referral without creating charges and retains reversal history',async()=>{
  const f=await fixture();try{
    await f.accept();await f.redeem();
    let r=(await f.db.query('select * from pickup_requests')).rows[0];assert.equal(r.status,'arrived');assert.equal(r.referral_outcome,'arrival_verified');assert.ok(r.arrived_at);
    assert.equal((await f.db.query('select redemption_id from pickup_arrival_evidence')).rows[0].redemption_id,id(50));
    await f.db.exec("update qr_redemptions set status='redeemed'");
    assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,1);
    await f.db.exec("update qr_redemptions set status='voided',voided_at=now()");
    r=(await f.db.query('select * from pickup_requests')).rows[0];assert.equal(r.referral_outcome,'arrival_disputed');
    assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,1,'historical evidence retained');
    assert.equal((await f.db.query("select count(*)::int n from pickup_events where event_type='arrival_verified'")).rows[0].n,1);
    assert.equal((await f.db.query('select count(*)::int n from qr_redemptions')).rows[0].n,1,'never creates another redemption');
  }finally{await f.db.close();}
});
test('anonymous, wrong-venue, wrong-customer, unaccepted, suspicious or unconfirmed signals do not verify arrival',async()=>{
  const f=await fixture();try{
    await f.redeem();await f.asUser(3);await f.accept();
    for(const [index,options] of [{customer:null},{customer:2},{venue:11},{nfc:false},{suspicious:true},{confirmed:false},{status:'generated'}].entries())await f.redeem({...options,n:51+index});
    assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,0);
    assert.equal((await f.db.query('select referral_outcome from pickup_requests')).rows[0].referral_outcome,'pending');
  }finally{await f.db.close();}
});
test('manual confirmations remain reported evidence; both participants can confirm, outsiders cannot',async()=>{
  const f=await fixture();try{
    await f.accept();await f.asUser(1);await f.db.query('select pickup_confirm_arrival($1)',[id(20)]);
    await f.asUser(3);await f.db.query('select pickup_confirm_arrival($1)',[id(20)]);await f.db.query('select pickup_confirm_arrival($1)',[id(20)]);
    assert.equal((await f.db.query('select referral_outcome from pickup_requests')).rows[0].referral_outcome,'arrival_reported');
    assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,2);
    await f.asUser(2);await assert.rejects(f.db.query('select pickup_confirm_arrival($1)',[id(20)]),e=>e.code==='42501');
    await f.asUser(7);await assert.rejects(f.db.query('select pickup_confirm_arrival($1)',[id(20)]),e=>e.code==='42501');
  }finally{await f.db.close();}
});
test('cancelled, no-show and ambiguous historical requests never receive automatic arrival attribution',async()=>{
  const f=await fixture();try{
    await f.accept();await f.db.query("select pickup_set_status($1,'cancelled','accepted','Venue unavailable')",[id(20)]);
    await f.redeem();assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,0);
    await f.db.query("update pickup_requests set status='completed'");
    await f.db.query("insert into pickup_requests(id,customer_user_id,venue_id,party_size,pickup_location_text,status,accepted_at) values($1,$2,$3,2,'Second synthetic lobby','accepted',now())",[id(21),id(1),id(10)]);
    await f.redeem({n:51});assert.equal((await f.db.query('select count(*)::int n from pickup_arrival_evidence')).rows[0].n,0);
  }finally{await f.db.close();}
});
