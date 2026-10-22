import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadAvatarGateway } from './helpers/avatar-publication-fixture.mjs';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { loadGalleryGateway } from './helpers/gallery-publication-fixture.mjs';
import * as serverJobs from '../src/lib/server-job.ts';
import * as photoContentPolicy from '../src/lib/dancr/photo-content-policy-core.ts';
import { mediaReview } from './helpers/media-review-label.mjs';
import * as mediaIdentity from '../src/lib/dancr/media-identity-core.ts';

const source=process.env.MYDANCR_AVATAR_SOURCE_BASELINE==='1'
  ?execFileSync('git',['show','4ff0ceb3999cfa2b7c516baddcb3e0da197e4567:src/lib/dancr/image-moderation.ts'],{encoding:'utf8',windowsHide:true})
  :process.env.MYDANCR_PRIVATE_UPLOAD_BASELINE==='1'
  ?execFileSync('git',['show','c659ec3c8c0574ff2a536b7ef3fac784980623d1:src/lib/dancr/image-moderation.ts'],{encoding:'utf8',windowsHide:true})
  :readFileSync(new URL('../src/lib/dancr/image-moderation.ts',import.meta.url),'utf8');
const storageReceipt={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/storage-upload-receipt.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:storageReceipt,Error});
const version='2020-01-01T00:00:00Z';
const claimedVersion='2020-01-01T00:00:01.001Z';
const legacyRetryClaim=process.env.MYDANCR_AVATAR_SOURCE_BASELINE==='1'||process.env.MYDANCR_PRIVATE_UPLOAD_BASELINE==='1';
const clearContent={branding:"absent",brandingConfidence:0.99,nudity:'absent',sexualActivity:'absent',decision:'approved',reasonCodes:['safe_adult_promotional_content'],confidence:0.99};
function scenario({decision='review',concurrentDecision='',defer=false,providerError=false,providerFailure=null,providerMessage='provider_timeout',providerStatus=0,faceRejection=false,avatar=false,attemptCount=1,stateResponseLoss='',stateResponseStatus='pending_review',replayStatus='',retry=false,uploadBucket='',uploadFailure='',receiptKind='valid',contentAnalysis=clearContent,contentError=false,identityAnalysis={personCount:1,personCountConfidence:0.99,singlePersonOnly:true,referenceMatch:'match',confidence:0.99}}={}) {
  const events=[],files=new Set(),record=retry?{
    id:'record',user_id:'owner',upload_context:avatar?'profile_avatar':'profile_gallery:1',temporary_storage_path:'owner/profile/temp.jpg',
    decision:'review',status:'moderating',updated_at:legacyRetryClaim?version:claimedVersion,locked_at:claimedVersion,attempt_count:attemptCount+(legacyRetryClaim?0:1),avatar_expected_path:'avatar',avatar_expected_updated_at:version,
  }:{};
  if (replayStatus) Object.assign(record, {id:'record', user_id:'owner', idempotency_key:createHash('sha256').update('synthetic').digest('hex'), decision:'review', status:replayStatus, upload_context:avatar?'profile_avatar':'profile_gallery:1', reason_codes:[], error_code:'provider_timeout'});
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
        if(table==='dancer_profiles')return {data:{id:'profile',user_id:'owner',avatar_storage_path:'avatar',avatar_updated_at:version},error:null};
        if(table==='dancer_photos')return {data:[],error:null};
        if(table==='notifications')return {data:[],error:null};
        assert.equal(table,'image_moderation_records');
        if(operation==='insert')Object.assign(record,{id:'record',updated_at:version,...value});
        const found=record.id&&filters.every(f=>f(record));
        if(operation==='update'&&found){
          const fail=stateResponseLoss&&!writeFailed&&value.status===stateResponseStatus;
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
    createHash,randomUUID,PublicApiError,...serverJobs,...loadGalleryGateway(),...loadAvatarGateway(),...storageReceipt,...photoContentPolicy,...mediaIdentity,...mediaReview,
    validateAndPrepareDancrImage:async()=>({sha256:'synthetic',storageFileName:'image.jpg',buffer:Buffer.from('synthetic'),contentType:'image/jpeg'}),
    resolvePhotoPublicationIntent:async()=>({mode:'add',replacementPhotoId:null}),
    MAX_DANCER_PROFILE_PHOTOS:50,ACTIVE_IMAGE_MODERATION_STATUSES:[],
    isProfileAvatarUploadContext:()=>avatar,
    profilePhotoSlotFromUploadContext:()=>({isPrimary:false,sortOrder:1}),
    profilePhotoUploadContext:()=> 'profile_gallery:1',
    prepareFaceCenteredAvatar:async image=>({...image,buffer:Buffer.from('cropped-avatar')}),
    createDancerAvatarReview:async(_admin,input)=>{
      Object.assign(record,{id:'record',user_id:input.userId,upload_context:'profile_avatar',temporary_storage_path:input.temporaryStoragePath,
        decision:'review',status:'moderating',updated_at:version});
      return {id:record.id,updated_at:version};
    },
    analyzeDancerMediaIdentity:async input=>{
      assert.equal('referenceImage' in input,false);
      assert.equal(input.targetImages[0].toString(),'synthetic','count people in the original photo, including outside the avatar crop');
      return identityAnalysis;
    },
    analyzeDancerPhotoContent:async image=>{
      assert.equal(image.buffer.toString(),'synthetic','check the entire original photo, never just the avatar crop');
      events.push('content-check');
      if(contentError)throw new Error('provider_timeout: photo content review');
      return contentAnalysis;
    },
    evaluateDancrImageModeration:()=>evaluation,
    safeErrorMetadata:()=>({code:'synthetic'}),isAvatarFaceRequiredError:()=>faceRejection,
    uploadResponsiveImage:async()=>{events.push('public-upload');return {storagePath:'owner/profile/public.jpg'};},
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(source+'\nmoderateImageWithOpenAI = testProvider;',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:()=>deps,Buffer,Blob,Date,Error,setTimeout,clearTimeout,
    console:{log(){},warn(){},error(){},info(){}},
    testProvider:async()=>{
      if(concurrentDecision)Object.assign(record,{decision:concurrentDecision,status:concurrentDecision,updated_at:'2020-01-02T00:00:00Z'});
      if(providerError)throw providerFailure ?? Object.assign(new Error(providerMessage),providerStatus?{status:providerStatus}:{});
      return {categories:{}};
    },
  });
  return {record,files,events,transportError,get rpcVersion(){return rpcVersion;},
    run:()=>retry?exports.processImageModerationRetryRecord(client,{...record})
      :exports.moderateAndStoreDancerPhoto(client,client,{file:new Blob(['synthetic']),userId:'owner',idempotencyKey:'synthetic',deferModeration:defer}),
  };
}

