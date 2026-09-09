import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';

const source=readFileSync(new URL('../app/api/dancer/profile/route.ts',import.meta.url),'utf8');
const ownedPath='owner/profile/photo one.jpg';
const publicUrl='https://storage.example.test/storage/v1/object/public/dancer-photos/owner/profile/photo%20one.jpg';
function library(dependencies={},overrides=''){
 const exports={};
 vm.runInNewContext(ts.transpileModule(source+'\nexports.validateSnapshot=validateProfilePhotoSnapshot;\n'+overrides,{
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{
   exports,URL,console:{log(){},warn(){},error(){}},
   require:()=>({PublicApiError,MAX_DANCER_PROFILE_PHOTOS:50,...dependencies}),
 });
 return exports;
}
function database(rows=[{dancer_id:'profile',storage_path:ownedPath,is_primary:true,sort_order:0,is_pinned:true,review_status:'approved'}],error=null){
 const reads=[],writes=[];
 return {rows,reads,writes,client:{from(table){
   assert.equal(table,'dancer_photos');
   const filters=[];reads.push(table);
   const q={select(){return q;},eq(key,value){filters.push(row=>row[key]===value);return q;},
     insert(){writes.push('insert');assert.fail('Snapshot must not insert');},
     update(){writes.push('update');assert.fail('Snapshot must not update');},
     delete(){writes.push('delete');assert.fail('Snapshot must not delete');},
     then(resolve,reject){return Promise.resolve({data:rows.filter(row=>filters.every(f=>f(row))),error}).then(resolve,reject);},
   };return q;
 }}};
}
test('current profile requests with no URL snapshots make no photo query or mutation',async()=>{
 for(const body of [{stageName:'Dancer',city:'City',socials:[]},{submitForReview:true},{deletedPhotoIds:['old']},{mainPhotoUrl:'',galleryPhotoUrls:[]}]){
  const db=database();await library().validateSnapshot(db.client,'profile',body);
  assert.deepEqual(db.reads,[]);assert.deepEqual(db.writes,[]);
 }
});
for(const [label,value] of [['raw path',ownedPath],['public URL',publicUrl],['leading slash','/'+ownedPath]]){
 test('known '+label+' is compatible without changing photo state',async()=>{
  const db=database(),before=structuredClone(db.rows);
  await library().validateSnapshot(db.client,'profile',{mainPhotoUrl:value,galleryPhotoUrls:[value,value]});
  assert.deepEqual(db.rows,before);assert.deepEqual(db.writes,[]);
 });
}
test('existing legacy external media remains readable without creating or reordering rows',async()=>{
 const path='https://legacy.example.test/photo.jpg';
 const db=database([{dancer_id:'profile',storage_path:path,sort_order:0,is_primary:false}]);
 await library().validateSnapshot(db.client,'profile',{mainPhotoUrl:path});
 assert.deepEqual(db.writes,[]);
});
for(const [label,rows,value] of [
 ['unknown',[],ownedPath],
 ['foreign',[{dancer_id:'someone-else',storage_path:ownedPath}],publicUrl],
 ['new external URL',[], 'https://elsewhere.example.test/new.jpg'],
 ['deleted result',[],ownedPath],
]){
 test(label+' snapshot is rejected without writing any photo',async()=>{
  const db=database(rows);
  await assert.rejects(library().validateSnapshot(db.client,'profile',{galleryPhotoUrls:[value]}),{status:409});
  assert.deepEqual(db.writes,[]);
 });
}
test('a snapshot accompanying explicit ID deletion is read-only before deletion runs',async()=>{
 const db=database();
 await library().validateSnapshot(db.client,'profile',{mainPhotoUrl:ownedPath,deletedPhotoIds:['photo-id']});
 assert.equal(db.rows.length,1);assert.deepEqual(db.writes,[]);
});
test('database read failure is preserved and cannot become a successful save',async()=>{
 const error={code:'08006',message:'synthetic unavailable'},db=database([],error);
 await assert.rejects(library().validateSnapshot(db.client,'profile',{mainPhotoUrl:ownedPath}),e=>e===error);
 assert.deepEqual(db.writes,[]);
});
test('PATCH rejects an unknown snapshot before social, profile or deletion writes',async()=>{
 const db=database([]),body={stageName:'Changed',socials:[{platform:'instagram',url:'example'}],deletedPhotoIds:['other'],mainPhotoUrl:ownedPath};
 const route=library({
   createRequestSupabaseContext:async(_request,options)=>{assert.equal(options.role,'dancer');return {client:{},user:{id:'owner'}};},
   readBoundedJsonObject:async()=>body,validateProfilePhotoDeletionInput:()=>{},
   createAdminSupabaseClient:()=>db.client,safeErrorMetadata:()=>({code:'synthetic'}),
   apiError:error=>new Response(JSON.stringify({ok:false,error:error.message}),{status:error.status}),
 },'loadProfileForSave=async()=>({profile:{id:"profile"},supportsIsPublic:true});');
 const response=await route.PATCH({});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/Refresh your profile/);
 assert.deepEqual(db.writes,[]);
});
test('profile saving has no URL-based photo writer or slot-inferred cleanup',()=>{
 assert.doesNotMatch(source,/saveProfilePhotoUrls|removeSupersededPendingPhotoRows|removeDuplicatePublicUrlPhotoRows/);
});

test('profile responses still present approved and pending photos without changing stored rows',()=>{
 const route=library({responsivePublicImage:(_client,_bucket,path)=>path?{imageUrl:'https://media.example.test/'+path}:null},'exports.withPhotoUrls=withPhotoUrls;');
 const profile={id:'profile',dancer_photos:[
  {id:'primary',storage_path:'owner/main.jpg',is_primary:true,sort_order:0,review_status:'approved'},
  {id:'extra',storage_path:'owner/extra.jpg',is_primary:false,sort_order:1,review_status:'pending'},
  {id:'rejected',storage_path:'owner/rejected.jpg',is_primary:false,sort_order:2,review_status:'rejected'},
 ]};
 const before=structuredClone(profile),result=route.withPhotoUrls({},profile);
 assert.deepEqual(Array.from(result.dancer_photos,photo=>photo.id),['primary','extra']);
 assert.match(result.dancer_photos[0].imageUrl,/owner\/main\.jpg$/);
 assert.deepEqual(profile,before);
});
