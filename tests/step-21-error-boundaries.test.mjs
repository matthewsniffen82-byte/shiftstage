import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';
import {passwordValidationMessage} from '../src/lib/dancr/password-policy.ts';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const privateMessage='Synthetic private database /srv/secret/file.ts token=private-canary';
const sourceCache=new Map();
function compile(path,dependencies,logs){
  if(!sourceCache.has(path))sourceCache.set(path,ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
  const exports={};
  vm.runInNewContext(sourceCache.get(path),{exports,Error,URL,Request,Response,Buffer,
    console:{error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args),info(){}},
    require:name=>dependencies[name]||{},
  });
  return exports;
}
function api(logs){return {PublicApiError,apiError(error,fallback,status){
  const r=resolveApiError(error,fallback,status);
  if(r.shouldLog)logs.push(['API_REQUEST_FAILED',safeErrorMetadata(error)]);
  return Response.json(r.body,{status:r.status});
}};}
const validInput={loginEmail:'manager@example.test',password:'Synthetic1!',confirmPassword:'Synthetic1!',venueName:'Synthetic Club',streetAddress:'123 Test Street',city:'Las Vegas',state:'NV',postalCode:'89101',contactName:'Test Manager',contactTitle:'Owner',contactPhone:'702-555-0123',authorizedToRepresentVenue:true};
function venueHarness(options={}){
  const logs=[],events=[],removed=[],writes=[];
  const client={auth:{admin:{
    async createUser(){events.push('create');if('createThrow' in options)throw options.createThrow;
      return {data:{user:options.missingUser?null:{id:id(1),app_metadata:{mydancr_provisioned_role:'venue'}}},error:options.createError||null};},
    async deleteUser(user){removed.push(user);return {error:null};},
  }},from(table){let inserted;
    const q={select(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},
      async gte(){return {count:0,error:null};},async maybeSingle(){return {data:null,error:null};},
      update(row){writes.push({table,row});return q;},delete(){return q;},
      insert(row){inserted=row;writes.push({table,row});return q;},
      async single(){return {data:{id:id(2),...inserted,submitted_at:'2026-09-10T00:00:00Z'},error:null};},
      then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject);},
    };return q;
  }};
  const manager=compile('src/lib/dancr/venue-request-account.ts',{
    './password-policy':{passwordValidationMessage},
    './account-provisioning':{async provisionAppAccount(){events.push('provision');if(options.provisionError)throw options.provisionError;}},
    '../security/safe-error-metadata':{safeErrorMetadata},
  },logs);
  const rate={async enforcePublicRequestRateLimit(){events.push('limit');},PublicRequestRateLimitError:class extends Error{}};
  const service=compile('src/lib/dancr/venue-signup-requests.ts',{
    './venue-request-account':manager,'./venue-claims':{hashVenueClaimRequestIp:()=> 'synthetic-hash'},
    './public-request-rate-limit':rate,'../security/safe-error-metadata':{safeErrorMetadata},
  },logs);
  const route=compile('app/api/venue/signup-requests/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':api(logs),
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
    '@/src/lib/dancr/venue-signup-requests':service,
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},
    '@/src/lib/security/request-client-address':{requestClientAddress:()=> 'unknown'},
    '@/src/lib/dancr/venue-email-confirmation':{async sendVenueRequestConfirmation(){events.push('email');return {delivered:true};}},
    '@/src/lib/dancr/public-request-rate-limit':rate,
  },logs);
  return {logs,events,removed,writes,async send(patch={}){
    const response=await route.POST(new Request('https://example.test/api/venue/signup-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...validInput,...patch})}));
    return {status:response.status,body:await response.json()};
  }};
}
for(const [name,error,status] of [
  ['plain exception',new Error(privateMessage),500],
  ['database connection exception',Object.assign(new Error(privateMessage),{code:'08006'}),503],
  ['provider unavailable',Object.assign(new Error(privateMessage),{status:503}),503],
  ['forged public name',Object.assign(new Error(privateMessage),{name:'VenueRequestAccountUserError'}),500],
  ['database object',{code:'23514',message:privateMessage,details:'private-canary'},500],
  ['non-Error rejection',privateMessage,500],
])test('venue signup keeps '+name+' private across the actual handler and manager',async()=>{
  const h=venueHarness({createThrow:error}),r=await h.send();
  assert.equal(r.status,status);assert.equal(r.body.ok,false);
  assert.doesNotMatch(JSON.stringify([r.body,h.logs]),/private-canary|Synthetic private|\/srv\/secret/);
  assert.equal(h.writes.length,0);assert.equal(h.removed.length,0);
  assert.deepEqual(h.events,['limit','limit','create']);
  if(status===503)assert.equal(r.body.code,'UNAVAILABLE');
});
for(const patch of [
  {password:'short',confirmPassword:'short'},
  {confirmPassword:'different'},
  {password:'A1!'+ 'x'.repeat(1024),confirmPassword:'A1!'+ 'x'.repeat(1024)},
  {loginEmail:'invalid'},
])test('venue signup retains actionable local credential validation '+Object.keys(patch).join('/'),async()=>{
  const h=venueHarness(),r=await h.send(patch);assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_REQUEST');
  assert.match(r.body.error,/password|capital letter|valid manager login email/i);
  assert.equal(h.events.includes('create'),false);assert.equal(h.writes.length,0);
});
for(const options of [{createError:new Error(privateMessage)},{missingUser:true},{provisionError:new Error(privateMessage)}])test('venue signup preserves safe account-setup feedback and compensation '+Object.keys(options)[0],async()=>{
  const h=venueHarness(options),r=await h.send();assert.equal(r.status,400);
  assert.match(r.body.error,/Unable to (create|set up)/);
  assert.doesNotMatch(JSON.stringify([r.body,h.logs]),/private-canary|Synthetic private/);
  assert.deepEqual(h.removed,options.provisionError?[id(1)]:[]);
  assert.equal(h.events.includes('email'),false);
});
test('venue signup success still saves the request and sends its confirmation',async()=>{
  const h=venueHarness(),r=await h.send();assert.equal(r.status,201);assert.equal(r.body.emailDelivered,true);
  assert.equal(r.body.requiresEmailConfirmation,true);assert.equal(r.body.request.id,id(2));
  assert.equal(h.removed.length,0);assert.deepEqual(h.events,['limit','limit','create','provision','email']);
  const saved=h.writes.find(w=>w.table==='venue_signup_requests').row;
  assert.equal(saved.requester_user_id,id(1));assert.equal(Object.hasOwn(saved,'password'),false);
});

function adminHarness(kind,stage,error,options={}){
  const logs=[],calls=[],effects=[];
  const client={from(table){let action='select',filters=[];
    const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},in(){return q;},
      delete(){action='delete';return q;},insert(){action='insert';return q;},
      async maybeSingle(){return result();},then(resolve,reject){return Promise.resolve().then(result).then(resolve,reject);},
    };
    function result(){
      calls.push({table,action,filters});
      if(table==='app_users')return {data:{id:id(3),role:options.customer?'customer':'admin',account_state:'active'},error:null};
      if(table==='dancer_photos'||table==='social_links'){
        assert.deepEqual(filters,[['id',id(10)],['dancer_id',id(1)]]);
        if(action==='delete'){effects.push('delete');return {data:[{id:id(10)}],error:null};}
        return {data:{id:id(10),dancer_id:id(1),storage_path:'synthetic/photo.jpg',platform:'instagram',handle:'synthetic'},error:null};
      }
      if(table==='approval_reviews')return {error:stage==='review'?error:null};
      if(table==='image_moderation_records')return action==='select'
        ? {data:stage==='lookup'?null:[{id:id(11),temporary_storage_path:null}],error:stage==='lookup'?error:null}
        : {error:stage==='moderation'?error:null};
      if(table==='admin_actions'){effects.push('audit');if(stage==='auditThrow')throw error;return {error:stage==='audit'?error:null};}
      throw Error('Unexpected table '+table);
    }return q;
  }};
  const library=compile('src/lib/dancr/admin.ts',{
    '../api-error-policy':{PublicApiError},'../security/safe-error-metadata':{safeErrorMetadata},
    './primary-photo':{async ensureDancerPrimaryPhoto(){effects.push('primary');return null;}},
    './gallery-storage-retirement':{async tryRetireGalleryStorageFiles(){effects.push('retire');return 'retired';}},
  },logs);
  const suffix=kind==='photo'?'photos/[photoId]':'social-links/[socialId]';
  const route=compile('app/api/admin/dancers/[id]/'+suffix+'/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':api(logs),
    '@/src/lib/dancr/admin':{...library,async getAdminDancerDetail(){return {id:id(1)};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/supabase/request':{async createRequestSupabaseContext(){if(options.noAuth)throw new Error('Sign in required.');return {client,user:{id:id(3)},session:null};}},
  },logs);
  return {logs,calls,effects,async send(){const response=await route.DELETE(new Request('https://example.test/admin',{method:'DELETE'}),{params:Promise.resolve({id:id(1),photoId:id(10),socialId:id(10)})});return {status:response.status,body:await response.json()};}};
}
for(const kind of ['photo','social'])for(const stage of kind==='photo'?['review','lookup','moderation','audit','auditThrow']:['review','audit','auditThrow'])for(const shape of ['Error','database'])test(kind+' cleanup '+stage+' conceals '+shape+' details without undoing the deletion',async()=>{
  const error=shape==='Error'?Object.assign(new Error(privateMessage),{code:'08006'}):{message:privateMessage,code:'08006',details:privateMessage,hint:privateMessage};
  const h=adminHarness(kind,stage,error),r=await h.send();
  assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.deleted.id,id(10));
  assert.equal(r.body.deleted.warnings.length,1);assert.match(r.body.deleted.warnings[0],/failed/i);
  assert.doesNotMatch(JSON.stringify([r.body,h.logs]),/private-canary|Synthetic private|\/srv\/secret/);
  assert.ok(h.logs.some(row=>row[1]?.code==='08006'),'Operational error code remains available internally');
  assert.deepEqual(h.effects,kind==='photo'?['delete','primary','retire','audit']:['delete','audit']);
});
for(const kind of ['photo','social']){
  test(kind+' cleanup success keeps its normal response',async()=>{
    const h=adminHarness(kind,null,null),r=await h.send();assert.equal(r.status,200);assert.deepEqual(r.body.deleted.warnings,[]);
  });
  for(const [option,status] of [['noAuth',401],['customer',403]])test(kind+' cleanup retains '+option+' denial',async()=>{
    const h=adminHarness(kind,null,null,{[option]:true}),r=await h.send();assert.equal(r.status,status);assert.equal(h.effects.length,0);
    assert.equal(h.calls.some(c=>c.table!=='app_users'),false);
  });
}
