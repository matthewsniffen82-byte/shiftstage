import assert from 'node:assert/strict';
import test from 'node:test';
import {dancerCheckInState as state} from '../src/lib/dancr/dancer-check-in-state.ts';

const now=Date.parse('2026-10-27T12:00:00Z');
const snapshot={enrollment:{status:'pending',tappedAt:'2026-10-27T10:00:00Z',expiresAt:'2026-11-03T10:00:00Z',venue:{id:'club'}},
  clubApprovals:[{status:'approved',venue:{id:'club'}}],profileAuthorization:{authorized:true,profileStatus:'approved'}};

test('another club cooldown does not obscure the new club media requirement',()=>{
 const pending={...snapshot,enrollment:{...snapshot.enrollment,checkInStatus:'media_pending'},presence:{nextTapAllowedAt:'2026-10-27T20:00:00Z',venue:{id:'other'}}};
 assert.equal(state(pending,now).stage,'media_pending');
 assert.equal(state({...pending,presence:{...pending.presence,venue:{id:'club'}}},now).stage,'cooldown');
});
test('a missing tap and affiliation alone never claim activation or Working Now',()=>{
  assert.equal(state({},now).stage,'no_tap');
  assert.equal(state({affiliations:[{status:'active'}]},now).stage,'access_pending');
  assert.equal(state({affiliations:[{status:'revoked'}]},now).stage,'access_pending');
});

test('completion receipts and partial objects cannot masquerade as saved taps',()=>{
  for(const enrollment of [{enrollmentStatus:'none',shiftCheckedIn:false},{enrollmentStatus:'pending'}, {},
    {status:'pending'}, {status:'pending',venue:{id:'club'},tappedAt:'invalid'}]) {
    const result=state({enrollment,clubApprovals:[],affiliations:[]},now);
    assert.equal(result.stage,'no_tap');assert.doesNotMatch(result.description,/tap is saved|needs to review/);
  }
  assert.doesNotMatch(state({clubApprovals:[{status:'pending',venue:{id:'club'}}]},now).description,/tap is saved/);
});
test('club and media approval have distinct pending stages',()=>{
  assert.equal(state({...snapshot,clubApprovals:[{status:'pending',venue:{id:'club'}}]},now).stage,'club_pending');
  assert.equal(state({...snapshot,profileAuthorization:{authorized:false,profileStatus:'pending_review'}},now).stage,'media_pending');
  assert.equal(state({...snapshot,enrollment:{...snapshot.enrollment,checkInStatus:'media_pending'}},now).stage,'media_pending');
  assert.equal(state(snapshot,now).stage,'checking');
});

test('confirmed club access awaiting media is explicit even after the saved tap window ends',()=>{
  const pending={...snapshot,clubApprovals:[],affiliations:[{status:'active',venue:{id:'club'}}],
    profileAuthorization:{authorized:false,profileStatus:'pending_review'},
    enrollment:{...snapshot.enrollment,checkInStatus:'media_pending'}};
  for(const time of [now,now+7*3600_000]) {
    const result=state(pending,time);
    assert.equal(result.stage,'media_pending');
    assert.equal(result.title,'Club confirmed · Media approval pending');
    assert.equal(result.description,'Your club access is confirmed. Required media approval must finish before you can check in.');
    assert.doesNotMatch(result.description,/six hours|Working Now|tap again/);
  }
});
test('only a live shift reports Working Now; cooldown and expired taps require waiting or another tap',()=>{
  const presence={workingUntil:'2026-10-27T16:00:00Z',nextTapAllowedAt:'2026-10-27T22:00:00Z',venue:{id:'club',name:'Club'}};
  assert.equal(state({...snapshot,presence},now).stage,'working');
  assert.equal(state({...snapshot,presence:{...presence,workingUntil:null}},now).stage,'cooldown');
  assert.equal(state(snapshot,now+4*3600_000).stage,'ready');
  assert.equal(state({...snapshot,enrollment:{...snapshot.enrollment,status:'completed'}},now).stage,'ready');
});
test('declined, expired, removed and missing eligibility are explicit',()=>{
  assert.equal(state({...snapshot,clubApprovals:[{status:'rejected',venue:{id:'club'}}]},now).stage,'declined');
  assert.equal(state({...snapshot,clubApprovals:[],enrollment:{...snapshot.enrollment,status:'expired'}},now).stage,'new_tap');
  for(const [reason,stage] of [['access_removed','new_tap'],['tag_inactive','new_tap'],['age_pending','age_pending'],['agreement_pending','agreement_pending'],['profile_pending','profile_pending']]) {
    assert.equal(state({...snapshot,enrollment:{...snapshot.enrollment,checkInStatus:reason}},now).stage,stage);
  }
});
