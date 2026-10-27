import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyNtag424 } from '../src/lib/dancr/ntag424.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { loadNfcModule, sessions, id, grantInput, grantCookie } from './helpers/internal-nfc-fixture.mjs';
const valid = { e: 'EF963FF7828658A599F3041510671E88', c: '94EED9EE65337086' };
function fixture({ status = 'active', limited = false } = {}) {
  let counter = 0;
  const tag = { id:id(40),link_id:id(1),uid:'04DE5F1EACC040',generation:id(41),status,
    encrypted_keys:sessions.sealInternalTagKeys(id(40),{adminKey:'0'.repeat(32),metaKey:'0'.repeat(32),fileKey:'0'.repeat(32)}) };
  const calls = [];
  class PublicRequestRateLimitError extends Error { retryAfterSeconds = 60; }
  const admin = {
    from(){return { select(){return this},eq(_key,value){calls.push(['read',value]);return this},async maybeSingle(){return {data:tag}} }},
    async rpc(name,args){calls.push([name,args]); if(args.p_counter<=counter)return {error:{code:'40001'}};
      counter=args.p_counter;return {data:{status:tag.status,token:id(3),link:tag.link_id,generation:tag.generation}}},
  };
  const route = loadNfcModule('app/api/internal-tap/[id]/route.ts', {
    'next/server': {NextResponse:Response}, '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
    '@/src/lib/api-error-policy':{PublicApiError,resolveApiError}, '@/src/lib/bounded-json-body':{readBoundedJsonObject},
    '@/src/lib/dancr/ntag424':{verifyNtag424}, '@/src/lib/dancr/internal-tap-session':sessions,
    '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError,enforcePublicRequestRateLimit:async()=>{if(limited)throw new PublicRequestRateLimitError();}},
  });
  const post=(body=valid,headers={})=>route.POST(new Request('https://example.invalid/api/internal-tap/'+id(40),{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)}),{params:Promise.resolve({id:id(40)})});
  return {post,calls,tag};
}
test('a verified fresh tap issues a private 10-hour cookie and a clean grid URL',async()=>{
  const f=fixture(),r=await f.post(),body=await r.json();
  assert.equal(r.status,200);assert.equal(body.href,'/internal/club/'+id(3));
  const grant=sessions.readInternalGrant(new Request('https://example.invalid',{headers:{cookie:r.headers.get('set-cookie')}}),id(3));
  assert.equal(grant.tag,id(40));assert.equal(grant.expires-grant.issued,36000);
  assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.doesNotMatch(JSON.stringify(body),/encrypted_keys|metaKey|fileKey|EF963/);
  assert.equal((await f.post()).status,403,'Same tap cannot be replayed');
});
test('a programmed staged sticker is verified without granting customer access',async()=>{
  const r=await fixture({status:'staged'}).post();assert.equal(r.status,200);
  assert.equal((await r.json()).tested,true);assert.equal(r.headers.get('set-cookie'),null);
});
test('retapping during an existing visit does not extend or replace its session',async()=>{
  const cookie=grantCookie(grantInput,Date.now()-600000), f=fixture();
  const r=await f.post(valid,{cookie});assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
  const expires=sessions.readInternalGrant(new Request('https://example.invalid',{headers:{cookie}}),id(3)).expires*1000;
  assert.equal((await r.json()).expiresAt,expires);
});
test('a fresh verified tap replaces an expired visit',async()=>{
  const r=await fixture().post(valid,{cookie:grantCookie(grantInput,Date.now()-36001000)});
  assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie'));
});
for(const [label,options,body,headers] of [
  ['wrong CMAC',{}, {...valid,c:'0'.repeat(16)},{}],['missing proof',{}, {},{}],
  ['disabled sticker',{status:'disabled'},valid,{}],['cross-origin',{},valid,{origin:'https://unrelated.invalid'}],
])test(`${label} cannot consume a counter or issue a grant`,async()=>{
  const f=fixture(options),r=await f.post(body,headers);assert.equal(r.status,403);
  assert.equal(r.headers.get('set-cookie'),null);assert.equal(f.calls.some(c=>c[0]==='consume_internal_nfc_tap'),false);
});
test('rate limiting blocks before decrypting or consuming a tap',async()=>{
  const f=fixture({limited:true}),r=await f.post();assert.equal(r.status,429);assert.equal(f.calls.length,0);assert.equal(r.headers.get('retry-after'),'60');
});
