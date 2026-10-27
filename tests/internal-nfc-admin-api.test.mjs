import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNfcModule, sessions, id } from './helpers/internal-nfc-fixture.mjs';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { ntag424Programming } from '../src/lib/dancr/ntag424.ts';

function fixture({ authorized=true, tag=true, verified=false }={}) {
 const keys={adminKey:'1'.repeat(32),metaKey:'2'.repeat(32),fileKey:'3'.repeat(32)};
 const tables={internal_roster_links:[{id:id(1),token:id(3),venue_id:id(2),kind:'table',active:true,label:'Table 1'}],
  internal_nfc_tags:tag?[{id:id(40),link_id:id(1),uid:'04DE5F1EACC040',generation:id(41),status:'staged',verified_at:verified?'2026-01-01':null,encrypted_keys:sessions.sealInternalTagKeys(id(40),keys)}]:[]};
 const admin={from(name){let rows=[...tables[name]], columns='',patch=null;
  const finish=async single=>{if(patch)rows.forEach(row=>Object.assign(row,patch));const data=rows.map(row=>columns==='*'?row:Object.fromEntries(columns.split(',').filter(key=>key in row).map(key=>[key,row[key]])));return {data:single?data[0]||null:data};};
  const q={select(value){columns=value;return q},eq(key,value){rows=rows.filter(row=>row[key]===value);return q},order(){return q},
   update(value){patch=value;return q},async insert(value){tables[name].push({...value,status:'staged',generation:id(41),verified_at:null});return {error:null}},
   maybeSingle(){return finish(true)},then(resolve,reject){return finish(false).then(resolve,reject)}};return q;
 }};
 const route=loadNfcModule('app/api/admin/venues/internal-nfc/route.ts',{
  'next/server':{NextResponse:Response},'@/src/lib/api-error-policy':{PublicApiError,resolveApiError},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:admin,user:{id:id(5)},session:{}})},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>{if(!authorized)throw new PublicApiError('FORBIDDEN','Admin required.',403)}},
  '@/src/lib/dancr/public-app-url':{publicAppUrl:()=> 'https://www.mydancr.com'},
  '@/src/lib/dancr/ntag424':{ntag424Programming},'@/src/lib/dancr/internal-tap-session':sessions,
 });
 return {tables,keys,get:()=>route.GET(new Request('https://example.invalid/api/admin/venues/internal-nfc?venueId='+id(2))),
  post:(body={},origin='https://example.invalid')=>route.POST(new Request('https://example.invalid/api/admin/venues/internal-nfc',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({venueId:id(2),linkId:id(1),generation:id(41),...body})}))};
}
test('only an administrator may inspect or change provisioning',async()=>{
 const f=fixture({authorized:false});assert.equal((await f.get()).status,403);assert.equal((await f.post({action:'settings'})).status,403);
});
test('ordinary admin inventory responses do not contain key material',async()=>{
 const f=fixture(),r=await f.get();assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/encrypted_keys|adminKey|metaKey|fileKey/);
});
test('provisioning requires a valid UID and encrypts keys, with idempotent preparation retries',async()=>{
 const f=fixture({tag:false});assert.equal((await f.post({action:'prepare',uid:'not a uid'})).status,400);
 const first=await f.post({action:'prepare',uid:'04:DE:5F:1E:AC:C0:40'});assert.equal(first.status,200);
 const settings=(await first.json()).programming;
 assert.equal(settings.uid,'04DE5F1EACC040');assert.equal(settings.adminKey.length,32);
 assert.ok(f.tables.internal_nfc_tags[0].encrypted_keys);assert.equal(f.tables.internal_nfc_tags[0].adminKey,undefined);
 const retry=await f.post({action:'prepare',uid:'04DE5F1EACC040'});assert.deepEqual((await retry.json()).programming,settings);
 assert.equal(f.tables.internal_nfc_tags.length,1);
});
test('activation requires verification and stale admin actions cannot overwrite a new generation',async()=>{
 const untested=fixture();assert.equal((await untested.post({action:'activate'})).status,409);
 const f=fixture({verified:true});assert.equal((await f.post({action:'activate'})).status,200);
 assert.equal(f.tables.internal_nfc_tags[0].status,'active');assert.notEqual(f.tables.internal_nfc_tags[0].generation,id(41));
 assert.equal((await f.post({action:'disable'})).status,409);
});
test('disabled sticker generations revoke existing grants',async()=>{
 const f=fixture({verified:true});assert.equal((await f.post({action:'disable'})).status,200);
 assert.equal(f.tables.internal_nfc_tags[0].status,'disabled');assert.notEqual(f.tables.internal_nfc_tags[0].generation,id(41));
});
test('preview grants carry an actor and cannot be retargeted across clubs',async()=>{
 const f=fixture();assert.equal((await f.post({action:'preview',venueId:id(99)})).status,404);
 const r=await f.post({action:'preview'});assert.equal(r.status,200);
 const grant=sessions.readInternalGrant(new Request('https://example.invalid',{headers:{cookie:r.headers.get('set-cookie')}}),id(3));
 assert.equal(grant.actor,id(5));assert.equal(grant.tag,null);assert.equal(grant.link,id(1));
});
test('cross-origin mutations cannot reveal programming settings',async()=>{
 const r=await fixture().post({action:'settings'},'https://unrelated.invalid');assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/adminKey|metaKey|fileKey/);
});
