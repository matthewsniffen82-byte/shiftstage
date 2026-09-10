import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadGalleryGateway } from './helpers/gallery-publication-fixture.mjs';

const source=process.env.MYDANCR_PRIVATE_UPLOAD_BASELINE==='1'
  ?execFileSync('git',['show','c659ec3c8c0574ff2a536b7ef3fac784980623d1:src/lib/dancr/image-moderation.ts'],{encoding:'utf8',windowsHide:true})
  :readFileSync(new URL('../src/lib/dancr/image-moderation.ts',import.meta.url),'utf8');
const storageReceipt={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/storage-upload-receipt.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:storageReceipt,Error});
const version='2020-01-01T00:00:00Z';
function scenario({decision='review',concurrentDecision='',providerError=false,stateResponseLoss='',retry=false,uploadBucket='',uploadFailure='',receiptKind='valid'}={}) {
  const events=[],files=new Set(),record=retry?{
    id:'record',user_id:'owner',upload_context:'profile_gallery:1',temporary_storage_path:'owner/profile/temp.jpg',
    decision:'review',status:'moderating',updated_at:version,attempt_count:1,
  }:{};
  if(retry)files.add(record.temporary_storage_path);
  let writeFailed=false,rpcVersion;
  const transportError=Object.assign(new Error('synthetic state response lost'),{code:'08006'});
  const client={
    from(table) {
      let operation='select',value,single=false;
      const filters=[];
      const q={
        select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},neq(k,v){filters.push(row=>row[k]!==v);return q;},
        in(k,values){filters.push(row=>values.includes(row[k]));return q;},is(k,v){filters.push(row=>row[k]===v);return q;},
        limit(){return q;},order(){return q;},
        insert(v){operation='insert';value=v;return q;},update(v){operation='update';value=v;return q;},
        single(){single=true;return execute();},maybeSingle(){single=true;return execute();},
        then(resolve,reject){return execute().then(resolve,reject);},
      };
      async function execute(){
        if(table==='dancer_profiles')return {data:{id:'profile',user_id:'owner',avatar_storage_path:'avatar'},error:null};
        if(table==='dancer_photos')return {data:[],error:null};
        if(table==='notifications')return {data:[],error:null};
        assert.equal(table,'image_moderation_records');
        if(operation==='insert')Object.assign(record,{id:'record',updated_at:version,...value});
        const found=record.id&&filters.every(f=>f(record));
        if(operation==='update'&&found){
          const fail=stateResponseLoss&&!writeFailed&&value.status==='pending_review';
          if(fail)writeFailed=true;
          if(fail&&stateResponseLoss==='before')return {data:null,error:transportError};
          Object.assign(record,value);events.push('state:'+value.status);
          if(fail)return {data:null,error:transportError};
        }
        return {data:single?(found?{...record}:null):(found?[{...record}]:[]),error:null};
      }
      return q;
    },
    async rpc(_name,input){
      rpcVersion=input.p_expected_updated_at;
      assert.equal(rpcVersion,record.updated_at,'Publisher must receive the version returned by the worker claim');
      return {data:null,error:{code:'40001',message:'synthetic conflict'}};
    },
    storage:{from(bucket){return {
      async upload(path,_data,options){
        assert.equal(options.upsert,false);events.push('upload:'+bucket);
        const targeted=bucket===uploadBucket;
        if(targeted&&uploadFailure==='before')return {data:null,error:transportError};
        files.add(path);
        if(targeted&&uploadFailure==='after')return {data:null,error:transportError};
        if(targeted&&uploadFailure==='throw')throw transportError;
        const receipts={valid:{path,fullPath:bucket+'/'+path},legacy:{path},null:null,undefined:undefined,empty:{},array:[],boolean:false,foreignPath:{path:'different/path.jpg'},foreignBucket:{path,fullPath:'wrong-bucket/'+path}};
        return {data:receipts[targeted?receiptKind:'valid'],error:null};
      },
      async download(path){assert.ok(files.has(path));return {data:new Blob(['synthetic'],{type:'image/jpeg'}),error:null};},
      async remove(paths){for(const path of paths)files.delete(path);events.push('remove:'+bucket);return {error:null};},
    };}},
  };
  const evaluation={decision,reasonCodes:[],categoryScores:{},providerFlagged:false};
  const deps={
    createHash,randomUUID,...loadGalleryGateway(),...storageReceipt,
    validateAndPrepareDancrImage:async()=>({sha256:'synthetic',storageFileName:'image.jpg',buffer:Buffer.from('synthetic'),contentType:'image/jpeg'}),
    resolvePhotoPublicationIntent:async()=>({mode:'add',replacementPhotoId:null}),
    MAX_DANCER_PROFILE_PHOTOS:50,ACTIVE_IMAGE_MODERATION_STATUSES:[],
    isProfileAvatarUploadContext:()=>false,
    profilePhotoSlotFromUploadContext:()=>({isPrimary:false,sortOrder:1}),
    profilePhotoUploadContext:()=> 'profile_gallery:1',
    loadApprovedDancerIdentityReference:async()=>Buffer.from('reference'),
    analyzeDancerMediaIdentity:async()=>({}),dancerMediaIdentityCategoryFlags:()=>({}),
    evaluateDancrImageModeration:()=>evaluation,evaluateDancerMediaIdentity:()=>({}),combineDancerMediaModeration:()=>evaluation,
    safeErrorMetadata:()=>({code:'synthetic'}),isAvatarFaceRequiredError:()=>false,
    uploadResponsiveImage:async()=>({storagePath:'owner/profile/public.jpg'}),
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(source+'\nmoderateImageWithOpenAI = testProvider;',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:()=>deps,Buffer,Blob,Date,setTimeout,clearTimeout,
    console:{log(){},warn(){},error(){},info(){}},
    testProvider:async()=>{
      if(concurrentDecision)Object.assign(record,{decision:concurrentDecision,status:concurrentDecision,updated_at:'2020-01-02T00:00:00Z'});
      if(providerError)throw new Error('provider_timeout');
      return {categories:{}};
    },
  });
  return {record,files,events,transportError,get rpcVersion(){return rpcVersion;},
    run:()=>retry?exports.processImageModerationRetryRecord(client,{...record})
      :exports.moderateAndStoreDancerPhoto(client,client,{file:new Blob(['synthetic']),userId:'owner',idempotencyKey:'synthetic'}),
  };
}

