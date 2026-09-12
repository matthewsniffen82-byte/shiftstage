import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../../src/lib/api-error-policy.ts';
import {transitionOwnAccount} from './account-lifecycle-database.mjs';
const source=readFileSync(new URL('../../src/lib/dancr/auth.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
export function accountLifecycleCaller({db,userId,response,throwResponse,afterCommit}={}) {
  const exports={},calls=[];
  vm.runInNewContext(compiled,{exports,Error,Array,require(name) {
    if(name==='server-only')return {};
    if(name==='../api-error-policy')return {PublicApiError};
    throw new Error('Unexpected account lifecycle dependency: '+name);
  }});
  const client={async rpc(name,args) {
    assert.equal(name,'transition_own_account_safely');assert.equal(args.p_user_id,userId);calls.push({name,...args});
    if(throwResponse)throw throwResponse;
    if(response)return response(args);
    let data;
    try {data=await transitionOwnAccount(db,args.p_user_id,args.p_account_state);} catch(error) {return {data:null,error};}
    return afterCommit?afterCommit(data,args):{data,error:null};
  },from(){throw new Error('Account lifecycle must not make independent database writes');},auth:{admin:new Proxy({},{get(){throw new Error('Account lifecycle must not use Auth metadata as restoration authority');}})}};
  return {calls,run:state=>exports.setAccountState(client,userId,state,client)};
}
