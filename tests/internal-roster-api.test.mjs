import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import {safeSocialProfileUrl} from '../src/lib/dancr/social-profile-url.ts';
import {verifiedVenueLogoUrl} from '../src/lib/dancr/venue-branding.ts';
import {MYDANCR_TV_POSTER_BUCKET,myDancrTvPosterStoragePath} from '../src/lib/dancr/media-watermark.ts';
const id=n=>'98000000-0000-4000-8000-'+String(n).padStart(12,'0');
const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const responsive={};
vm.runInNewContext(compile('src/lib/dancr/responsive-image.ts'),{exports:responsive,require:()=>({})});
const {responsiveImageStoragePaths}=responsive;
function fixture({members=true,active=true,staff=true,kind='table',choice=null,photoStatus='approved',requests=[],shifts=[],videos=[],photoPath='PRIVATE STORAGE',upstreamHeaders={},upstreamStatus=200}={}){
 const calls=[];
 const tables={
  internal_roster_links:[{id:id(1),venue_id:id(2),token:id(3),active,kind,label:'Table 4'}],
  venues:[{id:id(2),name:'Synthetic club',slug:'talk-of-the-town',logo_storage_path:null,owner_user_id:id(4),is_active:true}],
  app_users:[{id:id(4),role:'venue',account_state:'active'}],
  dancer_profiles:[{id:id(5),stage_name:'Aster',city:'Las Vegas',real_name:'PRIVATE NAME',email:'PRIVATE EMAIL',is_public:false}],
  dancer_photos:[{id:id(6),dancer_id:id(5),storage_path:photoPath,review_status:photoStatus,is_primary:true,is_pinned:false,sort_order:0},{id:id(7),dancer_id:id(8),review_status:'approved',storage_path:'OTHER PROFILE'},{id:id(10),dancer_id:id(5),review_status:'approved',storage_path:'PRIVATE SECOND',is_primary:false,sort_order:2}],
  dancer_internal_main_photos:choice?[{dancer_id:id(5),photo_id:id(choice)}]:[],
  social_links:[{dancer_id:id(5),platform:'instagram',handle:'aster',url:'https://instagram.com/aster',is_active:true}],
  mydancr_tv_videos:videos,internal_roster_requests:requests,shifts,
 };
 const admin={
  from(table){let rows=[...(tables[table]||[])],columns='';const q={select(value){columns=value;return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q},order(k,{ascending=true}={}){rows.sort((a,b)=>(a[k]>b[k]?1:a[k]<b[k]?-1:0)*(ascending?1:-1));return q},limit(n){rows=rows.slice(0,n);return q},gte(k,v){rows=rows.filter(r=>r[k]>=v);return q},gt(k,v){rows=rows.filter(r=>r[k]>v);return q},lt(k,v){rows=rows.filter(r=>r[k]<v);return q},lte(k,v){rows=rows.filter(r=>r[k]<=v);return q},is(k,v){return q.eq(k,v)},not(k,_op,v){rows=rows.filter(r=>r[k]!==v);return q},or(value){if(value.startsWith('expires_at.is.null,expires_at.gt.')){const now=value.slice('expires_at.is.null,expires_at.gt.'.length);rows=rows.filter(r=>r.expires_at==null||r.expires_at>now);}return q},single(){return finish(true)},maybeSingle(){return finish(true)},then(resolve,reject){return finish(false).then(resolve,reject)}};function finish(single){const data=rows.map(row=>Object.fromEntries(columns.split(',').filter(key=>key in row).map(key=>[key,row[key]])));return Promise.resolve({data:single?data[0]||null:data,count:rows.length,error:null});}return q;},
  async rpc(name,args){calls.push({name,args});return {data:['internal_roster_members','venue_roster_members'].includes(name)?(members?[{id:id(5),stage_name:'Aster',avatar_storage_path:'private/avatar',working_until:new Date(Date.now()+3600000).toISOString()}]:[]):{id:id(9)},error:null};},
  storage:{from(bucket){return {createSignedUrl:async(path)=>{calls.push({name:'signMedia',bucket,path});return {data:{signedUrl:'https://storage.invalid/private-signed-link'}};}}}},
 };
 const lib={},route={},mainPhoto={},activity={};
 vm.runInNewContext(compile('src/lib/dancr/internal-request-activity.ts'),{exports:activity,Date,require(){return {}}});
 vm.runInNewContext(compile('src/lib/dancr/internal-main-photo.ts'),{exports:mainPhoto,require(){return {}}});
 vm.runInNewContext(compile('src/lib/dancr/internal-roster.ts'),{exports:lib,require(name){if(name==='server-only')return {};if(name.endsWith('api-error-policy'))return {PublicApiError};if(name.endsWith('responsive-image'))return {responsivePublicImage:()=>null};if(name.endsWith('venue-branding'))return {verifiedVenueLogoUrl};if(name.endsWith('venue-access'))return {requireVenueAccess:async()=>{if(!staff)throw new Error('An active venue account is required.');return {venueId:id(2),venueName:'Synthetic club',role:'owner'}}};if(name.endsWith('supabase/request'))return {createRequestSupabaseContext:async request=>{if(request.headers.get('authorization')!=='Bearer staff')throw new Error('Sign in required.');return {user:{id:id(4)}}}};throw Error(name);}});
 vm.runInNewContext(compile('app/api/internal/[[...path]]/route.ts'),{exports:route,URL,Response,Headers,Request,Date,fetch:async(url,options)=>{calls.push({name:'fetch',url,options});return new Response('synthetic-image',{status:Array.isArray(upstreamStatus)?upstreamStatus.shift():upstreamStatus,headers:{'content-type':'image/jpeg',...upstreamHeaders}});},require(name){if(name==='node:crypto')return {createHash};if(name==='next/server')return {NextResponse:{json:Response.json},after:work=>{calls.push({name:'after'});void work();}};if(name.endsWith('internal-request-push'))return {deliverInternalRequestPush:async(_client,requestId)=>{calls.push({name:'deliverInternalRequestPush',requestId});}};if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>admin};if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject};if(name.endsWith('api-error-policy'))return {PublicApiError,resolveApiError};if(name.endsWith('internal-request-activity'))return activity;if(name.endsWith('internal-main-photo'))return mainPhoto;if(name.endsWith('internal-roster'))return lib;if(name.endsWith('responsive-image'))return {responsiveImageStoragePaths};if(name.endsWith('media-watermark'))return {MYDANCR_TV_POSTER_BUCKET,myDancrTvPosterStoragePath};if(name.endsWith('social-profile-url'))return {safeSocialProfileUrl};throw Error(name);}});
 async function get(path=[],query='',auth='',headers={}){return route.GET(new Request('https://example.invalid/api/internal/'+path.join('/')+query,{headers:{...headers,...(auth?{authorization:'Bearer '+auth}:{})}}),{params:Promise.resolve({path})});}
 return {calls,get,post:async(body={},path=[],auth='staff')=>route.POST(new Request('https://example.invalid/api/internal',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({path})})};
}
test('staff roster requires a real signed-in venue session',async()=>{assert.equal((await fixture().get()).status,401);assert.equal((await fixture({staff:false}).get([], '', 'staff')).status,403);});
test('a valid club capability exposes only opted-in photo card metadata',async()=>{const response=await fixture().get(['link',id(3)]);assert.equal(response.status,200);const body=await response.json();assert.equal(body.venueLogoUrl,'/venue-logos/fictional/echo-house.svg');assert.deepEqual(Object.keys(body.dancers[0]).sort(),['id','stageName','workingUntil','avatarRevision','mainPhotoId','mainPhotoRevision','requestStatus'].sort());assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path|user_id/);assert.match(response.headers.get('cache-control'),/no-store/);});
test('internal-only profile opens through the roster with full approved customer content',async()=>{const response=await fixture().get(['profile',id(5)],'?token='+id(3));assert.equal(response.status,200);const body=await response.json();assert.equal(body.profile.stage_name,'Aster');assert.equal(body.profile.photos.length,2);assert.equal(body.profile.socialLinks[0].url,'https://instagram.com/aster');assert.doesNotMatch(JSON.stringify(body),/PRIVATE|real_name|email|storage_path|is_public/);});
test('revoked, guessed, and absent capabilities cannot read full profiles',async()=>{assert.equal((await fixture({active:false}).get(['profile',id(5)],'?token='+id(3))).status,404);assert.equal((await fixture().get(['profile',id(5)],'?token='+id(999))).status,404);assert.equal((await fixture().get(['profile',id(5)])).status,401);});
test('opt-out or shift end removes cards, full profiles, avatars and gallery access',async()=>{const f=fixture({members:false});assert.deepEqual((await (await f.get(['link',id(3)])).json()).dancers,[]);for(const [kind,media]of [['profile',5],['avatar',5],['photo',6]])assert.equal((await f.get([kind,id(media)],'?token='+id(3))).status,404);});
test('club link cannot fetch another dancer gallery photo',async()=>{assert.equal((await fixture().get(['photo',id(7)],'?token='+id(3))).status,404);});

