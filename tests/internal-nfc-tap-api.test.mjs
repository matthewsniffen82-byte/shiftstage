import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv } from 'node:crypto';
import { aesCmac, verifyNtag424 } from '../src/lib/dancr/ntag424.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { loadNfcModule, sessions, id, grantInput, grantCookie } from './helpers/internal-nfc-fixture.mjs';
const valid = { e: 'EF963FF7828658A599F3041510671E88', c: '94EED9EE65337086' };
function fixture({ status = 'active', limited = false } = {}) {
  let now = Date.now();
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
    '@/src/lib/dancr/ntag424':{verifyNtag424}, '@/src/lib/dancr/internal-tap-session':{...sessions,createInternalGrant:input=>sessions.createInternalGrant(input,now)},
    '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError,enforcePublicRequestRateLimit:async()=>{if(limited)throw new PublicRequestRateLimitError();}},
  });
  const post=(body=valid,headers={})=>route.POST(new Request('https://example.invalid/api/internal-tap/'+id(40),{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)}),{params:Promise.resolve({id:id(40)})});
  return {post,calls,tag,advance:milliseconds=>{now+=milliseconds},now:()=>now};
}

function freshProof(counter) {
  const key=Buffer.alloc(16),plain=Buffer.alloc(16);
  plain[0]=0xc7;Buffer.from('04DE5F1EACC040','hex').copy(plain,1);plain.writeUIntLE(counter,8,3);
  const cipher=createCipheriv('aes-128-cbc',key,Buffer.alloc(16));cipher.setAutoPadding(false);
  const e=Buffer.concat([cipher.update(plain),cipher.final()]).toString('hex');
  const sessionKey=aesCmac(key,Buffer.concat([Buffer.from('3cc300010080','hex'),plain.subarray(1,11)]));
  const c=Buffer.from(aesCmac(sessionKey,Buffer.alloc(0)).filter((_,i)=>i%2===1)).toString('hex');
  return {e,c};
}
const readCookie=(cookie,now)=>sessions.readInternalGrant(new Request('https://example.invalid',{headers:{cookie}}),id(3),now);

test('a verified fresh tap issues a private one-hour cookie and a clean grid URL',async()=>{
  const f=fixture(),r=await f.post(),body=await r.json();
  assert.equal(r.status,200);assert.equal(body.href,'/internal/club/'+id(3));
  const grant=sessions.readInternalGrant(new Request('https://example.invalid',{headers:{cookie:r.headers.get('set-cookie')}}),id(3));
  assert.equal(grant.tag,id(40));assert.equal(grant.expires-grant.issued,3600);
  assert.match(r.headers.get('set-cookie'),/Max-Age=3600;/);
  assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.doesNotMatch(JSON.stringify(body),/encrypted_keys|metaKey|fileKey|EF963/);
  assert.equal((await f.post()).status,403,'Same tap cannot be replayed');
});
test('a programmed staged sticker is verified without granting customer access',async()=>{
  const r=await fixture({status:'staged'}).post();assert.equal(r.status,200);
  assert.equal((await r.json()).tested,true);assert.equal(r.headers.get('set-cookie'),null);
});
test('each fresh tap restarts only that customer’s hour and a replay cannot renew it',async()=>{
  const f=fixture();
  const first=await f.post(valid),cookieA=first.headers.get('set-cookie');
  const firstGrant=readCookie(cookieA,f.now());
  f.advance(600000);
  const second=await f.post(freshProof(62)),cookieB=second.headers.get('set-cookie');
  const secondGrant=readCookie(cookieB,f.now());
  f.advance(600000);
  const renewed=await f.post(freshProof(63),{cookie:cookieA}),renewedCookie=renewed.headers.get('set-cookie');
  const renewedGrant=readCookie(renewedCookie,f.now());
  assert.equal(renewed.status,200);
  assert.equal(renewedGrant.issued,Math.floor(f.now()/1000));
  assert.equal(renewedGrant.expires,firstGrant.expires+1200);
  assert.equal(renewedGrant.expires-renewedGrant.issued,3600);
  assert.equal((await renewed.json()).expiresAt,renewedGrant.expires*1000);
  assert.equal(readCookie(cookieB,f.now()).expires,secondGrant.expires,'another phone keeps its original deadline');
  f.advance(600000);
  const replay=await f.post(freshProof(63),{cookie:renewedCookie});
  assert.equal(replay.status,403);assert.equal(replay.headers.get('set-cookie'),null);
  assert.equal(readCookie(renewedCookie,f.now()).expires,renewedGrant.expires);
  assert.equal(readCookie(cookieB,secondGrant.expires*1000),null);
  assert.ok(readCookie(renewedCookie,secondGrant.expires*1000),'renewed visitor still has access when the other visitor expires');
});
test('a fresh verified tap replaces an expired visit',async()=>{
  const r=await fixture().post(valid,{cookie:grantCookie(grantInput,Date.now()-3601000)});
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