for(const concurrentDecision of ['approved','rejected']){
  for(const decision of ['review','rejected']){
    test('late '+decision+' result preserves a concurrent '+concurrentDecision+' decision and private source',async()=>{
      const s=scenario({concurrentDecision,decision});
      await assert.rejects(s.run(),{status:409});
      assert.equal(s.record.decision,concurrentDecision);
      assert.ok(s.files.has(s.record.temporary_storage_path));
      assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
    });
  }
  test('late provider error preserves a concurrent '+concurrentDecision+' decision',async()=>{
    const s=scenario({concurrentDecision,providerError:true});
    await assert.rejects(s.run(),{status:409});
    assert.equal(s.record.decision,concurrentDecision);
    assert.ok(s.files.has(s.record.temporary_storage_path));
  });
}
for(const stateResponseLoss of ['before','after']){
  test('private review source survives pointer-update response loss '+stateResponseLoss+' commit',async()=>{
    const s=scenario({stateResponseLoss});
    await assert.rejects(s.run(),error=>error===s.transportError);
    assert.equal(s.files.size,2);
    assert.ok(s.files.has(s.record.temporary_storage_path));
    assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  });
}
test('review source is removed only after the new private pointer is acknowledged',async()=>{
  const s=scenario();const result=await s.run();
  assert.equal(result.decision,'review');
  assert.equal(s.files.size,1);
  assert.ok(s.files.has(s.record.temporary_storage_path));
  assert.ok(s.events.indexOf('state:pending_review')<s.events.indexOf('remove:dancr-image-moderation-temp'));
});
test('retry publisher uses the advanced claim version and retains media after a publication conflict',async()=>{
  const s=scenario({retry:true,decision:'approved'});
  await assert.rejects(s.run(),{status:409});
  assert.ok(Date.parse(s.rpcVersion)>Date.parse(version));
  assert.ok(s.files.has('owner/profile/temp.jpg'));
});

const tempBucket='dancr-image-moderation-temp',reviewBucket='dancr-image-moderation-review';
for(const uploadBucket of [tempBucket,reviewBucket]){
 for(const receiptKind of ['null','undefined','empty','array','boolean','foreignPath','foreignBucket'])test('private upload '+uploadBucket+' retains source on '+receiptKind+' acknowledgment',async()=>{
  const s=scenario({uploadBucket,receiptKind});await assert.rejects(s.run());
  assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  if(uploadBucket===tempBucket){assert.equal(s.record.id,undefined);assert.equal(s.files.size,1);}
  else{assert.equal(s.record.status,'moderating');assert.equal(s.record.decision,'review');assert.ok(s.files.has(s.record.temporary_storage_path));assert.equal(s.files.size,2);}
 });
 for(const uploadFailure of ['before','after','throw'])test('private upload '+uploadBucket+' retains available source on '+uploadFailure+' failure',async()=>{
  const s=scenario({uploadBucket,uploadFailure});await assert.rejects(s.run(),error=>error===s.transportError);
  assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  if(uploadBucket===tempBucket){assert.equal(s.record.id,undefined);assert.equal(s.files.size,uploadFailure==='before'?0:1);}
  else{assert.equal(s.record.status,'moderating');assert.ok(s.files.has(s.record.temporary_storage_path));assert.equal(s.files.size,uploadFailure==='before'?1:2);}
 });
 for(const receiptKind of ['legacy','valid'])test('private upload '+uploadBucket+' accepts exact '+receiptKind+' receipt before moving pointer',async()=>{
  const s=scenario({uploadBucket,receiptKind}),result=await s.run();assert.equal(result.decision,'review');assert.equal(s.files.size,1);assert.ok(s.files.has(s.record.temporary_storage_path));
  assert.ok(s.events.indexOf('upload:'+reviewBucket)<s.events.indexOf('state:pending_review'));
  assert.ok(s.events.indexOf('state:pending_review')<s.events.indexOf('remove:'+tempBucket));
 });
}
for(const receiptKind of ['null','foreignPath','foreignBucket'])test('retry review copy retains original after '+receiptKind+' receipt',async()=>{
 const s=scenario({retry:true,uploadBucket:reviewBucket,receiptKind});await s.run();
 assert.equal(s.record.status,'moderation_retry');assert.equal(s.record.temporary_storage_path,'owner/profile/temp.jpg');
 assert.ok(s.files.has('owner/profile/temp.jpg'));assert.equal(s.files.size,2);assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
});
