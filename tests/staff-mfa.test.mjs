import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/staff-mfa.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
 exports, Error, require(name){if(name==='server-only')return {};if(name==='../api-error-policy')return {PublicApiError};if(name==='qrcode')return {toDataURL:async()=> 'data:image/png;base64,synthetic'};throw Error(name);}
});
function fixture({active=true,verified=false,factors=[],rpcError=null,verifyError=null}={}){
 const calls=[];let mfaVerified=verified;
 const client={rpc:async name=>{calls.push(name);return {data:{active,mfaVerified},error:rpcError};},auth:{
  refreshSession:async()=>({data:{session:{}},error:null}),mfa:{
   enroll:async input=>{calls.push(['enroll',input]);return {data:{id:'new',type:'totp',totp:{uri:'otpauth://synthetic',secret:'synthetic'}}};},
   challengeAndVerify:async input=>{calls.push(['verify',input]);if(!verifyError)mfaVerified=true;return {error:verifyError};},
   unenroll:async input=>{calls.push(['remove',input]);return {error:null};}
  }}};
 return {client,calls,user:{id:'staff',factors},run:body=>exports.staffMfaAction(client,{id:'staff',factors},body)};
}
const factor=(id,status='verified')=>({id,status,factor_type:'totp',friendly_name:id});
test('case gate rejects password-only, revoked and unavailable checks; accepts active MFA',async()=>{
 await assert.rejects(exports.requireStaffMfa(fixture().client),e=>e.code==='MFA_REQUIRED');
 await assert.rejects(exports.requireStaffMfa(fixture({active:false,verified:true}).client),e=>e.code==='AUTH_REQUIRED');
 await assert.rejects(exports.requireStaffMfa(fixture({verified:true,rpcError:{message:'private'}}).client),e=>e.code==='UNAVAILABLE'&&!e.message.includes('private'));
 await exports.requireStaffMfa(fixture({verified:true}).client);
});
test('setup is private, duplicate pending factors are blocked, and existing MFA cannot be bypassed by adding a factor',async()=>{
 const f=fixture();const result=await f.run({action:'enroll',name:'My phone'});assert.equal(result.enrollment.id,'new');assert.equal(result.enrollment.qr,'data:image/png;base64,synthetic');
 await assert.rejects(fixture({factors:[factor('pending','unverified')]}).run({action:'enroll',name:'Second'}),e=>e.status===409);
 await assert.rejects(fixture({factors:[factor('old')]}).run({action:'enroll',name:'Attacker'}),e=>e.code==='MFA_REQUIRED');
});
test('verification checks ownership and code, never upgrades after failed verification',async()=>{
 const f=fixture({factors:[factor('own','unverified')]});
 await assert.rejects(f.run({action:'verify',factorId:'someone-else',code:'123456'}),e=>e.status===400);
 await assert.rejects(f.run({action:'verify',factorId:'own',code:'12345x'}),e=>e.status===400);
 assert.equal(f.calls.filter(c=>Array.isArray(c)).length,0);
 const failed=fixture({factors:[factor('own')],verifyError:{message:'private provider detail'}});
 await assert.rejects(failed.run({action:'verify',factorId:'own',code:'123456'}),e=>e.status===400&&!e.message.includes('private'));
 await assert.rejects(exports.requireStaffMfa(failed.client),e=>e.code==='MFA_REQUIRED');
 assert.match((await f.run({action:'verify',factorId:'own',code:'123456'})).message,/verified/);
});
test('verified factors need MFA and a replacement; unfinished factors can be discarded by their owner',async()=>{
 await assert.rejects(fixture({verified:true,factors:[factor('only')]}).run({action:'remove',factorId:'only'}),e=>e.status===409);
 await assert.rejects(fixture({factors:[factor('one'),factor('two')]}).run({action:'remove',factorId:'one'}),e=>e.code==='MFA_REQUIRED');
 const pending=fixture({factors:[factor('pending','unverified')]});await pending.run({action:'remove',factorId:'pending'});assert.ok(pending.calls.some(c=>c[0]==='remove'));
 const ready=fixture({verified:true,factors:[factor('one'),factor('two')]});await ready.run({action:'remove',factorId:'one'});assert.ok(ready.calls.some(c=>c[0]==='remove'));
});