for(const avatar of [false,true])for(const retry of [false,true]){
  const context=(avatar?'avatar':'gallery')+(retry?' retry':' first upload');
  for(const [personCount,personCountConfidence,expected] of [[2,0.99,'rejected'],[1,0.7,'rejected'],[0,0.99,'rejected']]){
    test(context+' blocks count '+personCount+' with certainty '+personCountConfidence,async()=>{
      const s=scenario({avatar,retry,decision:'approved',identityAnalysis:{personCount,personCountConfidence,singlePersonOnly:personCount===1,referenceMatch:'match',confidence:0.99}});
      const result=await s.run();
      assert.equal(result.decision,expected);assert.equal(s.events.includes('public-upload'),false);
      assert.equal(s.record.category_scores.dancer_identity_person_count,personCount);
      assert.equal(s.record.category_scores.dancer_identity_person_count_confidence,personCountConfidence);
      if(personCount===2)assert.ok(result.reasonCodes.includes('multiple_people_detected'));
    });
  }
  test(context+' rejects: nudity even when generic moderation would approve',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{...clearContent,nudity:'present'}});
    const result=await s.run();
    assert.equal(result.decision,'rejected');assert.equal(s.record.status,'rejected');
    assert.ok(result.reasonCodes.includes('nudity_rejected'));assert.ok(result.message);assert.doesNotMatch(result.message,/manual review|club approval/i);
    assert.equal(s.record.category_flags.photo_nudity,true);
    assert.ok(s.events.includes('content-check'));assert.equal(s.events.includes('public-upload'),false);
  });
  for(const branding of ['present','uncertain'])test(context+' keeps '+branding+' branding off the public site despite an overall approval',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{...clearContent,branding}});
    const result=await s.run();
    assert.equal(result.decision,'rejected');
    assert.equal(s.record.status,'rejected');
    assert.equal(s.events.includes('public-upload'),false);
    assert.ok(result.reasonCodes.includes(branding==='uncertain'?'branding_or_logo_uncertain':'visible_branding_or_logo'));
    assert.equal(s.files.size,0);
  });
  test(context+' rejects: uncertain clothing coverage',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{...clearContent,nudity:'uncertain',confidence:0.7}});
    const result=await s.run();
    assert.equal(result.decision,'rejected');assert.equal(s.record.status,'rejected');
    assert.equal(s.record.category_flags.ai_recommended_approval,false);
    assert.equal(result.photo,undefined);assert.equal(s.files.size,0);assert.equal(s.events.includes('public-upload'),false);
  });
  test(context+' cannot publish after the content classifier fails',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentError:true});
    const result=await s.run();
    assert.equal(result.decision,retry?'moderation_retry':'moderation_error');
    assert.ok(s.files.has(s.record.temporary_storage_path));assert.equal(s.events.includes('public-upload'),false);
  });
  for(const reason of ['contact_or_payment_overlay','sexual_services_or_solicitation','drug_use_or_sales','impersonation_or_deceptive_media']){
    test(context+' rejects: '+reason+' before any public upload',async()=>{
      const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{...clearContent,decision:'rejected',reasonCodes:[reason]}});
      const result=await s.run();
      assert.equal(result.decision,'rejected');assert.equal(s.record.status,'rejected');
      assert.ok(result.reasonCodes.includes('photo_policy_'+reason));
      assert.equal(s.record.category_flags['photo_policy_'+reason],true);
      assert.equal(s.events.includes('public-upload'),false);
      assert.ok(result.message);assert.doesNotMatch(result.message,/manual review|club approval/i);
    });
  }
  test(context+' rejects: an ambiguous venue logo/contact overlay',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{...clearContent,decision:'review',reasonCodes:['contact_or_payment_overlay']}});
    const result=await s.run();
    assert.equal(result.decision,'rejected');assert.equal(s.record.status,'rejected');
    assert.equal(s.record.category_flags.ai_recommended_approval,false);
    assert.equal(result.photo,undefined);assert.equal(s.files.size,0);assert.equal(s.events.includes('public-upload'),false);
  });
  test(context+' cannot publish a legacy response missing the additional policy checks',async()=>{
    const s=scenario({avatar,retry,decision:'approved',contentAnalysis:{nudity:'absent',sexualActivity:'absent',confidence:0.99}});
    const result=await s.run();
    assert.notEqual(result.decision,'approved');assert.equal(s.events.includes('public-upload'),false);
  });
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
  test('private source survives an unconfirmed rejection '+stateResponseLoss+' commit',async()=>{
    const s=scenario({stateResponseLoss,stateResponseStatus:'rejected',decision:'review'});
    await assert.rejects(s.run(),error=>error===s.transportError);
    assert.ok(s.files.has(s.record.temporary_storage_path));
    assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  });
  test('private sources survive pending-review response loss '+stateResponseLoss+' commit',async()=>{
    const s=scenario({stateResponseLoss,decision:'approved'});
    await assert.rejects(s.run(),error=>error===s.transportError);
    assert.equal(s.files.size,2);
    assert.ok(s.files.has(s.record.temporary_storage_path));
    assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  });
}
for (const avatar of [false,true]) for (const retry of [false,true]) {
  test((avatar?'avatar':'gallery')+(retry?' retry':' upload')+' rejects an inconclusive result before cleaning its private source',async()=>{
    const s=scenario({avatar,retry});const result=await s.run();
    assert.equal(result.decision,'rejected');assert.equal(s.record.decision,'rejected');
    assert.equal(s.record.status,'rejected');assert.equal(result.photo,undefined);
    assert.equal(s.record.category_flags.ai_recommended_approval,false);
    assert.equal(result.message,'Approval unconfirmed');
    assert.equal(s.files.size,0);
    assert.equal(s.events.includes('upload:dancr-image-moderation-review'),false);
    assert.ok(s.events.indexOf('state:rejected')<s.events.indexOf('remove:dancr-image-moderation-temp'));
  });
}
for (const avatar of [false,true]) for (const replayStatus of ['pending_review','completed','moderating','moderation_retry','moderation_error']) {
  test((avatar?'avatar':'gallery')+' duplicate upload preserves '+replayStatus+' outcome in the admin queue',async()=>{
    const s=scenario({avatar,replayStatus});const result=await s.run();
    assert.equal(result.decision,['pending_review','completed'].includes(replayStatus)?'pending_review':replayStatus);
    assert.doesNotMatch(result.message,/awaiting|manual review/i);
    assert.equal(s.events.length,0);
  });
}

