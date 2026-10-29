import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
const code=ts.transpileModule(readFileSync('src/lib/dancr/dancer-media-editor.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api={};vm.runInNewContext(code,{exports:api,Error,require:name=>name==='../api-error-policy'?{PublicApiError}:{}});
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const request=venue=>new Request('https://fixture.invalid/api/dancer/photos',{headers:venue?{'x-dancer-media-venue':venue}:{}});
test('editor validates selected club and accepts only the server-approved context',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{venueId:a,onboarding:false}};}};
 assert.equal((await api.dancerMediaEditor(db,'actor',request(a))).venueId,a);assert.equal(calls[0].args.p_actor,'actor');assert.equal(calls[0].args.p_venue,a);
 await assert.rejects(api.dancerMediaEditor(db,'actor',request('invalid')),e=>e.status===400);assert.equal(calls.length,1);
 await assert.rejects(api.dancerMediaEditor({rpc:async()=>({error:{code:'40001'}})},'actor',request(b)),e=>e.status===409);
});
test('off-shift writes require a club, initial onboarding keeps the existing submission flow',async()=>{
 const db=onboarding=>({rpc:async()=>({data:{venueId:null,onboarding,clubs:[]}})});
 await assert.rejects(api.dancerMediaEditor(db(false),'actor',request()),e=>e.status===400);
 assert.equal((await api.dancerMediaEditor(db(false),'actor',request(),true)).venueId,null);
 assert.equal((await api.dancerMediaEditor(db(true),'actor',request())).onboarding,true);
});
test('club replacements add a reviewed version without overwriting the global original',async()=>{
 const ctx={venueId:a};const db={rpc:async()=>({data:[{venueId:a,kind:'photo',id:'review',photoId:'original'}]})};
 const input={isPrimary:true,replacementPhotoId:'original',replaceExisting:true,sortOrder:0};
 const result=await api.clubPhotoInput(db,'actor',ctx,input);
 assert.equal(result.editorVenueId,a);assert.equal(result.editorIsMain,true);assert.equal(result.editorReplacesPhotoId,'original');
 assert.equal(result.replaceExisting,false);assert.equal(result.isPrimary,false);assert.equal(result.replacementPhotoId,undefined);
 assert.equal(input.replaceExisting,true);
 await assert.rejects(api.clubPhotoInput(db,'actor',ctx,{...input,editorVenueId:b}),e=>e.status===409);
 await assert.rejects(api.clubPhotoInput(db,'actor',ctx,{...input,replacementPhotoId:'other'}),e=>e.status===403);
 assert.equal(await api.clubPhotoInput(db,'actor',{venueId:null},input),input);
});
test('hidden and other-club media cannot be mutated; removal reports the scoped receipt',async()=>{
 const db={rpc:async()=>({data:[{id:'hidden',venueId:a,kind:'photo',hidden:true},{id:'other',venueId:b,kind:'photo'}]})};
 for(const id of ['hidden','other'])await assert.rejects(api.assertEditorMedia(db,'actor',{venueId:a},'photo',id),e=>e.status===403);
 let args;const edited=await api.editClubMedia({rpc:async(_name,a)=>{args=a;return{data:{clubOnly:true}};}},'actor',{venueId:a},'photo','original','remove');
 assert.equal(args.p_venue,a);assert.equal(edited.deletedIds[0],'original');assert.equal(edited.clubOnly,true);
});
