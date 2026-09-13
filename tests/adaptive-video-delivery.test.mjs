import assert from 'node:assert/strict';
import test from 'node:test';
import { importMediaModule } from './helpers/server-media-module.mjs';
const { serveDancerMedia } = await importMediaModule('media-delivery.ts');
const id='96000000-0000-4000-8000-000000000001';
const generation='a'.repeat(32);
const manifest={version:1,generation,renditions:['360','source'].map(name=>({name,width:360,height:640,bytes:1100,initBytes:100,segments:[{duration:2,bytes:1000}]}))};
function fixture(){
 const state={visible:true,active:true,manifest:structuredClone(manifest),error:false};const calls=[],requests=[];
 const client=admin=>({from(){const q={select(){return q;},eq(){return q;},abortSignal(){return q;},async maybeSingle(){
  calls.push(admin?'admin':'public');return {error:state.error?new Error('private'):null,data:admin?{storage_path:'owner/video.mp4',moderation_details:{adaptiveStreaming:state.manifest},dancer_profiles:{disabled_at:null,app_users:{account_state:state.active?'active':'disabled'}}}:state.visible?{id}:null};
 }};return q;}});
 const deps={publicClient:client(false),admin:client(true),storageUrl:'https://private.test',serviceKey:'synthetic-test-key',fetch:async(url,options)=>{requests.push({url:String(url),options});return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 0-2/1100'}});}};
 const get=(query,options)=>serveDancerMedia(new Request('https://app.test/api/media/dancer-video?id='+id+'&'+query,options),'video',deps);
 return {state,calls,requests,get};
}
test('manifest and renditions recheck public RLS and active ownership without reading storage',async()=>{
 const f=fixture();for(const hls of ['master','360']){
  const response=await f.get('hls='+hls+'&generation='+generation);
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/mpegurl/);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
  assert.doesNotMatch(await response.text(),/owner|private.test|synthetic-test-key/);
 }
 assert.deepEqual(f.calls,['public','admin','public','admin']);assert.equal(f.requests.length,0);
});
test('segment ranges stay on the validated generation and use server credentials',async()=>{
 const f=fixture();const response=await f.get('hls=media&generation='+generation+'&rendition=360',{headers:{range:'bytes=0-2'}});
 assert.equal(response.status,206);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);
 assert.match(f.requests[0].url,new RegExp('video.mp4.hls-'+generation+'-360.mp4$'));assert.equal(f.requests[0].options.headers.range,'bytes=0-2');
 assert.equal(f.requests[0].options.redirect,'error');assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
});
test('saved master, variant and segment URLs stop working when a video becomes private or inactive',async()=>{
 for(const mode of ['master','360','media'])for(const denied of ['visible','active']){
  const f=fixture();f.state[denied]=false;const response=await f.get('hls='+mode+'&generation='+generation+'&rendition=360');
  assert.equal(response.status,404);assert.equal(f.requests.length,0);if(denied==='visible')assert.deepEqual(f.calls,['public']);
 }
});
test('invalid and obsolete generations, unknown variants, missing metadata and database failures fail closed',async()=>{
 const f=fixture();for(const query of ['hls=360&generation=obsolete','hls=../../private','hls=media&generation='+generation+'&rendition=unknown','hls=master&poster=1']){
  assert.ok([400,404].includes((await f.get(query)).status));
 }
 f.state.manifest=null;assert.equal((await f.get('hls=master')).status,404);
 f.state.error=true;assert.equal((await f.get('hls=master')).status,503);assert.equal(f.requests.length,0);
});
test('HEAD manifests return identical headers without a body or media request',async()=>{
 const f=fixture();const response=await f.get('hls=master',{method:'HEAD'});
 assert.equal(response.status,200);assert.equal(await response.text(),'');assert.ok(Number(response.headers.get('Content-Length'))>100);assert.equal(f.requests.length,0);
});
