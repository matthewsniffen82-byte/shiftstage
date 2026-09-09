import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as markets from '../src/lib/dancr/markets.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
const source=readFileSync(new URL('../src/lib/dancr/admin.ts',import.meta.url),'utf8');
function fixture(city = 'Miami', isActive = false) {
  let saved; const exports={};
  const client={from(table){
    if(table==='admin_actions')return {insert:async()=>({error:null})};
    assert.equal(table,'venues');
    const q={update(row){saved=row;return q;},eq(){return q;},select(){return q;},single:async()=>({data:{id:'venue-1',name:'Harbor Club',slug:'harbor-club-existing',...saved},error:null})};return q;
  }};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,console,URL,require:name=>({
      './venue': {getVenueById:async()=>({id:'venue-1',isActive,city})},
      './markets': markets,
      '../api-error-policy': {PublicApiError},
    }[name] || {}),
  });
  return {save:input=>exports.updateAdminVenue(client,'admin-1','venue-1',input),transition:action=>exports.transitionAdminManagedVenuePage(client,'admin-1','venue-1',action),row:()=>saved};
}
test('a partial private page saves without coordinates or hours and stays a draft',async()=>{
 const f=fixture();const result=await f.save({name:'Harbor Club',city:'Miami',address:'123 Harbor St',state:'FL',phone:'503-555-0123',website:'www.example.com',latitude:'',longitude:'',opensAt:'',closesAt:''});
 assert.equal(f.row().latitude,null);assert.equal(f.row().longitude,null);
 assert.equal(f.row().opens_at,null);assert.equal(f.row().closes_at,null);
 assert.equal(f.row().page_review_status,'admin_draft');assert.equal(f.row().is_active,undefined);
 assert.equal(result.website,'https://www.example.com/');
 assert.equal(result.slug,'harbor-club-existing');assert.equal(f.row().slug,undefined);
});

test('venue setup accepts every available city and saves its canonical spelling',async()=>{
 const f=fixture();
 for(const city of markets.MYDANCR_AVAILABLE_CITIES) {
   await f.save({city:`  ${city.toLowerCase()}  `});
   assert.equal(f.row().city,city);
 }
});

test('unlisted, blank, and malformed cities cannot be saved or silently replaced',async()=>{
 for(const city of ['Portland','All cities','',null,42,{}]) {
   const f=fixture();
   await assert.rejects(f.save({city}),error=>{
     const response=resolveApiError(error,'Unable to update venue.');
     assert.equal(response.status,400);
     assert.equal(response.body.error,'Select an available city for this venue.');
     return true;
   });
   assert.equal(f.row(),undefined);
 }
});

test('admins can change a published venue city without changing its approval or public details',async()=>{
 const f=fixture('Miami',true);
 await f.save({city:'New York'});
 assert.deepEqual(Object.keys(f.row()),['city']);
 assert.equal(f.row().city,'New York');
 await assert.rejects(f.save({city:'Portland'}),/Select an available city/);
 assert.equal(f.row().city,'New York');
});

test('published page edits save all public fields while keeping the live status and existing URL',async()=>{
 const f=fixture('Miami',true);
 const result=await f.save({name:'Harbor After Dark',address:'456 Ocean Drive',city:'Miami',state:'FL',latitude:'25.7617',longitude:'-80.1918',phone:'305-555-0199',website:'harbor.example.com',timezone:'America/New_York',opensAt:'19:30',closesAt:'03:30'});
 const expected={name:'Harbor After Dark',address:'456 Ocean Drive',city:'Miami',state:'FL',latitude:25.7617,longitude:-80.1918,phone:'305-555-0199',website:'https://harbor.example.com/',timezone:'America/New_York',opens_at:'19:30',closes_at:'03:30'};
 assert.deepEqual({...f.row()},expected);
 assert.equal(result.slug,'harbor-club-existing');
 for(const key of ['is_active','published_at','page_review_status','page_reviewed_at','page_reviewed_by_user_id']) assert.equal(f.row()[key],undefined);
});

test('an existing unavailable city cannot bypass selection through approval or publishing',async()=>{
 for(const action of ['send_for_review','publish']) {
   const f=fixture('Portland');
   await assert.rejects(f.transition(action),/Select an available city/);
   assert.equal(f.row(),undefined);
 }
});
test('saving entered coordinates preserves zero and fine precision while rejecting invalid locations',async()=>{
 const f=fixture();await f.save({latitude:'0',longitude:'-122.1234567',opensAt:'04:32',closesAt:'22:32'});
 assert.equal(f.row().latitude,0);assert.equal(f.row().longitude,-122.1234567);
 assert.equal(f.row().opens_at,'04:32');assert.equal(f.row().closes_at,'22:32');
 for(const input of [{latitude:'91'},{longitude:'-181'},{latitude:'invalid'}]) await assert.rejects(f.save(input),/valid venue/);
});
test('a save error remains next to the draft button, and publication requirements remain separate',()=>{
 const ui=readFileSync(new URL('../app/admin/AdminClient.tsx',import.meta.url),'utf8');
 const form=ui.slice(ui.indexOf('className="venue-page-editor"'),ui.indexOf('</form>',ui.indexOf('className="venue-page-editor"')));
 assert.match(form,/onInvalidCapture/);assert.match(form,/validationMessage/);assert.match(ui,/className="venue-page-workflow-actions"[\s\S]*?statusByVenue\[venueId\]/);
 assert.match(ui,/form=\{`venue-page-editor-\$\{venueId\}`\}/);
 assert.match(ui,/Boolean\(commercialBusy \|\| commercialDirty \|\| unsavedByVenue\[venueId\]\)/);
 for(const field of ['latitude','longitude','opensAt','closesAt'])assert.doesNotMatch(form.match(new RegExp('<input name="'+field+'"[^>]*>'))?.[0]||'',/\brequired\b/);
 assert.match(source,/if \(!publication.isReady\)/);
});
