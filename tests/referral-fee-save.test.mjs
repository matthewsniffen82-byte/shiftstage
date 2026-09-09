import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const source = readFileSync(new URL('../src/lib/dancr/referral-fees.ts', import.meta.url), 'utf8');
const service = {};
let now = Date.parse('2026-09-09T12:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
  exports:service, Date:Clock, Error,
  require(name) {
    if (name === '../api-error-policy') return {PublicApiError};
    if (name === './venue-access') return {};
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const input = {venueId:'11111111-1111-4111-8111-111111111111',feeCents:2000,effectiveFrom:'now',agreementReference:'Signed agreement 123'};
function database(error = null) {
  const calls=[];
  return {calls, async rpc(name,args) { calls.push({name,args}); return {data:'term-1',error}; }, from() {
    return {select(){return this;},order(){return this;},async limit(){return {data:[],error:null};}};
  }};
}
test('immediate agreements use submission time even after a long club setup', async () => {
  const db=database();
  now += 45*60_000;
  const result=await service.setAdminVenueReferralFee(db,'admin-1',input);
  assert.equal(result.termId,'term-1');
  assert.equal(db.calls[0].args.p_effective_from,new Date(now).toISOString());
  assert.equal(db.calls[0].args.p_venue_id,input.venueId);
  assert.equal(db.calls[0].args.p_fee_cents,2000);
});
test('scheduled agreement dates remain exact and request approvals keep their identity', async () => {
  const db=database(); const effectiveFrom=new Date(now+86400_000).toISOString();
  const requestId='22222222-2222-4222-8222-222222222222';
  await service.setAdminVenueReferralFee(db,'admin-1',{...input,effectiveFrom,requestId});
  assert.equal(db.calls[0].args.p_effective_from,effectiveFrom);
  assert.equal(db.calls[0].args.p_request_id,requestId);
});
test('expired dates and invalid fee details explain the correction without writing', async () => {
  for (const [patch, message] of [
    [{effectiveFrom:new Date(now-6*60_000).toISOString()}, /Effective immediately/],
    [{effectiveFrom:'invalid'}, /Effective immediately/],
    [{effectiveFrom:new Date(now+6*365*86400_000).toISOString()}, /five years/],
    [{feeCents:0}, /between/],
    [{agreementReference:'AB'}, /at least 3/],
  ]) {
    const db=database();
    await assert.rejects(service.setAdminVenueReferralFee(db,'admin-1',{...input,...patch}),error => {
      const response=resolveApiError(error,'Unable to update the referral fee agreement.',400);
      assert.equal(response.status,400); assert.match(response.body.error,message); return true;
    });
    assert.equal(db.calls.length,0);
  }
});
test('unexpected database details remain private', async () => {
  const db=database(new Error('internal database detail'));
  await assert.rejects(service.setAdminVenueReferralFee(db,'admin-1',input),error=>{
    assert.equal(resolveApiError(error,'Unable to update the referral fee agreement.',400).body.error,'Unable to update the referral fee agreement.'); return true;
  });
});
