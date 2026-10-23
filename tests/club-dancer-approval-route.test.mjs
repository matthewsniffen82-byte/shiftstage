import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import {fixtureId as id} from './helpers/dancer-tap-database.mjs';
const code=ts.transpileModule(readFileSync(new URL('../app/api/venue/dancer-approvals/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(options={}) {
  const calls=[],route={};
  const admin={async rpc(name,args){calls.push({name,args});return {data:options.receipt || {venueId:id(20),dancerId:id(10),status:args.p_decision,revision:id(81),requiresNewTap:args.p_decision==='approved'},error:options.rpcError};},
    from(table){calls.push({table});const q={};for(const method of ['select','eq','in','is','order','range'])q[method]=(...args)=>{calls.push({table,method,args});return q;};
      q.then=resolve=>resolve({data:[{dancer_id:id(10),status:'pending',requested_at:'2026-10-23',revision:id(80),dancer_profiles:{id:id(10),user_id:id(1),stage_name:'Aria',city:'Vegas'}}],error:null});
      q.maybeSingle=async()=>({data:{expires_at:options.expired?'2000-01-01':'2099-01-01',nfc_tags:{status:'active'}},error:null});return q;}};
  vm.runInNewContext(code,{exports:route,Error,URL,Date,require(name){
    if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
    if(name.endsWith('/api'))return {apiError:(error,fallback)=>{const resolved=resolveApiError(error,fallback);return Response.json(resolved.body,{status:resolved.status});}};
    if(name.endsWith('api-error-policy'))return {PublicApiError};
    if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject};
    if(name.endsWith('supabase/request'))return {createRequestSupabaseContext:async()=>{if(options.noAuth)throw new PublicApiError('AUTH_REQUIRED','Sign in required.',401);return {client:admin,user:{id:id(2)}};}};
    if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>admin};
    if(name.endsWith('/auth'))return {requireActiveVenueAccount:async()=>{if(options.inactive)throw new PublicApiError('FORBIDDEN','Active venue required.',403);}};
    if(name.endsWith('venue-access'))return {requireVenueAccess:async(_db,actor,permission)=>{assert.equal(actor,id(2));assert.equal(permission,'manage_roster');if(options.staff)throw new PublicApiError('FORBIDDEN','Manager required.',403);return {venueId:id(20),role:'owner'};}};
    if(name.endsWith('venue-media-avatar'))return {venueMediaAvatar:async(_db,dancer)=>{calls.push({signed:dancer});return {url:'https://example.invalid/private-avatar'};}};
    throw Error(name);
  }});
  return {calls,async post(body={}){const response=await route.POST(new Request('https://example.invalid/api/venue/dancer-approvals',{method:'POST',body:JSON.stringify({dancerId:id(10),revision:id(80),decision:'approved',...body})}));return {status:response.status,body:await response.json(),response};},
    async get(query=''){const response=await route.GET(new Request('https://example.invalid/api/venue/dancer-approvals'+query));return {status:response.status,body:await response.json(),response};}};
}
test('approval uses server identity and club, validates receipt, and never starts a shift',async()=>{
  const h=harness(),result=await h.post({actorUserId:id(6),venueId:id(21)});
  assert.equal(result.status,200);assert.equal(result.body.requiresNewTap,true);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].name,'review_club_dancer_approval');assert.equal(h.calls[0].args.p_actor_user_id,id(2));assert.equal(h.calls[0].args.p_venue_id,id(20));
  assert.match(result.response.headers.get('cache-control'),/private, no-store/);
});
for(const option of ['noAuth','inactive','staff'])test(`${option} cannot list or review requests`,async()=>{
  const h=harness({[option]:true});assert.equal((await h.get()).status,option==='noAuth'?401:403);assert.equal((await h.post()).status,option==='noAuth'?401:403);assert.equal(h.calls.length,0);
});
test('malformed and oversized decisions do not reach the database',async()=>{
  for(const body of [{dancerId:'bad'},{revision:'bad'},{decision:'maybe'},{extra:'x'.repeat(3000)}]){const h=harness();assert.ok([400,413].includes((await h.post(body)).status));assert.equal(h.calls.length,0);}
});
test('changed requests and uncertain acknowledgments cannot report approval',async()=>{
  assert.equal((await harness({rpcError:{code:'40001',message:'private details'}}).post()).status,409);
  const wrong=await harness({receipt:{venueId:id(21)}}).post();assert.equal(wrong.status,503);assert.equal(wrong.body.ok,false);
});
test('queue reads and private photo previews are scoped to the managed club',async()=>{
  const h=harness(),result=await h.get('?offset=25&venueId='+id(21));assert.equal(result.status,200);
  assert.ok(h.calls.some(c=>c.table==='club_dancer_approvals'&&c.method==='eq'&&c.args[0]==='venue_id'&&c.args[1]===id(20)));
  assert.ok(h.calls.some(c=>c.method==='range'&&c.args[0]===25&&c.args[1]===50));assert.equal(result.body.requests[0].stageName,'Aria');
  assert.ok(!JSON.stringify(result.body).includes(id(1)));assert.ok(h.calls.some(c=>c.signed===id(10)));
  const expired=harness({expired:true});assert.equal((await expired.get()).body.requests[0].expired,true);assert.ok(!expired.calls.some(c=>c.signed));
});
