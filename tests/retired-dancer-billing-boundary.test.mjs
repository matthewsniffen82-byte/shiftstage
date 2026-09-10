import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';

const userId='00000000-0000-4000-8000-000000000001';
function harness(kind,{status='active',authError,queryError}={}){
  const calls=[];
  const client={from(table){
    assert.equal(table,'dancer_profiles','Free access must not consult legacy subscriptions');
    const q={
      select(fields){assert.equal(fields,'status');return q;},
      eq(field,value){assert.equal(field,'user_id');assert.equal(value,userId);calls.push({kind:'profile',userId:value});return q;},
      async maybeSingle(){return {data:status===null?null:{status},error:queryError||null};},
    };
    return q;
  }};
  const dependencies={
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(request,options)=>{
      calls.push({kind:'auth',url:request.url,options:options?JSON.parse(JSON.stringify(options)):null});
      if(authError)throw authError;
      return {client,user:{id:userId}};
    }},
  };
  const suffix=kind==='status'?'':kind+'/';
  const source=readFileSync(new URL('../app/api/dancer/billing/'+suffix+'route.ts',import.meta.url),'utf8');
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:name=>{
      assert.ok(Object.hasOwn(dependencies,name),'Unexpected billing dependency: '+name);
      return dependencies[name];
    },
  });
  const invoke=()=>kind==='status'
    ? exports.GET(new Request('https://example.test/api/dancer/billing?dancerId=someone-else'))
    : exports.POST(new Request('https://example.test/api/dancer/billing/'+kind,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({priceId:'price_synthetic',customerId:'cus_someone_else',dancerId:'someone-else',returnUrl:'https://outside.example/'}),
    }));
  return {invoke,calls};
}

for(const status of ['active','pending','disabled',null]){
  test('free billing summary is owner-scoped for '+String(status)+' profiles',async()=>{
    const h=harness('status',{status}),response=await h.invoke();
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,billing:{dancerStatus:status||'pending',subscription:{status:'free',currentPeriodEnd:null,hasStripeCustomer:false,hasStripeSubscription:false}}});
    assert.deepEqual(h.calls.map(c=>c.kind),['auth','profile']);
    assert.deepEqual(h.calls[0].options,{role:'dancer'});
  });
}

for(const kind of ['checkout','portal']){
  test(kind+' retains free access without using caller-supplied payment or redirect data',async()=>{
    const h=harness(kind),response=await h.invoke(),body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.ok,true);
    assert.equal(body[kind==='checkout'?'checkoutUrl':'portalUrl'],null);
    assert.match(body.message,/profiles are free/);
    assert.deepEqual(h.calls.map(c=>c.kind),['auth']);
    assert.doesNotMatch(JSON.stringify(body),/price_synthetic|cus_someone_else|outside\.example/);
  });
}

for(const kind of ['status','checkout','portal']){
  test(kind+' still rejects an unauthenticated request before any profile access',async()=>{
    const h=harness(kind,{authError:new PublicApiError('AUTH_REQUIRED','Sign in required.',401)}),response=await h.invoke();
    assert.equal(response.status,401);
    assert.equal((await response.json()).code,'AUTH_REQUIRED');
    assert.deepEqual(h.calls.map(c=>c.kind),['auth']);
  });

  test(kind+' cannot convert an auth outage into free-access success',async()=>{
    const h=harness(kind,{authError:{code:'08006',message:'Synthetic private auth-provider detail'}}),response=await h.invoke();
    assert.equal(response.status,503);
    const body=await response.json();
    assert.equal(body.ok,false);
    assert.equal(body.code,'UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body),/Synthetic|auth-provider|08006/);
    assert.deepEqual(h.calls.map(c=>c.kind),['auth']);
  });
}

test('free billing summary does not disguise a failed profile read as a pending profile',async()=>{
  const h=harness('status',{status:null,queryError:{code:'08006',message:'Synthetic private database detail'}}),response=await h.invoke();
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.ok,false);
  assert.doesNotMatch(JSON.stringify(body),/Synthetic|database detail|08006/);
});
