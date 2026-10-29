import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/lib/dancr/venue-roster-photos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({failedBatch=-1,missing=false}={}){
 const calls=[],signed=[],warnings=[],exports={};
 const client = { storage: { from(bucket) {
   assert.equal(bucket, 'dancer-photos');
   return { async createSignedUrls(paths, ttl) {
     signed.push({ paths: Array.from(paths), ttl });
     return { data: [...paths].reverse().map(path => ({ path, signedUrl: missing ? '' : `signed:${path}`, error: missing ? 'Unavailable' : null })) };
   } };
 } } };
 vm.runInNewContext(code,{exports,console:{warn:(...args)=>warnings.push(args)},require(name){
   if(name==='./internal-main-photo')return {internalMainPhotos:async(actual,ids,venueId)=>{
     assert.equal(actual,client);calls.push({ids:Array.from(ids),venueId});
     if(calls.length===failedBatch)throw new Error('private storage details');
     return new Map(ids.filter(id=>id!=='no-approved-main').map(id=>[id,{id:`photo-${id}`,storage_path:`full/${id}.jpg`}]));
   }};
   if(name==='../security/safe-error-metadata')return {safeErrorMetadata:()=>({name:'Error'})};
   assert.equal(name,'server-only');return {};
 }});
 return {calls,signed,warnings,load:ids=>exports.venueRosterMainPhotos(client,'authorized-club',ids)};
}
test('roster signs only the selected club photos and maps URLs by path',async()=>{
 const f=fixture(),result=await f.load(['one','two','one','no-approved-main','']);
 assert.deepEqual(f.calls,[{ids:['one','two','no-approved-main'],venueId:'authorized-club'}]);
 assert.deepEqual(f.signed,[{paths:['full/one.jpg','full/two.jpg'],ttl:300}]);
 assert.equal(result.get('one'),'signed:full/one.jpg');assert.equal(result.get('two'),'signed:full/two.jpg');
 assert.equal(result.has('no-approved-main'),false);
});
test('empty rosters and missing signed files do not manufacture photo URLs',async()=>{
 const empty=fixture();assert.equal((await empty.load([])).size,0);assert.equal(empty.calls.length,0);
 assert.equal((await fixture({missing:true}).load(['one'])).size,0);
});
test('large rosters use bounded batches and recover after a photo batch fails',async()=>{
 const f=fixture({failedBatch:2});const result=await f.load(Array.from({length:53},(_,i)=>String(i)));
 assert.deepEqual(f.calls.map(call=>call.ids.length),[24,24,5]);assert.equal(result.size,29);
 assert.equal(result.get('52'),'signed:full/52.jpg');assert.equal(f.warnings.length,1);
 assert.doesNotMatch(JSON.stringify(f.warnings),/private storage details/);
});

test('working-now payloads carry full club photos independently of avatar crops',async()=>{
 const source=readFileSync('src/lib/dancr/venue.ts','utf8');
 const functionSource=source.slice(source.indexOf('async function getWorkingDancers('),source.indexOf('\nfunction venueAnalyticsRange('));
 const module=ts.transpileModule(functionSource+'\nexports.load = getWorkingDancers;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const scopes=[],calls=[],exports={};
 const rows=[{id:'active',live:true,dancer_profiles:{id:'kelly',avatar_storage_path:'avatar-crop'}},{id:'expired',live:false,dancer_profiles:{id:'former'}}];
 const query={select(){return this},eq(column,value){scopes.push([column,value]);return this},not(){return this},is(){return this},gt(){return this},order(){return Promise.resolve({data:rows})}};
 const client={from:table=>{assert.equal(table,'shifts');return query}};
 vm.runInNewContext(module,{exports,isActiveNfcPresence:row=>row.live,
   responsivePublicImage:()=>({imageUrl:'/avatar-crop.jpg',imageSrcSet:'/avatar-320.jpg 320w'}),
   venueRosterMainPhotos:async(actual,venueId,ids)=>{assert.equal(actual,client);calls.push({venueId,ids:Array.from(ids)});return new Map([['kelly','/full-main.jpg']])},
 });
 const result=await exports.load(client,'authorized-club',new Date());
 assert.ok(scopes.some(([column,value])=>column==='venue_id'&&value==='authorized-club'));
 assert.deepEqual(calls,[{venueId:'authorized-club',ids:['kelly']}]);
 assert.equal(result.length,1);assert.equal(result[0].mainPhotoUrl,'/full-main.jpg');assert.equal(result[0].avatarUrl,'/avatar-crop.jpg');
});