for (const avatar of [false, true]) for (const retry of [false, true]) {
  for (const decision of ['approved', 'review', 'rejected']) test(`${avatar ? 'avatar' : 'gallery'} ${retry ? 'retry' : 'upload'} routes AI ${decision} to club approval only after a pass`, async () => {
    const s = scenario({avatar, retry, decision});
    const result = await s.run();
    assert.equal(result.decision, decision === 'approved' ? 'pending_review' : 'rejected');
    assert.equal(s.record.decision, decision === 'approved' ? 'review' : 'rejected');
    assert.equal(s.record.status, result.decision);
    assert.equal(s.record.category_flags.ai_recommended_approval, decision === 'approved');
    assert.equal(s.record.category_flags.ai_recommended_rejection, decision !== 'approved');
    assert.equal(s.events.includes('public-upload'), decision === 'approved');
    assert.equal(s.record.category_flags.publication_prepared, decision === 'approved' ? true : undefined);
    assert.equal(s.record.final_storage_path, decision === 'approved' ? 'owner/profile/public.jpg' : undefined);
    assert.equal(s.rpcVersion, undefined);
    assert.equal(s.files.has(s.record.temporary_storage_path), decision === 'approved');
    assert.equal(s.files.size, decision === 'approved' ? 1 : 0);
  });
}
for (const avatar of [false, true]) test(`${avatar ? 'avatar' : 'gallery'} deferred upload is pending before AI starts`, async () => {
  const s = scenario({avatar, defer:true, decision:'approved'});
  const result = await s.run();
  assert.equal(result.decision, 'moderating');
  assert.equal(result.photo.reviewStatus, 'pending');
  assert.equal(s.record.decision, 'review');
  assert.equal(s.events.includes('content-check'), false);
  assert.equal(s.events.includes('public-upload'), false);
  assert.ok(s.files.has(s.record.temporary_storage_path));
});

