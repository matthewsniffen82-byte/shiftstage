import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const intentSource=readFileSync(new URL('../src/lib/dancr/photo-publication-intent.ts',import.meta.url),'utf8');
const moderationSource=readFileSync(new URL('../src/lib/dancr/image-moderation.ts',import.meta.url),'utf8');
const live=readFileSync(new URL('../outputs/index.html',import.meta.url),'utf8');
const photoId='00000000-0000-4000-8000-000000000101';
const nextId='00000000-0000-4000-8000-000000000102';
function load(source,names,dependencies={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(`${source}\nexport const subject={${names}};`,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:()=>({PublicApiError,createHash,randomUUID,...dependencies}),Buffer,Blob,console,setTimeout,clearTimeout});
  return exports.subject;
}
const {resolvePhotoPublicationIntent}=load(intentSource,'resolvePhotoPublicationIntent');
function selectionClient(rows=[],error=null) {
  const calls=[];
  return {calls,from(table) {
    assert.equal(table,'dancer_photos');
    const predicates=[];
    return {
      select(){return this;},
      eq(key,value){calls.push([key,value]);predicates.push(row=>row[key]===value);return this;},
      in(key,values){predicates.push(row=>values.includes(row[key]));return this;},
      async maybeSingle(){return {data:rows.find(row=>predicates.every(p=>p(row)))||null,error};},
    };
  }};
}
const row=(id=photoId,extra={})=>({id,dancer_id:'profile',is_primary:false,sort_order:3,review_status:'approved',...extra});

test('new gallery additions do not query or authorize a replacement',async()=>{
  const client=selectionClient([row()]);
  assert.deepEqual({...await resolvePhotoPublicationIntent(client,'profile',{})},{mode:'add',replacementPhotoId:null});
  assert.equal(client.calls.length,0);
  await assert.rejects(resolvePhotoPublicationIntent(client,'profile',{replacementPhotoId:photoId}),error=>error.status===400);
});

test('replacement preserves the exact owned identity and its current database slot',async()=>{
  const client=selectionClient([row(photoId,{sort_order:7}),row(nextId)]);
  const result=await resolvePhotoPublicationIntent(client,'profile',{replaceExisting:true,replacementPhotoId:photoId,isPrimary:false});
  assert.deepEqual({...result},{mode:'replace',replacementPhotoId:photoId,sortOrder:7});
  assert.ok(client.calls.some(([key,value])=>key==='id'&&value===photoId));
  assert.ok(client.calls.some(([key,value])=>key==='dancer_id'&&value==='profile'));
});

for(const expectedId of ['',null,'not-a-photo-id']) {
  test(`missing or malformed replacement identity (${String(expectedId)}) fails before querying`,async()=>{
    const client=selectionClient([row()]);
    await assert.rejects(resolvePhotoPublicationIntent(client,'profile',{replaceExisting:true,replacementPhotoId:expectedId}),error=>error.status===409);
    assert.equal(client.calls.length,0);
  });
}

for(const changed of [{dancer_id:'another-profile'},{is_primary:true},{review_status:'rejected'},{id:nextId}]) {
  test(`a foreign, changed or removed replacement is not inferred from its old slot: ${JSON.stringify(changed)}`,async()=>{
    const client=selectionClient([row(photoId,changed)]);
    await assert.rejects(resolvePhotoPublicationIntent(client,'profile',{replaceExisting:true,replacementPhotoId:photoId}),error=>error.status===409);
  });
}

test('a failed ownership read retains the original database failure',async()=>{
  const error={code:'08006',message:'synthetic connection failure'};
  await assert.rejects(resolvePhotoPublicationIntent(selectionClient([],error),'profile',{replaceExisting:true,replacementPhotoId:photoId}),caught=>caught===error);
});

test('moderation records retain add, replace and separate avatar intent',async()=>{
  const {createModerationRecord}=load(moderationSource,'createModerationRecord',{DANCR_IMAGE_MODERATION_MODEL:'synthetic'});
  for(const mode of ['add','replace','legacy']) {
    let saved;
    const client={from(table){assert.equal(table,'image_moderation_records');return {
      insert(value){saved=value;return this;},select(){return this;},async single(){return {data:{id:'review'},error:null};},
    };}};
    await createModerationRecord(client,{userId:'owner',temporaryStoragePath:'private/synthetic',uploadContext:mode==='legacy'?'profile_avatar':'profile_gallery:3',idempotencyKey:'synthetic-key',photoPublicationMode:mode,replacementPhotoId:mode==='replace'?photoId:null});
    assert.equal(saved.photo_publication_mode,mode);
    assert.equal(saved.replacement_photo_id,mode==='replace'?photoId:null);
    assert.equal(saved.decision,'review');
    assert.equal(saved.status,'moderating');
  }
});

