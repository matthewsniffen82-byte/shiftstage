import assert from 'node:assert/strict';
import test from 'node:test';
import { importMediaModule } from './helpers/server-media-module.mjs';
const { serveDancerMedia } = await importMediaModule('media-delivery.ts');
const { dancerPhotoDeliveryUrl, dancerVideoDeliveryUrl, mediaPreviewToken, verifyMediaPreview } = await importMediaModule('media-delivery-url.ts');
const { responsivePublicImage } = await importMediaModule('responsive-image.ts');
process.env.DANCR_ACCOUNT_RECOVERY_SECRET = 'synthetic-media-test-secret-not-a-credential';
const id='96000000-0000-4000-8000-000000000001';
const path='owner/photo.r320-480.m900x1200.f50x50.jpg';
function fixture() {
  const state={public:true,active:true,photo:true,avatar:false,video:true,error:false};const queries=[],requests=[];
  const profile=()=>({id,disabled_at:state.active?null:'2026-09-12',app_users:{account_state:state.active?'active':'disabled'}});
  const client=privileged=>({from(table){const calls=[];const q=new Proxy({then(resolve){
    queries.push({privileged,table,calls});let data=null;
    if(privileged||state.public){if(table==='dancer_photos'&&state.photo)data={storage_path:path,dancer_profiles:profile()};if(table==='dancer_profiles'&&state.avatar)data=profile();if(table==='mydancr_tv_videos'&&state.video)data={id,storage_path:'owner/video.mp4',moderation_details:{posterStoragePath:'tv-posters/owner/video.poster.webp'},dancer_profiles:profile()};}
    resolve({data,error:state.error?new Error('private provider diagnostic'):null});
  }},{get:(t,k)=>t[k]||((...args)=>{calls.push([k,...args]);return q;})});return q;}});
  const deps={publicClient:client(false),admin:client(true),storageUrl:'https://storage.example.test',serviceKey:'synthetic-server-key',fetch:async(url,options)=>{
    requests.push({url:String(url),options});const video=String(url).includes('/mydancr-tv-videos/');const range=options.headers.range;
    return new Response(options.method==='HEAD'?null:Uint8Array.from([1,2,3]),{status:range?206:200,headers:{'content-type':video?'video/mp4':'image/webp','content-length':'3','accept-ranges':'bytes',...(range?{'content-range':'bytes 0-2/30'}:{}),'cache-control':'public,max-age=31536000','x-secret-provider-diagnostic':'must-not-leak'}});
  }};
  const get=(kind,url,options={})=>serveDancerMedia(new Request(url,options),kind,deps);
  return{state,queries,requests,deps,get};
}
async function consume(response){await response.arrayBuffer();return response;}

test('public photo URL follows disable and reactivation without altering media',async()=>{
 const f=fixture(),url=dancerPhotoDeliveryUrl(path);
 assert.equal((await consume(await f.get('photo',url))).status,200);
 f.state.public=false;f.state.active=false;
 assert.equal((await f.get('photo',url)).status,404);assert.equal(f.requests.length,1);
 f.state.public=true;f.state.active=true;
 assert.equal((await consume(await f.get('photo',url))).status,200);
 assert.ok(f.queries.every(q=>!q.privileged));
});
test('public avatars, stored variants and transformed thumbnails preserve their exact authorized source',async()=>{
 const f=fixture();f.state.photo=false;f.state.avatar=true;
 const response=await consume(await f.get('photo',dancerPhotoDeliveryUrl(path+'.w320.webp',96)));
 assert.equal(response.status,200);assert.match(f.requests[0].url,/render\/image\/authenticated\/dancer-photos/);
 assert.equal(new URL(f.requests[0].url).searchParams.get('width'),'96');
 assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path+'.w640.webp'))).status,404);
});
test('unpublished uploads need an unforgeable scoped preview and a currently active owner account',async()=>{
 const f=fixture();f.state.public=false;
 assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path))).status,404);
 const preview=dancerPhotoDeliveryUrl(path,undefined,true);
 assert.equal((await consume(await f.get('photo',preview))).status,200);
 assert.equal((await f.get('photo',preview.replace('path=owner','path=other'))).status,404);
 f.state.active=false;
 assert.equal((await f.get('photo',preview)).status,404);
 f.state.active=true;assert.equal((await consume(await f.get('photo',preview))).status,200);
});
test('preview capabilities expire, cannot change purpose/resource, and contain no provider key',()=>{
 const now=Date.now(),token=mediaPreviewToken('photo:'+path,now);
 assert.equal(verifyMediaPreview(token,'photo:'+path,now),true);
 for(const [t,r,time]of[[token,'video:'+id,now],[token,'photo:other',now],[token+'x','photo:'+path,now],[token,'photo:'+path,now+3600000]])assert.equal(verifyMediaPreview(t,r,time),false);
 assert.ok(!token.includes(process.env.DANCR_ACCOUNT_RECOVERY_SECRET));
});
test('video playback, poster and byte ranges follow public RLS and current account state',async()=>{
 const f=fixture();const video=dancerVideoDeliveryUrl(id),poster=dancerVideoDeliveryUrl(id,true);
 const response=await consume(await f.get('video',video,{headers:{range:'bytes=0-2',authorization:'Bearer untrusted-browser-value'}}));
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-2/30');
 assert.equal(f.requests[0].options.headers.authorization,'Bearer synthetic-server-key');
 assert.equal((await consume(await f.get('video',poster))).status,200);
 f.state.active=false;assert.equal((await f.get('video',video)).status,404);
 f.state.public=false;f.state.active=true;assert.equal((await f.get('video',video)).status,404);
 f.state.public=true;assert.equal((await consume(await f.get('video',video))).status,200);
});
test('authorized video previews do not bypass paused accounts or expose Storage signed URLs',async()=>{
 const f=fixture();f.state.public=false;const url=dancerVideoDeliveryUrl(id,false,true);
 assert.equal((await consume(await f.get('video',url))).status,200);
 f.state.active=false;assert.equal((await f.get('video',url)).status,404);
 assert.ok(!url.includes('/storage/'));assert.ok(!url.includes('owner/video.mp4'));
});