const tempBucket='dancr-image-moderation-temp';
for(const receiptKind of ['null','undefined','empty','array','boolean','foreignPath','foreignBucket'])test('private upload retains source on '+receiptKind+' acknowledgment',async()=>{
  const s=scenario({uploadBucket:tempBucket,receiptKind});await assert.rejects(s.run());
  assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  assert.equal(s.record.id,undefined);assert.equal(s.files.size,1);
});
for(const uploadFailure of ['before','after','throw'])test('private upload retains available source on '+uploadFailure+' failure',async()=>{
  const s=scenario({uploadBucket:tempBucket,uploadFailure});await assert.rejects(s.run(),error=>error===s.transportError);
  assert.equal(s.events.some(e=>e.startsWith('remove:')),false);
  assert.equal(s.record.id,undefined);assert.equal(s.files.size,uploadFailure==='before'?0:1);
});
for(const receiptKind of ['legacy','valid'])test('private upload accepts exact '+receiptKind+' receipt before completing moderation',async()=>{
  const s=scenario({uploadBucket:tempBucket,receiptKind,decision:'approved'}),result=await s.run();
  assert.equal(result.decision,'pending_review');assert.equal(s.files.size,1);
  assert.ok(s.events.indexOf('upload:'+tempBucket)<s.events.indexOf('state:pending_review'));
  assert.ok(s.events.indexOf('state:pending_review')<s.events.indexOf('remove:'+tempBucket));
});

for(const attemptCount of [1,3,4]){
 for(const [providerMessage,providerStatus,expectedCode] of [
  ['provider_timeout',0,'provider_timeout'],['Synthetic failure',429,'provider_rate_limited'],
  ['Synthetic failure',401,'invalid_openai_api_key'],['Synthetic failure',403,'provider_forbidden'],
  ['Synthetic failure',400,'provider_invalid_request'],['OPENAI_API_KEY missing',0,'missing_openai_api_key'],
  ['Synthetic failure',0,'provider_error'],
 ])test('avatar worker preserves recovery source after '+expectedCode+' at attempt '+(attemptCount+1),async()=>{
  const s=scenario({retry:true,avatar:true,attemptCount,providerError:true,providerMessage,providerStatus});
  if(attemptCount>=4&&!legacyRetryClaim){
    const before=structuredClone(s.record);
    await assert.rejects(s.run(),/retry_record_not_claimed/);
    assert.deepEqual(s.record,before);assert.equal(s.events.length,0);
    assert.ok(s.files.has('owner/profile/temp.jpg'));return;
  }
  const result=await s.run(),retryable=attemptCount<3&&['provider_timeout','provider_rate_limited','provider_error'].includes(expectedCode);
  assert.equal(result.decision,retryable?'moderation_retry':'moderation_error');assert.equal(s.record.status,result.decision);
  assert.equal(s.record.decision,'review');assert.equal(s.record.error_code,expectedCode);assert.equal(s.record.attempt_count,attemptCount+1);
  assert.equal(s.record.locked_at,null);assert.equal(s.record.next_attempt_at===null,!retryable);
  assert.equal(s.record.temporary_storage_path,'owner/profile/temp.jpg');assert.ok(s.files.has('owner/profile/temp.jpg'));
  assert.equal(s.events.some(e=>e.startsWith('remove:')),false);assert.equal(s.files.size,1);
 });
}
test('avatar worker rejects a flagged upload and removes its private source',async()=>{
 const s=scenario({retry:true,avatar:true,attemptCount:3,decision:'rejected'}),result=await s.run();
 assert.equal(result.decision,'rejected');assert.equal(s.record.decision,'rejected');
 assert.equal(s.record.category_flags.ai_recommended_rejection,true);
 assert.equal(s.files.size,0);assert.equal(s.files.has(s.record.temporary_storage_path),false);
});

