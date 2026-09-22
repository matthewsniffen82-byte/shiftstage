import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOndatoDecision, isAdultDateOfBirth, verifyOndatoPayload } from '../src/lib/dancr/ondato-policy.ts';
import { ondatoHostedUrl } from '../src/lib/dancr/ondato-url.ts';
import { ids, identity, identification, signature } from './helpers/ondato-fixture.mjs';
const now = new Date('2026-09-22T12:00:00Z');

test('only adult government ID with completed face match and liveness grants approval', () => {
  assert.equal(evaluateOndatoDecision(identity(), identification(), ids, now), 'verified');
  for (const patch of [{ status: 'Awaiting' }, { status: 'Rejected' }, { document: null },
    { document: { type: 'ProofOfAddress', dateOfBirth: '1990-01-01' } },
    { document: { type: 'Passport', dateOfBirth: '2010-01-01', age: 99 } },
    { completedUtc: null }, { completedUtc: '2099-01-01' }, { rules: [] }, { face: { ageEstimation: 30 }, document: {} }]) {
    assert.notEqual(evaluateOndatoDecision(identity(), { ...identification(), ...patch }, ids, now), 'verified');
  }
  for (let index=0; index<4; index++) for (const status of ['Fail','Unavailable']) {
    const kyc = identification(); kyc.rules[index].status=status;
    assert.notEqual(evaluateOndatoDecision(identity(), kyc, ids, now), 'verified');
  }
  assert.notEqual(evaluateOndatoDecision({ ...identity(), status:'InProgress' }, identification(), ids, now),'verified');
  assert.notEqual(evaluateOndatoDecision({ ...identity(), step:{kycIdentification:{id:ids.kycId,isSuccess:false}} }, identification(), ids, now),'verified');
});

test('account, project, setup, session and KYC identity must all match', () => {
  for(const patch of [{id:ids.kycId},{applicationId:ids.kycId},{externalReferenceId:ids.kycId},{setup:{id:ids.kycId}}]) {
    assert.throws(()=>evaluateOndatoDecision({...identity(),...patch},identification(),ids,now),/MISMATCH/);
  }
  for(const patch of [{id:ids.sessionId},{identityVerificationId:ids.kycId},{applicationId:ids.kycId},{externalReferenceId:ids.kycId}]) {
    assert.throws(()=>evaluateOndatoDecision(identity(),{...identification(),...patch},ids,now),/MISMATCH/);
  }
});

test('incomplete, expired and rejected sessions never approve',()=>{
  for(const status of ['Expired','Aborted']) assert.equal(evaluateOndatoDecision({...identity(),status},null,ids,now),'expired');
  for(const status of ['Pending','InProgress']) assert.equal(evaluateOndatoDecision({...identity(),status,step:{}},null,ids,now),'pending');
  assert.equal(evaluateOndatoDecision({...identity(),status:'Suspended',step:{}},null,ids,now),'in_review');
  assert.equal(evaluateOndatoDecision(identity(),{...identification(),status:'Rejected'},ids,now),'declined');
});

test('birthday boundary, leap days, malformed and future dates are handled conservatively',()=>{
  assert.equal(isAdultDateOfBirth('2008-09-22',now),true);
  for(const value of ['2008-09-23','2008-02-30','2027-01-01','1900-01-01','18',null]) assert.equal(isAdultDateOfBirth(value,now),false);
  assert.equal(isAdultDateOfBirth('2008-02-29',new Date('2026-02-28T23:59:59Z')),false);
  assert.equal(isAdultDateOfBirth('2008-02-29',new Date('2026-03-01T00:00:00Z')),true);
});

test('redirects accept only the live Ondato host and one session ID',()=>{
  const url=`https://idv.ondato.com/?id=${ids.sessionId}`;
  assert.equal(ondatoHostedUrl(url),url);
  for(const bad of [url.replace('idv.','sandbox-idv.'),url.replace('ondato.com','ondato.com.evil.test'),url.replace('https:','http:'),
    url.replace('idv.','user@idv.'),url+'&redirect=https://evil.test',url+'&id='+ids.kycId,url+'#x','https://idv.ondato.com/?id=bad',null]) {
    assert.equal(ondatoHostedUrl(bad),null);
  }
});

test('Ondato timestamp/raw-body HMAC rejects altered, stale, unsigned and cross-project events',()=>{
  const config={webhookSecret:'synthetic-secret',applicationId:ids.applicationId};
  const raw=JSON.stringify({id:ids.kycId,applicationId:ids.applicationId,payload:{text:'raw \\u0027'}});
  const headers=new Headers({'Ondato-Signature':signature(raw,config.webhookSecret,now.getTime()/1000)});
  assert.equal(verifyOndatoPayload(raw,headers,config,now.getTime()).id,ids.kycId);
  assert.equal(verifyOndatoPayload(raw+' ',headers,config,now.getTime()),null);
  assert.equal(verifyOndatoPayload(raw,new Headers(),config,now.getTime()),null);
  assert.equal(verifyOndatoPayload(raw,headers,{...config,applicationId:ids.sessionId},now.getTime()),null);
  for(const offset of [-26*3600,600]) assert.equal(verifyOndatoPayload(raw,new Headers({'Ondato-Signature':signature(raw,config.webhookSecret,now.getTime()/1000+offset)}),config,now.getTime()),null);
  for(const raw of ['null','[]','{bad']) assert.equal(verifyOndatoPayload(raw,new Headers({'Ondato-Signature':signature(raw,config.webhookSecret)}),config),null);
});
