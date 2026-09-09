import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as presets from '../src/lib/dancr/club-deal-presets.ts';
import * as policy from '../src/lib/dancr/deal-policy.ts';

function compile(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] || {}, console });
  return exports;
}
const deals = compile('../src/lib/dancr/deals.ts');
const service = compile('../src/lib/dancr/venue-deal-actions.ts', {
  './club-deal-presets': presets,
  './deal-policy': policy,
  './deals': deals,
  './referral-fees': { getVenueReferralFeeState: async () => ({current:null}) },
});
const venueId = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';
const input = {venueId,dealTitle:presets.CLUB_DEAL_OFFER_PRESETS[0].title,dealDescription:'Half-price admission before 10 PM on Fridays. Present this pass at the entrance.',isActive:false,offerType:'admission'};
function database() {
  let row = null;
  let writes = 0;
  return { get writes() { return writes; }, from(table) {
    const query = {
      select(){ return this; }, eq(){return this;},gt(){return this;},order(){return this;},
      async maybeSingle(){return {data: table === 'venues' ? {id:venueId,name:'Club B'} : row,error:null};},
      insert(value){writes++;row={...value,id:dealId};return this;},
      update(value){writes++;row={...row,...value};return this;},
      async single(){return {data:row,error:null};},
      async limit(){return {data:row?[row]:[],error:null};},
      async range(){return {data:[],error:null};},
    }; return query;
  }};
}
test('admin offer wording survives create, update, and a fresh catalog read', async () => {
  const db = database();
  const created = await service.upsertAdminVenueDeal(db,input);
  assert.equal(created.deal.dealDescription,input.dealDescription);
  const edited = 'Use the east entrance. Half-price general admission until 9 PM.';
  await service.upsertAdminVenueDeal(db,{...input,dealId,dealDescription:edited});
  assert.equal((await service.getAdminVenueDealCatalog(db))[0].dealDescription,edited);
  assert.equal(db.writes,2);
});
test('older callers without public details still receive the selected offer default', async () => {
  const result = await service.upsertAdminVenueDeal(database(),{...input,dealDescription:''});
  assert.equal(result.deal.dealDescription,presets.CLUB_DEAL_OFFER_PRESETS[0].description);
});
test('custom public wording retains length, plain text, and existing deal policy checks', async () => {
  for (const [dealDescription,pattern] of [
    ['x'.repeat(1201), /1200 characters/],
    ['<script>bad</script>', /unsupported characters/],
    ['Free beer with admission', /cannot include alcohol/],
  ]) {
    const db=database();
    await assert.rejects(service.upsertAdminVenueDeal(db,{...input,dealDescription}),pattern);
    assert.equal(db.writes,0);
  }
});

