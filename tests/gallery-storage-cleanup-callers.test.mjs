import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
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
  {exports,require:()=>dependencies,console:{warn(){},log(){},info(){},error(){}},Buffer,setTimeout,clearTimeout});
 return exports;
}
function harness(kind,outcome='retired'){
 const events=[],files=new Set([storagePath,storagePath+'.w320.webp','dancer-photos/'+storagePath]);
 const rows={
  dancer_profiles:[{id:profile,user_id:owner,avatar_storage_path:kind==='avatar'?storagePath:null,stage_name:'Synthetic',slug:'synthetic'}],
  dancer_photos:kind==='pending'?[]:[{id:photoId,dancer_id:profile,storage_path:storagePath,is_primary:true,sort_order:0,review_status:'approved'}],
  image_moderation_records:kind==='pending'||kind==='avatar'?[{id:reviewId,user_id:owner,final_storage_path:storagePath,temporary_storage_path:null,image_id:null,decision:'review',upload_context:kind==='avatar'?'profile_avatar':'profile_gallery:1'}]:[],
  subscriptions:[],approval_reviews:[],admin_actions:[],
 };
 const client={
  async rpc(name,args){
   events.push({kind:'rpc',name,args});assert.equal(name,'claim_gallery_storage_retirement');assert.equal(args.p_profile_id,profile);assert.equal(args.p_storage_path,storagePath);
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
    return {data:single?selected[0]??null:selected.map(r=>({...r})),error:null};
   }return q;
  },
  storage:{from(bucket){return {async list(){return {data:[],error:null};},async remove(paths){events.push({kind:'storage',bucket,paths:Array.from(paths)});for(const p of paths)files.delete(p);return {data:paths.map(name=>({name})),error:null};}};}},
 };
 const dependencies={PublicApiError,PROFILE_AVATAR_CONTEXT:'profile_avatar',ensureDancerPrimaryPhoto:async()=>null,
  safeErrorMetadata:()=>({code:'synthetic'}),...runtime.cleanup,...runtime.responsive,...runtime.watermark};
 const dancer=load('src/lib/dancr/dancer.ts',dependencies,'refreshOwnPhotoReviewStatus=async()=>{};');
 const administrator=load('src/lib/dancr/admin.ts',dependencies,'logAdminAction=async()=>{};');
 const run=()=>kind==='owner'||kind==='pending'?dancer.deleteOwnDancerPhoto(client,owner,kind==='pending'?reviewId:photoId,client)
  :kind==='avatar'?dancer.deleteOwnDancerAvatar(client,owner,client)
  :kind==='admin-photo'?administrator.deleteAdminDancerPhoto(client,{dancerId:profile,targetId:photoId,adminId:owner})
  :administrator.deleteAdminDancerProfile(client,{dancerId:profile,adminId:owner});
 return {run,events,files};
}
for(const kind of ['owner','pending','avatar','admin-photo','admin-profile'])for(const outcome of ['retired','retained','error','malformed'])test(kind+' cleanup uses the guarded boundary after metadata and handles '+outcome,async()=>{
 const h=harness(kind,outcome),result=await h.run();
 assert.equal(h.events.filter(e=>e.kind==='rpc').length,1);
 if(outcome==='retired'){
  assert.equal(h.events.filter(e=>e.kind==='storage').length,2);assert.equal(h.files.size,0);
 }else{
  assert.equal(h.events.filter(e=>e.kind==='storage').length,0);assert.equal(h.files.size,3);
  if(kind.startsWith('admin'))assert.ok(result.warnings.includes('Gallery file cleanup retained for review.'));
 }
});