test('a completed upload retry returns its own result before checking the retired replacement or a full library',async()=>{
  const queries=[];
  const client={from(table){queries.push(table);return {
    select(){return this;},eq(){return this;},async maybeSingle(){return {error:null,data:table==='dancer_profiles'
      ? {id:'profile',avatar_storage_path:'avatar'}
      : {id:'review',image_id:nextId,decision:'approved',status:'approved',final_storage_path:'owner/profile/approved.jpg',upload_context:'profile_gallery:3'}};},
  };}};
  const {moderateAndStoreDancerPhoto}=load(moderationSource,'moderateAndStoreDancerPhoto',{
    isProfileAvatarUploadContext:()=>false,
    validateAndPrepareDancrImage:async()=>({sha256:'synthetic'}),
    profilePhotoSlotFromUploadContext:()=>({isPrimary:false,sortOrder:3}),
    responsivePublicImage:()=>({imageUrl:'https://example.test/approved.jpg'}),
    resolvePhotoPublicationIntent:()=>assert.fail('Must reuse the confirmed idempotent result first'),
  });
  const result=await moderateAndStoreDancerPhoto(client,client,{file:new Blob(['synthetic']),userId:'owner',idempotencyKey:'synthetic-retry',replaceExisting:true,replacementPhotoId:photoId});
  assert.equal(result.photo.id,nextId);
  assert.equal(result.decision,'approved');
  assert.deepEqual(queries,['dancer_profiles','image_moderation_records']);
});

function liveFunction(name) {
  const match=live.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n    \\}`));
  assert.ok(match,`Missing ${name}`);
  return match[0];
}

test('a replacement keeps its selected ID while asynchronous photo preparation changes the visible slot',async()=>{
  let finishCrop;
  const crop=new Promise(resolve=>{finishCrop=resolve;});
  const profile={dancer_photos:[row()],submittedPhotos:[]};
  const uploads=[];
  const reachedUpload=new Error('synthetic stop after recording request');
  const context={
    isDancerSession:()=>true,activeDancerProfile:()=>profile,
    approvedVisualPhotoItems:p=>p.dancer_photos.map(photo=>({...photo,target:'gallery:2'})),
    cropApprovedProfilePhoto:()=>crop,persistQueuedApprovedPhotoDeletionsBeforeUpload:async p=>p,
    assertDancerProfilePhotoLimit:()=>{},uploadSetupPhotoFile:async(...args)=>{uploads.push(args);throw reachedUpload;},
  };
  vm.createContext(context);
  vm.runInContext(['isReplacingApprovedPhotoTarget','selectedPhotoReplacement','uploadApprovedDancerPhoto'].map(liveFunction).join('\n'),context);
  const pending=context.uploadApprovedDancerPhoto({},'gallery:2');
  profile.dancer_photos=[row(nextId,{sort_order:9})];
  finishCrop({});
  await assert.rejects(pending,error=>error===reachedUpload);
  assert.equal(uploads[0][2],3);
  assert.equal(uploads[0][3].replacementPhotoId,photoId);
  assert.equal(uploads[0][3].replaceExisting,true);
});

test('selecting a pending review never substitutes the approved photo underneath its slot',()=>{
  const context={approvedVisualPhotoItems:p=>p.submittedPhotos.map(photo=>({...photo,target:'gallery:2'}))};
  vm.createContext(context);
  vm.runInContext(liveFunction('selectedPhotoReplacement'),context);
  const profile={dancer_photos:[row()],submittedPhotos:[{id:'pending-review',image_id:photoId,sort_order:3}]};
  assert.throws(()=>context.selectedPhotoReplacement(profile,'gallery:2'),/Remove a pending upload/);
  assert.throws(()=>context.selectedPhotoReplacement(profile,'submitted:0'),/Remove a pending upload/);
});

test('the browser sends the selected identity alongside explicit replacement intent',async()=>{
  let body;
  const context={FormData,approvedProfilePhotoAccountIds:new WeakMap(),synchronizeAuthSession:()=>({account:{id:'owner'}}),
    authenticatedRequestHeaders:()=>({}),applyResponseSession:()=>{},normalizedReviewStatus:String,
    fetch:async(_url,options)=>{body=options.body;return {ok:true,json:async()=>({ok:true,decision:'approved'})};}};
  vm.createContext(context);
  vm.runInContext(liveFunction('uploadSetupPhotoFile'),context);
  await context.uploadSetupPhotoFile(new File(['synthetic'],'photo.jpg'),false,3,{replaceExisting:true,replacementPhotoId:photoId});
  assert.equal(body.get('replacementPhotoId'),photoId);
  assert.equal(body.get('replaceExisting'),'true');
});

test('the authenticated photo route forwards replacement identity without accepting a supplied owner',async()=>{
  const route=readFileSync(new URL('../app/api/dancer/photos/route.ts',import.meta.url),'utf8');
  const body=new FormData();
  body.set('file',new Blob(['synthetic']));
  body.set('replaceExisting','true');
  body.set('replacementPhotoId',` ${photoId} `);
  body.set('userId','someone-else');
  let submitted;
  const {POST}=load(route,'POST',{
    NextResponse:{json:value=>value},
    createRequestSupabaseContext:async(_request,options)=>{assert.equal(options.role,'dancer');return {client:{},user:{id:'authenticated-owner'}};},
    createAdminSupabaseClient:()=>({}),enforceDancerMediaRequestRateLimit:async()=>{},
    readBoundedFormData:async()=>body,
    moderateAndStoreDancerPhoto:async(_client,_admin,input)=>{submitted=input;return {decision:'approved'};},
    MAX_DANCR_RAW_UPLOAD_BYTES:1024,
  });
  await POST({headers:new Headers()});
  assert.equal(submitted.replacementPhotoId,photoId);
  assert.equal(submitted.userId,'authenticated-owner');
  assert.equal(submitted.replaceExisting,true);
});
