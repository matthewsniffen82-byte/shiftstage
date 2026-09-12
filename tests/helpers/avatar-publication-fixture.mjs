import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../../src/lib/api-error-policy.ts';
import * as serverJobs from '../../src/lib/server-job.ts';
import {loadGalleryGateway} from './gallery-publication-fixture.mjs';
const compile=(source,deps)=>{
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,console:{log(){},warn(){},error(){},info(){}},Date,Buffer,process,Map,Set,setTimeout,clearTimeout,require:()=>({PublicApiError,...serverJobs,...deps})});return exports;
};
export function loadAvatarGateway(){
 return compile(readFileSync(new URL('../../src/lib/dancr/avatar-publication.ts',import.meta.url),'utf8'),loadGalleryGateway());
}
export function loadAvatarCaller(path,deps={},baseline=false){
 const source=baseline?execFileSync('git',['show','ab90b36f78cf589b2a89711498d920d0ed19b079:'+path],{encoding:'utf8',windowsHide:true}):readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 const extra=path.endsWith('image-moderation.ts')?'\nObject.assign(exports,{approveModeratedUpload,updateModerationRecord,moderationRecordToUploadResponse'+(baseline?',setApprovedDancerAvatar':'')+'});':path.endsWith('admin/image-moderation/route.ts')?'\nObject.assign(exports,{approveReviewRecord,rejectReviewRecord});':path.endsWith('cron/image-moderation/route.ts')?'\nObject.assign(exports,{claimRetryRecord});':'';
 return compile(source+extra,{...loadGalleryGateway(),...loadAvatarGateway(),PROFILE_AVATAR_CONTEXT:'profile_avatar',isProfileAvatarUploadContext:v=>v==='profile_avatar',
  safeErrorMetadata:()=>({code:'synthetic'}),ACTIVE_IMAGE_MODERATION_STATUSES:['moderating','pending_review'],...deps});
}