test('Requests tonight counts real requests only inside this venue, dancer and current shift',async()=>{
 const time=delta=>new Date(Date.now()+delta).toISOString();
 const shifts=[{dancer_id:id(5),venue_id:id(2),status:'posted',checked_in_at:time(-3600000),checked_out_at:null,location_status:'club_confirmed',location_verification_expires_at:time(3600000)}];
 const saved={id:id(11),venue_id:id(2),dancer_id:id(5),link_id:id(1),status:'pending',created_at:time(-10000)};
 const requests=[saved,{...saved,id:id(12),link_id:id(30),status:'completed'},
   {...saved,id:id(13),created_at:time(-7200000)}, {...saved,id:id(14),venue_id:id(99)},
   {...saved,id:id(15),dancer_id:id(99)}, {...saved,id:id(16),created_at:time(7200000)}];
 const f=fixture({shifts,requests});
 const profile=(await (await f.get(['profile',id(5)],'?token='+id(3))).json()).profile;
 assert.equal(profile.requestsTonight,2); assert.equal(profile.requestStatus,'pending');
 assert.doesNotMatch(JSON.stringify(profile),/link_id|request_key/);
 const nextShift=fixture({shifts:[{...shifts[0],checked_in_at:time(-1000)}],requests});
 assert.equal((await (await nextShift.get(['profile',id(5)],'?token='+id(3))).json()).profile.requestsTonight,0);
 const ended=fixture({shifts:[{...shifts[0],checked_out_at:time(-1000)}],requests});
 assert.equal((await (await ended.get(['profile',id(5)],'', 'staff')).json()).profile.requestsTonight,0);
});

