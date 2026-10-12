import assert from 'node:assert/strict';
import test from 'node:test';
import { customerNightSummary, chooseDiscoveryCity } from '../src/lib/dancr/customer-night.ts';
const now=Date.parse('2026-10-12T03:00:00Z');
const plan=(id,venue='a',start='2026-10-12T02:00:00Z',end='2026-10-12T05:00:00Z')=>({shiftId:id,shift:{id,status:'posted',startsAt:start,endsAt:end,timezone:'America/Los_Angeles',venue:{id:venue,name:venue},dancer:{id,stageName:id}}});
const pass=(id,venue='a',expires='2026-10-12T06:00:00Z')=>({id,status:'generated',generatedAt:'2026-10-12T01:00:00Z',expiresAt:expires,venue:{id:venue},redemptionToken:id});
test('prioritizes an active pass and groups only overlapping plans for its venue and local date',()=>{
  const result=customerNightSummary({goingSignals:[plan('a'),plan('b'),plan('other','b'),plan('future','a','2026-10-13T02:00:00Z','2026-10-13T05:00:00Z')],dealRedemptions:[pass('later','b','2026-10-12T07:00:00Z'),pass('first')]},now);
  assert.equal(result.outing.pass.id,'first');
  assert.deepEqual(result.outing.plans.map(p=>p.shiftId),['a','b']);
  assert.equal(result.outing.date,'Sunday, Oct 11, 2026');
});
test('a pass never borrows another clubs dancers or an unrelated visit date',()=>{
  const result=customerNightSummary({goingSignals:[plan('other','b')],dealRedemptions:[pass('first')]},now);
  assert.equal(result.outing.date,null);assert.equal(result.outing.plans.length,0);assert.equal(result.outing.venue.id,'a');
});
test('expired, redeemed, voided passes and ended or cancelled shifts cannot lead the dashboard',()=>{
  const result=customerNightSummary({dealRedemptions:[pass('expired','a','2026-10-12T02:00:00Z'),{...pass('used'),status:'redeemed'},{...pass('void'),status:'voided'}],goingSignals:[plan('ended','a','2026-10-12T01:00:00Z','2026-10-12T02:00:00Z'),{...plan('cancelled'),shift:{...plan('cancelled').shift,status:'cancelled'}}]},now);
  assert.equal(result.outing,null);assert.equal(result.plans.length,0);assert.equal(result.passes.length,0);
});
test('without a pass, the soonest remaining plan leads and other dates stay separate',()=>{
  const result=customerNightSummary({goingSignals:[plan('later','b','2026-10-13T02:00:00Z','2026-10-13T05:00:00Z'),plan('next')]},now);
  assert.equal(result.outing.pass,null);assert.equal(result.outing.venue.id,'a');assert.equal(result.outing.plans.length,1);
});
test('city memory respects current available cities and falls back if a saved city disappears',()=>{
  assert.equal(chooseDiscoveryCity(['Las Vegas','Miami'],'Miami'),'Miami');
  assert.equal(chooseDiscoveryCity(['Las Vegas','Miami'],'missing'),'Las Vegas');
  assert.equal(chooseDiscoveryCity(['Miami'],'missing'),'Miami');
  assert.equal(chooseDiscoveryCity([],null),'Las Vegas');
});
