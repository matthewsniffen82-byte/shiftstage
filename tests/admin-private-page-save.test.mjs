import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/dancr/admin.ts',import.meta.url),'utf8');
function fixture() {
  let saved; const exports={};
  const client={from(table){
    if(table==='admin_actions')return {insert:async()=>({error:null})};
    assert.equal(table,'venues');
    const q={update(row){saved=row;return q;},eq(){return q;},select(){return q;},single:async()=>({data:{id:'venue-1',name:'Harbor Club',slug:'harbor-club-existing',...saved},error:null})};return q;
  }};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,console,URL,require:name=>name==='./venue'?{getVenueById:async()=>({id:'venue-1',isActive:false})}:{},
  });
  return {save:input=>exports.updateAdminVenue(client,'admin-1','venue-1',input),row:()=>saved};
}
test('a partial private page saves without coordinates or hours and stays a draft',async()=>{
 const f=fixture();const result=await f.save({name:'Harbor Club',city:'Portland',address:'123 Harbor St',state:'OR',phone:'503-555-0123',website:'www.example.com',latitude:'',longitude:'',opensAt:'',closesAt:''});
 assert.equal(f.row().latitude,null);assert.equal(f.row().longitude,null);
 assert.equal(f.row().opens_at,null);assert.equal(f.row().closes_at,null);
 assert.equal(f.row().page_review_status,'admin_draft');assert.equal(f.row().is_active,undefined);
 assert.equal(result.website,'https://www.example.com/');
 assert.equal(result.slug,'harbor-club-existing');assert.equal(f.row().slug,undefined);
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
 assert.match(ui,/Boolean\(unsavedByVenue\[venueId\]\)/);
 for(const field of ['latitude','longitude','opensAt','closesAt'])assert.doesNotMatch(form.match(new RegExp('<input name="'+field+'"[^>]*>'))?.[0]||'',/\brequired\b/);
 assert.match(source,/if \(!publication.isReady\)/);
});