test('roster and profile share this table’s open state across reloads without disclosing other tables',async()=>{
 const requests=[{venue_id:id(2),dancer_id:id(5),link_id:id(30),status:'pending',created_at:new Date().toISOString()}];
 const other=fixture({requests});
 assert.equal((await (await other.get(['link',id(3)])).json()).dancers[0].requestStatus,null);
 requests.push({...requests[0],link_id:id(1),status:'acknowledged'});
 const own=fixture({requests});
 assert.equal((await (await own.get(['link',id(3)])).json()).dancers[0].requestStatus,'acknowledged');
 assert.equal((await (await own.get(['profile',id(5)],'?token='+id(3))).json()).profile.requestStatus,'acknowledged');
 const stale=fixture({requests:[{...requests[1],created_at:new Date(Date.now()-7*3600000).toISOString()}]});
 assert.equal((await (await stale.get(['link',id(3)])).json()).dancers[0].requestStatus,null);
});
test('authorized media is proxied without exposing its storage URL',async()=>{const response=await fixture().get(['photo',id(6)],'?token='+id(3));assert.equal(response.status,200);assert.equal(await response.text(),'synthetic-image');assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('cache-control'),/no-store/);});

test('grid thumbnails use the authorized photo variant while full profiles keep the master',async()=>{
 const photoPath='private/photo.r320-640.m1200x1800.webp';
 const f=fixture({photoPath});
 assert.equal((await f.get(['photo',id(6)],'?token='+id(3)+'&width=320')).status,200);
 assert.equal(f.calls.find(call=>call.name==='signMedia').path,photoPath+'.w320.webp');
 const full=fixture({photoPath});await full.get(['photo',id(6)],'?token='+id(3));
 assert.equal(full.calls.find(call=>call.name==='signMedia').path,photoPath);
 const invalid=fixture({photoPath});assert.equal((await invalid.get(['photo',id(6)],'?token='+id(3)+'&width=999999')).status,400);
 assert.equal(invalid.calls.some(call=>call.name==='signMedia'),false);
});