const privateDiagnostic = 'synthetic-private-token owner@example.invalid /srv/private/query.sql https://example.invalid/object?token=synthetic-private-token';
const diagnosticFailures = [
  ['exception', () => new Error(privateDiagnostic), 'provider_error'],
  ['authentication', () => Object.assign(new Error(privateDiagnostic), {status:401}), 'invalid_openai_api_key'],
  ['rate limit', () => Object.assign(new Error(privateDiagnostic), {status:429}), 'provider_rate_limited'],
  ['timeout', () => new Error('provider_timeout ' + privateDiagnostic), 'provider_timeout'],
  ['string', () => privateDiagnostic, 'provider_error'],
  ['object', () => ({message:privateDiagnostic, status:503}), 'provider_error'],
  ['stringified object', () => ({toString:() => 'provider_timeout ' + privateDiagnostic}), 'provider_timeout'],
  ['missing key', () => new Error('OPENAI_API_KEY ' + privateDiagnostic), 'missing_openai_api_key'],
];
for (const avatar of [false, true]) for (const attemptCount of [1, 3]) {
  for (const [kind, failure, expectedCode] of diagnosticFailures) {
    test('retry diagnostic privacy: ' + (avatar ? 'avatar' : 'gallery') + ' ' + kind + ' attempt ' + (attemptCount + 1), async () => {
      const s = scenario({retry:true, avatar, attemptCount, providerError:true, providerFailure:failure()});
      const result = await s.run();
      const retryable = attemptCount < 3 && ['provider_timeout', 'provider_rate_limited', 'provider_error'].includes(expectedCode);
      assert.equal(s.record.last_error_message, expectedCode);
      assert.equal(s.record.last_error_code, expectedCode);
      assert.equal(s.record.error_code, expectedCode);
      assert.deepEqual(Array.from(result.reasonCodes), [expectedCode]);
      assert.equal(s.record.status, retryable ? 'moderation_retry' : 'moderation_error');
      assert.equal(result.decision, s.record.status);
      assert.equal(s.record.decision, 'review');
      assert.equal(s.record.attempt_count, attemptCount + 1);
      assert.equal(s.record.locked_at, null);
      assert.equal(s.record.next_attempt_at === null, !retryable);
      assert.equal(s.files.size, 1);
      assert.ok(s.files.has('owner/profile/temp.jpg'));
      assert.equal(s.events.some(event => event.startsWith('remove:')), false);
      assert.doesNotMatch(JSON.stringify({record:s.record, result}), /synthetic-private-token|owner@example|srv\/private|query\.sql/);
    });
  }
}

for (const avatar of [false, true]) for (const retry of [false, true]) {
  test((avatar ? 'avatar' : 'gallery') + (retry ? ' retry' : ' upload') + ' completes AI review without an avatar match', async () => {
    const s = scenario({ avatar, retry, decision: 'approved', identityAnalysis: { personCount: 1, personCountConfidence: 0.99, singlePersonOnly: true, referenceMatch: 'mismatch', confidence: 0.1 } });
    assert.equal((await s.run()).decision, 'pending_review');
    assert.ok(s.events.includes('content-check'));
    assert.equal(s.events.includes('public-upload'), true, 'Display files are prepared before club review');
    assert.equal(s.record.decision, 'review', 'Prepared files are still unpublished');
    assert.equal(s.rpcVersion, undefined, 'Only human approval calls publication');
  });
}