test('retired HLS requests cannot download the original video as a playlist',async()=>{
 const f=fixture();
 for(const mode of ['master','360','media']){
  const response=await f.get('video',dancerVideoDeliveryUrl(id)+'&hls='+mode);
  assert.equal(response.status,404);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
 }
 assert.equal(f.requests.length,0,'obsolete playlist requests never fetch storage bytes');
 const mp4=await consume(await f.get('video',dancerVideoDeliveryUrl(id),{headers:{range:'bytes=0-2'}}));
 assert.equal(mp4.status,206);
 assert.equal(mp4.headers.get('content-type'),'video/mp4');
});
test('all media responses including HEAD and errors prevent browser/CDN reuse',async()=>{
 const f=fixture();
 for(const response of [await f.get('photo',dancerPhotoDeliveryUrl(path),{method:'HEAD'}),await f.get('photo','https://app.example/api/media/dancer-photo?path=../private')]){
   assert.match(response.headers.get('cache-control'),/private, no-store/);
   assert.equal(response.headers.get('cdn-cache-control'),'no-store');assert.equal(response.headers.get('vercel-cdn-cache-control'),'no-store');
   assert.equal(response.headers.get('x-secret-provider-diagnostic'),null);assert.equal(await response.text(),'');
 }
});
test('traversal, URL injection, unsupported transforms/ranges and private object prefixes cannot reach storage',async()=>{
 const f=fixture();for(const path of ['../object','/owner/file','owner//file','owner/./file','https://evil.example/file','owner\\file','owner/file?token=x'])assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path))).status,400);
 assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path,999))).status,400);
 assert.equal((await f.get('video',dancerVideoDeliveryUrl(id),{headers:{range:'bytes=0-2,4-5'}})).status,416);
 f.state.photo=false;f.state.avatar=false;
 assert.equal((await f.get('photo',dancerPhotoDeliveryUrl('__originals/owner/private.jpg'))).status,404);
 assert.equal(f.requests.length,0);
});
test('database and Storage outages fail closed without disclosing provider responses',async()=>{
 const f=fixture();f.state.error=true;const response=await f.get('photo',dancerPhotoDeliveryUrl(path));assert.equal(response.status,503);assert.equal(await response.text(),'');assert.equal(f.requests.length,0);
 f.state.error=false;f.deps.fetch=async()=>new Response('private storage diagnostic',{status:500});assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path))).status,503);
});
test('streaming preserves bytes, bounds size and rejects unexpected active content',async()=>{
 const f=fixture();assert.deepEqual([...new Uint8Array(await(await f.get('photo',dancerPhotoDeliveryUrl(path))).arrayBuffer())],[1,2,3]);
 f.deps.fetch=async()=>new Response('html',{headers:{'content-type':'text/html'}});assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path))).status,404);
 f.deps.fetch=async()=>new Response('x',{headers:{'content-type':'image/webp','content-length':String(11*1024*1024)}});assert.equal((await f.get('photo',dancerPhotoDeliveryUrl(path))).status,404);
});
test('all dancer image sizes route through visibility checks while venue artwork retains its delivery',()=>{
 const client={storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'https://venue.example/art'}})})}};
 const photo=responsivePublicImage(client,'dancer-photos',path);
 assert.match(photo.masterImageUrl,/\/api\/media\/dancer-photo\?/);assert.match(photo.imageSrcSet,/width=96/);
 assert.equal(responsivePublicImage(client,'dancer-photos','https://external.example/image'),null);
 assert.equal(responsivePublicImage(client,'venue-logo-images','logo.jpg').imageUrl,'https://venue.example/art');
});