test('missing or legacy thumbnails fall back to the same authorized full-size photo',async()=>{
 const photoPath='private/photo.r320-640.m1200x1800.webp';
 const f=fixture({photoPath,upstreamStatus:[404,200]});
 assert.equal((await f.get(['photo',id(6)],'?token='+id(3)+'&width=320')).status,200);
 assert.deepEqual(f.calls.filter(call=>call.name==='signMedia').map(call=>call.path),[photoPath+'.w320.webp',photoPath]);
 const legacy=fixture();assert.equal((await legacy.get(['photo',id(6)],'?token='+id(3)+'&width=320')).status,200);
 assert.equal(legacy.calls.find(call=>call.name==='signMedia').path,'PRIVATE STORAGE');
 const revoked=fixture({active:false,photoPath});assert.equal((await revoked.get(['photo',id(6)],'?token='+id(3)+'&width=320')).status,404);
 assert.equal(revoked.calls.some(call=>call.name==='signMedia'),false);
});

const approvedVideo = (overrides={}) => ({
 id:id(20),dancer_id:id(5),status:'approved',storage_path:'private/dancer/video.mp4',
 moderation_details:{posterStoragePath:'tv-posters/private/dancer/video.poster.webp',privateNotes:'PRIVATE REVIEW'},
 caption:'Synthetic clip',duration_seconds:12,like_count:3,is_pinned:true,
 published_at:new Date(Date.now()-3600000).toISOString(),expires_at:null,...overrides,
});

test('Internal video metadata includes poster availability without private storage or review details',async()=>{
 const f=fixture({videos:[approvedVideo(),approvedVideo({id:id(21),moderation_details:{}})]});
 const response=await f.get(['profile',id(5)],'?token='+id(3));
 assert.equal(response.status,200);const {profile}=await response.json();
 assert.deepEqual(profile.videos.map(video=>video.has_poster),[true,false]);
 assert.equal(profile.videos[0].caption,'Synthetic clip');
 assert.doesNotMatch(JSON.stringify(profile),/storage_path|moderation_details|posterStoragePath|PRIVATE|private\/|signedUrl/);
});

for(const staff of [false,true]) test(`approved video posters load through ${staff?'venue session':'table capability'} access`,async()=>{
 const f=fixture({videos:[approvedVideo()],upstreamHeaders:{'content-type':'image/webp'}});
 const response=await f.get(['video-poster',id(20)],staff?'':'?token='+id(3),staff?'staff':'');
 assert.equal(response.status,200);assert.equal(await response.text(),'synthetic-image');
 assert.equal(response.headers.get('content-type'),'image/webp');
 assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(f.calls.find(call=>call.name==='signMedia'),{name:'signMedia',bucket:'dancer-photos',path:'tv-posters/private/dancer/video.poster.webp'});
});

for(const [label,options,overrides,query,expected] of [
 ['revoked link',{active:false},{},'?token='+id(3),404],
 ['guessed link',{},{},'?token='+id(99),404],
 ['no authorization',{},{},'',401],
 ['shift end or opt-out',{members:false},{},'?token='+id(3),404],
 ['another dancer',{},{dancer_id:id(99)},'?token='+id(3),404],
 ['unapproved video',{},{status:'pending'},'?token='+id(3),404],
 ['future publication',{},{published_at:new Date(Date.now()+3600000).toISOString()},'?token='+id(3),404],
 ['expired video',{},{expires_at:new Date(Date.now()-3600000).toISOString()},'?token='+id(3),404],
 ['missing poster',{},{moderation_details:{}},'?token='+id(3),404],
 ['mismatched poster',{},{moderation_details:{posterStoragePath:'tv-posters/other/video.poster.webp'}},'?token='+id(3),404],
]) test(`Internal poster denies ${label} before accessing storage`,async()=>{
 const f=fixture({...options,videos:[approvedVideo(overrides)]});
 assert.equal((await f.get(['video-poster',id(20)],query)).status,expected);
 assert.equal(f.calls.some(call=>call.name==='signMedia'||call.name==='fetch'),false);
});

