import assert from 'node:assert/strict';
import {loadAvatarGateway} from './helpers/avatar-publication-fixture.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
import * as serverJobs from '../src/lib/server-job.ts';
import {loadGalleryCleanupRuntime} from './helpers/gallery-cleanup-runtime.mjs';

const owner='94000000-0000-4000-8000-000000000001',profile='94000000-0000-4000-8000-000000000011';
const photoId='94000000-0000-4000-8000-000000000100',reviewId='94000000-0000-4000-8000-000000000500';
const storagePath=owner+'/'+profile+'/photo.r320.m800x900.f50x50.jpg';
const runtime=loadGalleryCleanupRuntime();
function load(relative,dependencies,suffix=''){
 const source=process.env.MYDANCR_GALLERY_CLEANUP_BASELINE==='1'
  ?execFileSync('git',['show','111ea6dab0c48d1744adad1f6e9a892cd68aad5f:'+relative],{encoding:'utf8',windowsHide:true})
  :readFileSync(new URL('../'+relative,import.meta.url),'utf8');
 const exports={};
 vm.runInNewContext(ts.transpileModule(source+'\n'+suffix,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:()=>({...serverJobs,...dependencies}),console:{warn(){},log(){},info(){},error(){}},Buffer,setTimeout,clearTimeout});
 return exports;
}
function harness(kind,outcome='retired'){
 const events=[],files=new Set([storagePath,storagePath+'.w320.webp','dancer-photos/'+storagePath]);
 const rows={
  dancer_profiles:[{id:profile,user_id:owner,avatar_storage_path:kind==='avatar'?storagePath:null,avatar_updated_at:'2026-09-10T12:00:00Z',stage_name:'Synthetic',slug:'synthetic'}],
  dancer_photos:kind==='pending'?[]:[{id:photoId,dancer_id:profile,storage_path:storagePath,is_primary:true,sort_order:0,review_status:'approved'}],
  image_moderation_records:kind==='pending'||kind==='avatar'?[{id:reviewId,user_id:owner,final_storage_path:storagePath,temporary_storage_path:null,image_id:null,decision:'review',upload_context:kind==='avatar'?'profile_avatar':'profile_gallery:1'}]:[],
  subscriptions:[],approval_reviews:[],admin_actions:[],
 };
 const client={
  async rpc(name,args){
   events.push({kind:'rpc',name,args});
   if(name==='clear_dancer_avatar_safely'){
    const deleted=rows.image_moderation_records.map(r=>({id:r.id,user_id:r.user_id,temporary_storage_path:r.temporary_storage_path,final_storage_path:r.final_storage_path}));
    const previous=rows.dancer_profiles[0].avatar_storage_path;
    rows.image_moderation_records=[];Object.assign(rows.dancer_profiles[0],{avatar_storage_path:null,avatar_updated_at:'2026-09-10T13:00:00Z'});
    events.push({kind:'write',table:'dancer_profiles',operation:'atomic-clear'});
    return {data:{profile:rows.dancer_profiles[0],deleted_records:deleted,previous_storage_path:previous},error:null};
   }
   assert.equal(name,'claim_gallery_storage_retirement');assert.equal(args.p_profile_id,profile);assert.equal(args.p_storage_path,storagePath);
   assert.ok(events.some(e=>e.kind==='write'),'metadata removal precedes retirement');
   if(kind==='avatar')assert.equal(rows.dancer_profiles[0].avatar_storage_path,null);
   else if(kind==='pending')assert.equal(rows.image_moderation_records.length,0);
   else assert.equal(rows.dancer_photos.length,0);
   if(outcome==='error')return {data:null,error:{code:'08006'}};
   if(outcome==='malformed')return {data:{status:'retired'},error:null};
   return {data:{profile_id:profile,storage_path:storagePath,status:outcome,...(outcome==='retained'?{reason:'referenced'}:{retirement_id:reviewId,retired_at:'2026-09-10T13:00:00Z'})},error:null};
  },
  from(table){
   assert.ok(Object.hasOwn(rows,table),'fixture includes '+table);let operation='select',value;const filters=[];
   const q={select(){return q;},delete(){operation='delete';return q;},update(v){operation='update';value=v;return q;},
    eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},is(k,v){filters.push(r=>r[k]===v);return q;},
    in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(){return q;},
    maybeSingle(){return execute(true);},then(resolve,reject){return execute(false).then(resolve,reject);}};
   async function execute(single){
    const selected=rows[table].filter(r=>filters.every(f=>f(r)));
    if(operation!=='select')events.push({kind:'write',table,operation});
    if(operation==='delete'){rows[table]=rows[table].filter(r=>!selected.includes(r));if(table==='dancer_profiles')rows.dancer_photos=[];}
    if(operation==='update')selected.forEach(r=>Object.assign(r,value));
    return {data:single?(selected[0]?{...selected[0]}:null):selected.map(r=>({...r})),error:null};
   }return q;
  },
  storage:{from(bucket){return {async list(){return {data:[],error:null};},async remove(paths){events.push({kind:'storage',bucket,paths:Array.from(paths)});for(const p of paths)files.delete(p);return {data:paths.map(name=>({name})),error:null};}};}},
 };
 const dependencies={PublicApiError,...loadAvatarGateway(),PROFILE_AVATAR_CONTEXT:'profile_avatar',ensureDancerPrimaryPhoto:async()=>null,
  safeErrorMetadata:()=>({code:'synthetic'}),...runtime.cleanup,...runtime.responsive,...runtime.watermark};
 const dancer=load('src/lib/dancr/dancer.ts',dependencies,'refreshOwnPhotoReviewStatus=async()=>{};');
 const administrator=load('src/lib/dancr/admin.ts',dependencies,'logAdminAction=async()=>{};');
 const run=(scheduleCleanup)=>kind==='owner'||kind==='pending'?dancer.deleteOwnDancerPhoto(client,owner,kind==='pending'?reviewId:photoId,client,scheduleCleanup)
  :kind==='avatar'?dancer.deleteOwnDancerAvatar(client,owner,client)
  :kind==='admin-photo'?administrator.deleteAdminDancerPhoto(client,{dancerId:profile,targetId:photoId,adminId:owner})
  :administrator.deleteAdminDancerProfile(client,{dancerId:profile,adminId:owner});
 return {run,events,files,rows};
}
for(const kind of ['owner','pending','avatar','admin-photo','admin-profile'])for(const outcome of ['retired','retained','error','malformed'])test(kind+' cleanup uses the guarded boundary after metadata and handles '+outcome,async()=>{
 const h=harness(kind,outcome),result=await h.run();
 assert.equal(h.events.filter(e=>e.kind==='rpc'&&e.name==='claim_gallery_storage_retirement').length,1);
 if(outcome==='retired'){
  assert.equal(h.events.filter(e=>e.kind==='storage').length,2);assert.equal(h.files.size,0);
 }else{
  assert.equal(h.events.filter(e=>e.kind==='storage').length,0);assert.equal(h.files.size,3);
  if(kind.startsWith('admin'))assert.ok(result.warnings.includes('Gallery file cleanup retained for review.'));
 }
});

for(const kind of ['owner','pending']) test(kind+' photo deletion confirms metadata before deferred file cleanup',async()=>{
 const h=harness(kind),jobs=[];
 const result=await h.run(job=>jobs.push(job));
 assert.ok(result.deletedIds.includes(kind==='owner'?photoId:reviewId));
 assert.equal(h.rows[kind==='owner'?'dancer_photos':'image_moderation_records'].length,0);
 assert.equal(jobs.length,1);
 assert.equal(h.events.filter(e=>e.kind==='storage'||e.kind==='rpc').length,0);
 assert.equal(h.files.size,3);
 await jobs[0]();
 assert.equal(h.files.size,0);
 assert.equal(h.events.filter(e=>e.kind==='rpc'&&e.name==='claim_gallery_storage_retirement').length,1);
});

test('photo DELETE registers deferred cleanup with the response lifetime',()=>{
 const route=readFileSync(new URL('../app/api/dancer/photos/route.ts',import.meta.url),'utf8');
 assert.match(route,/import \{ after, NextResponse \} from "next\/server"/);
 assert.match(route,/await deleteOwnDancerPhoto\(client, user.id, photoId, createAdminSupabaseClient\(\), after\)/);
});