test('Internal video playback keeps range streaming and video content type',async()=>{
 const f=fixture({videos:[approvedVideo()],upstreamStatus:206,upstreamHeaders:{'content-type':'video/mp4','accept-ranges':'bytes','content-range':'bytes 0-14/100','content-length':'15'}});
 const response=await f.get(['video',id(20)],'?token='+id(3),'',{'range':'bytes=0-14'});
 assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'video/mp4');
 assert.equal(response.headers.get('content-range'),'bytes 0-14/100');assert.equal(response.headers.get('accept-ranges'),'bytes');
 assert.equal(f.calls.find(call=>call.name==='fetch').options.headers.range,'bytes=0-14');
 assert.deepEqual(f.calls.find(call=>call.name==='signMedia'),{name:'signMedia',bucket:'mydancr-tv-videos',path:'private/dancer/video.mp4'});
});
test('staff mutations ignore client-supplied actor and club identities',async()=>{const f=fixture();const response=await f.post({action:'link_create',kind:'table',label:'Table 2',actor:id(666),venueId:id(777)});assert.equal(response.status,200);const call=f.calls.find(c=>c.name==='internal_roster_manage');assert.equal(call.args.p_actor,id(4));assert.equal(call.args.p_venue,id(2));});
test('table requests require valid identities and revocable table access',async()=>{assert.equal((await fixture().post({dancerId:'invalid',requestKey:id(9)},['link',id(3)],'')).status,400);assert.equal((await fixture({active:false}).post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'')).status,404);});

test('retired entrance-display capabilities cannot open a roster, profile, media, or submit requests', async()=>{
 const f=fixture({kind:'display'});
 for(const path of [['link',id(3)],['profile',id(5)],['avatar',id(5)]])assert.equal((await f.get(path,'?token='+id(3))).status,404);
 assert.equal((await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'')).status,404);
});
test('staff use the unified affiliated roster for private profiles while guests use internal opt-in', async()=>{
 const f=fixture(); assert.equal((await f.get(['profile',id(5)],'', 'staff')).status,200);
 assert.equal(f.calls[0].name,'venue_roster_members');
 await f.get(['profile',id(5)],'?token='+id(3));assert.equal(f.calls[1].name,'internal_roster_members');
});

test('only successful table requests schedule push for the saved request identity',async()=>{
 const f=fixture();const response=await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'');
 assert.equal(response.status,200);assert.equal(f.calls.filter(c=>c.name==='after').length,1);
 assert.equal(f.calls.find(c=>c.name==='deliverInternalRequestPush').requestId,id(9));
 const bad=fixture({active:false});await bad.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'');
 assert.equal(bad.calls.some(c=>c.name==='after'),false);
 const manager=fixture();await manager.post({action:'link_create',kind:'table',label:'Table 2'});
 assert.equal(manager.calls.some(c=>c.name==='after'),false);
});

for(const [label,options,expected] of [
 ['existing dancers use approved primary',{},6],
 ['chosen gallery photo overrides public primary',{choice:10},10],
 ['foreign choice falls back to own primary',{choice:7},6],
 ['rejected selection falls back to approved gallery',{choice:6,photoStatus:'rejected'},10],
 ['pending selection falls back to approved gallery',{choice:6,photoStatus:'pending'},10],
]) test(label,async()=>{
 const response=await fixture(options).get(['link',id(3)]);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.dancers[0].mainPhotoId,id(expected));
 assert.match(body.dancers[0].mainPhotoRevision,/^[a-f0-9]{16}$/);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path/);
});
