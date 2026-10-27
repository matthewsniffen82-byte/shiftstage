import assert from 'node:assert/strict';
import { sessions, grantInput, grantCookie } from './helpers/internal-nfc-fixture.mjs';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {serveInternalMedia} from '../src/lib/dancr/internal-media-delivery.ts';
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
function fixture({declinedPhotos=[],declinedVideos=[],members=true,active=true,staff=true,kind='table',choice=null,photoStatus='approved',requests=[],shifts=[],videos=[],photoPath='PRIVATE STORAGE',upstreamHeaders={},upstreamStatus=200,beforeRead=async()=>{}}={}){
 const calls=[];
 const tables={
  internal_nfc_tags:[{id:id(40),generation:id(41),status:'active'}],
  internal_roster_links:[{id:id(1),venue_id:id(2),token:id(3),active,kind,label:'Table 4'}],
  venues:[{id:id(2),name:'Synthetic club',slug:'play-it-again-sams',logo_storage_path:null,owner_user_id:id(4),is_active:true}],
  app_users:[{id:id(4),role:'venue',account_state:'active'}],
  dancer_profiles:[{id:id(5),stage_name:'Aster',city:'Las Vegas',real_name:'PRIVATE NAME',email:'PRIVATE EMAIL',is_public:false}],
  dancer_photos:[{id:id(6),dancer_id:id(5),storage_path:photoPath,review_status:photoStatus,is_primary:true,is_pinned:false,sort_order:0},{id:id(7),dancer_id:id(8),review_status:'approved',storage_path:'OTHER PROFILE'},{id:id(10),dancer_id:id(5),review_status:'approved',storage_path:'PRIVATE SECOND',is_primary:false,sort_order:2}],
  dancer_internal_main_photos:choice?[{dancer_id:id(5),photo_id:id(choice)}]:[],
  social_links:[{dancer_id:id(5),platform:'instagram',handle:'aster',url:'https://instagram.com/aster',is_active:true}],
  mydancr_tv_videos:videos,internal_roster_requests:requests,shifts,
 };
 const admin={
  from(table){
   let rows=[...(tables[table]||[])],columns='',patch=null;
   const q={update(value){patch=value;return q},select(value){columns=value;return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q},order(k,{ascending=true}={}){rows.sort((a,b)=>(a[k]>b[k]?1:a[k]<b[k]?-1:0)*(ascending?1:-1));return q},limit(n){rows=rows.slice(0,n);return q},gte(k,v){rows=rows.filter(r=>r[k]>=v);return q},gt(k,v){rows=rows.filter(r=>r[k]>v);return q},lt(k,v){rows=rows.filter(r=>r[k]<v);return q},lte(k,v){rows=rows.filter(r=>r[k]<=v);return q},is(k,v){return q.eq(k,v)},not(k,_op,v){rows=rows.filter(r=>r[k]!==v);return q},or(value){if(value.startsWith('expires_at.is.null,expires_at.gt.')){const now=value.slice('expires_at.is.null,expires_at.gt.'.length);rows=rows.filter(r=>r.expires_at==null||r.expires_at>now);}return q},single(){return finish(true)},maybeSingle(){return finish(true)},then(resolve,reject){return finish(false).then(resolve,reject)}};
   async function finish(single){
    calls.push({name:'read',table,columns});await beforeRead(table,columns);
    if(patch)rows.forEach(row=>Object.assign(row,patch));
    const joined=columns.includes('venue:venues!');
    if(joined){
     assert.match(columns,/venue:venues!internal_roster_links_venue_id_fkey!inner/);
     assert.match(columns,/owner:app_users!venues_owner_user_id_fkey!inner/);
    }
    const data=rows.flatMap(row=>{
     const value=Object.fromEntries(columns.split(',').map(key=>key.trim()).filter(key=>key in row).map(key=>[key,row[key]]));
     if(joined){
      const venue=tables.venues.find(venue=>venue.id===row.venue_id);
      const owner=tables.app_users.find(owner=>owner.id===venue?.owner_user_id);
      if(!venue||!owner)return [];
      value.venue={...venue,owner:{...owner}}; value.tag=tables.internal_nfc_tags[0] || null;
     }
     return [value];
    });
    return {data:single?data[0]||null:data,count:data.length,error:null};
   }
   return q;
  },
  async rpc(name,args){calls.push({name,args});await beforeRead(name);if(name==='club_public_media')return{data:[...tables.dancer_photos.filter(p=>!declinedPhotos.includes(p.id)).map(p=>({dancerId:p.dancer_id,photoId:p.id})),...tables.mydancr_tv_videos.filter(v=>!declinedVideos.includes(v.id)).map(v=>({dancerId:v.dancer_id,videoId:v.id}))]};if(name==='cancel_internal_roster_request'){const row=tables.internal_roster_requests.find(r=>r.id===args.p_request_id&&r.venue_id===args.p_venue_id&&r.link_id===args.p_link_id&&r.dancer_id===args.p_dancer_id);if(!row||!['pending','acknowledged','cancelled'].includes(row.status))return {data:null,error:{code:'40001'}};row.status='cancelled';return {data:{id:row.id,status:row.status},error:null};}return {data:['internal_roster_members','venue_roster_members'].includes(name)?(Array.isArray(members)?members:members?[{id:id(5),stage_name:'Aster',avatar_storage_path:'private/avatar',working_until:new Date(Date.now()+3600000).toISOString()}]:[]):{id:id(9)},error:null};},
  storage:{from(bucket){return {createSignedUrl:async(path)=>{calls.push({name:'signMedia',bucket,path});return {data:{signedUrl:'https://storage.invalid/private-signed-link'}};}}}},
 };
 const fetchMedia=async(url,options)=>{calls.push({name:'fetch',url,options});return new Response('synthetic-image',{status:Array.isArray(upstreamStatus)?upstreamStatus.shift():upstreamStatus,headers:{'content-type':'image/jpeg',...upstreamHeaders}});};
 const lib={},route={},mainPhoto={},activity={},cancel={},permissions={};
 vm.runInNewContext(compile("src/lib/dancr/club-media-permissions.ts"),{exports:permissions,require:()=>({})});
 vm.runInNewContext(compile("src/lib/dancr/internal-request-cancel.ts"),{exports:cancel,Date,require:name=>name.endsWith("api-error-policy")?{PublicApiError}:{}});
 vm.runInNewContext(compile('src/lib/dancr/internal-request-activity.ts'),{exports:activity,Date,require(){return {}}});
 vm.runInNewContext(compile('src/lib/dancr/internal-main-photo.ts'),{exports:mainPhoto,require(name){return name.endsWith('club-media-permissions')?permissions:{}}});
 vm.runInNewContext(compile('src/lib/dancr/internal-roster.ts'),{exports:lib,URL,require(name){if(name.endsWith('internal-tap-session'))return sessions;if(name==='server-only')return {};if(name.endsWith('api-error-policy'))return {PublicApiError};if(name.endsWith('responsive-image'))return {responsivePublicImage:()=>null};if(name.endsWith('venue-branding'))return {verifiedVenueLogoUrl};if(name.endsWith('venue-access'))return {requireVenueAccess:async()=>{if(!staff)throw new Error('An active venue account is required.');return {venueId:id(2),venueName:'Synthetic club',role:'owner'}}};if(name.endsWith('supabase/request'))return {createRequestSupabaseContext:async request=>{if(request.headers.get('authorization')!=='Bearer staff')throw new Error('Sign in required.');return {user:{id:id(4)}}}};throw Error(name);}});
 vm.runInNewContext(compile('app/api/internal/[[...path]]/route.ts'),{exports:route,URL,Response,Headers,Request,Date,performance,fetch:fetchMedia,require(name){if(name.endsWith('club-media-permissions'))return permissions;if(name.endsWith('vip-profile'))return {
 vipProfileScope:async(_db,request,venueId)=>{calls.push({name:'vipScope',venueId});if(request.headers.get('authorization')!=='Bearer vip'||venueId!==id(2)||!active)throw new PublicApiError('FORBIDDEN','VIP access unavailable.',403);return {venueId,venueName:'Synthetic club',link:null,session:null};},
 vipProfileMembers:async()=>members&&!tables.dancer_profiles[0].is_incognito?[{id:id(5),stage_name:'Aster',avatar_storage_path:'private/avatar',working_until:new Date(Date.now()+3600000).toISOString()}]:[]
 };if(name.endsWith('venue-guest-colors'))return {getVenueGuestColors:async(_admin,venueId)=>{calls.push({name:'guestColors',venueId});await beforeRead('guestColors');return {internalAccent:'#c99842',embedAccent:'#123456',configured:true}}};if(name.endsWith('performance-placement'))return {orderByPerformance:async(_admin,rows,identity)=>{calls.push({name:'performancePlacement',identities:rows.map(identity)});await beforeRead('performancePlacement');return [...rows].reverse();}};if(name==='node:crypto')return {createHash};if(name==='next/server')return {NextResponse:{json:Response.json},after:work=>{calls.push({name:'after'});void work();}};if(name.endsWith('internal-request-cancel'))return cancel;if(name.endsWith('internal-request-cancellation-push'))return {deliverInternalCancellationPush:async(_client,requestId)=>calls.push({name:'cancelAlert',requestId})};if(name.endsWith('internal-request-alerts'))return {deliverInternalRequestAlerts:async(_client,requestId)=>{calls.push({name:'deliverInternalRequestAlerts',requestId});}};if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>admin};if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject};if(name.endsWith('api-error-policy'))return {PublicApiError,resolveApiError};if(name.endsWith('internal-request-activity'))return activity;if(name.endsWith('internal-main-photo'))return mainPhoto;if(name.endsWith('internal-media-delivery'))return {serveInternalMedia:(request,options)=>serveInternalMedia(request,{...options,fetch:fetchMedia})};if(name.endsWith('internal-roster'))return lib;if(name.endsWith('responsive-image'))return {responsiveImageStoragePaths};if(name.endsWith('media-watermark'))return {MYDANCR_TV_POSTER_BUCKET,myDancrTvPosterStoragePath};if(name.endsWith('social-profile-url'))return {safeSocialProfileUrl};throw Error(name);}});
 async function get(path=[],query='',auth='',headers={}){return route.GET(new Request('https://example.invalid/api/internal/'+path.join('/')+query,{headers:{cookie:grantCookie(),...headers,...(auth?{authorization:'Bearer '+auth}:{})}}),{params:Promise.resolve({path})});}
 return {tables,calls,get,post:async(body={},path=[],auth='staff',headers={})=>route.POST(new Request('https://example.invalid/api/internal',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json',origin:'https://example.invalid',cookie:grantCookie(),...headers},body:JSON.stringify(body)}),{params:Promise.resolve({path})})};
}

test('table access reads its link, club, and owner together',async()=>{
 const f=fixture();
 assert.equal((await f.get(['link',id(3)])).status,200);
 const accessReads=f.calls.filter(call=>call.name==='read'&&['internal_roster_links','venues','app_users'].includes(call.table));
 assert.equal(accessReads.length,1);
 assert.equal(accessReads[0].table,'internal_roster_links');
});

test('copied links, expired sessions and modified cookies cannot access roster, profiles, images or videos',async()=>{
 for(const cookie of ['',grantCookie(grantInput,Date.now()-36001000),grantCookie()+'tampered']) {
  const f=fixture();
  for(const [path,query] of [[['link',id(3)],''],[['profile',id(5)],'?token='+id(3)],[['photo',id(6)],'?token='+id(3)],[['video',id(6)],'?token='+id(3)]]) {
   assert.equal((await f.get(path,query,'',{cookie})).status,403);
  }
  assert.equal((await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'',{cookie})).status,403);
  assert.equal(f.calls.some(c=>['internal_roster_members','internal_roster_request','signMedia','fetch'].includes(c.name)),false);
 }
});
test('disabling or reprovisioning a tag revokes existing browser grants',async()=>{
 for(const change of [t=>{t.status='disabled'},t=>{t.generation=id(99)}]) {
  const f=fixture(); assert.equal((await f.get(['link',id(3)])).status,200);
  change(f.tables.internal_nfc_tags[0]); assert.equal((await f.get(['link',id(3)])).status,403);
 }
});
test('preview grants are scoped to active authorized staff and cannot create or cancel requests',async()=>{
 const cookie=grantCookie({...grantInput,actor:id(4),tag:null,generation:null});
 const f=fixture();
 assert.equal((await f.get(['link',id(3)],'','',{cookie})).status,200);
 assert.equal((await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'',{cookie})).status,403);
 assert.equal((await f.post({action:'cancel_request',dancerId:id(5),requestId:id(9)},['link',id(3)],'',{cookie})).status,403);
 f.tables.app_users[0].account_state='suspended';
 assert.equal((await f.get(['link',id(3)],'','',{cookie})).status,404);
});
test('cookie-authenticated table writes reject cross-origin requests',async()=>{
 const f=fixture();assert.equal((await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'',{origin:'https://unrelated.invalid'})).status,403);
 assert.equal(f.calls.some(c=>c.name==='internal_roster_request'),false);
});

for(const [label,change] of [
 ['revoked table',tables=>{tables.internal_roster_links[0].active=false;}],
 ['inactive club',tables=>{tables.venues[0].is_active=false;}],
 ['missing club',tables=>{tables.venues.length=0;}],
 ['missing owner',tables=>{tables.app_users.length=0;}],
 ['inactive owner',tables=>{tables.app_users[0].account_state='suspended';}],
 ['wrong owner role',tables=>{tables.app_users[0].role='dancer';}],
])test(`fresh table access blocks a ${label} after an earlier successful load`,async()=>{
 const f=fixture();
 assert.equal((await f.get(['link',id(3)])).status,200);
 change(f.tables);f.calls.length=0;
 assert.equal((await f.get(['link',id(3)])).status,404);
 assert.equal((await f.get(['photo',id(6)],'?token='+id(3))).status,404);
 assert.equal(f.calls.some(call=>['internal_roster_members','signMedia','fetch'].includes(call.name)),false);
});

test('after media permissions, roster ranking, request state, receipt, and colors load concurrently',async()=>{
 const started=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const independent=new Set(['performancePlacement','internal_roster_requests','guestColors']);
 const f=fixture({beforeRead:async(source,columns)=>{
  if(independent.has(source)){started.push({source,columns});await gate;}
 }});
 const response=f.get(['link',id(3)],'?requestKey='+id(9));
 try {
  await setImmediate();
  assert.deepEqual(new Set(started.map(read=>read.source)),independent);
  assert.equal(started.filter(read=>read.source==='internal_roster_requests').length,2);
 } finally { release(); }
 assert.equal((await response).status,200);
});

test('media metadata and live roster membership load together before any storage access',async()=>{
 const started=[];
 const releases={};
 const f=fixture({beforeRead:async source=>{
  if(['dancer_photos','internal_roster_members'].includes(source) && !started.includes(source)){
   started.push(source);await new Promise(resolve=>{releases[source]=resolve;});
  }
 }});
 const response=f.get(['photo',id(6)],'?token='+id(3)+'&width=320');
 try {
  await setImmediate();
  assert.deepEqual(new Set(started),new Set(['dancer_photos','internal_roster_members']));
  releases.dancer_photos();await setImmediate();
  assert.equal(f.calls.some(call=>call.name==='signMedia'||call.name==='fetch'),false);
 } finally { Object.values(releases).forEach(release=>release()); }
 assert.equal((await response).status,200);
 assert.ok(f.calls.some(call=>call.name==='signMedia'));
});

test('guest colors use only the authorized table club and are absent from staff responses',async()=>{
 const f=fixture();
 const guest=await (await f.get(['link',id(3)],'?venueId='+id(88))).json();
 assert.equal(guest.internalAccent,'#c99842'); assert.equal(JSON.stringify(guest).includes('#123456'),false);
 const profile=await (await f.get(['profile',id(5)],'?token='+id(3))).json();
 assert.equal(profile.profile.internalAccent,'#c99842');
 assert.ok(f.calls.filter(c=>c.name==='guestColors').every(c=>c.venueId===id(2)));
 const before=f.calls.filter(c=>c.name==='guestColors').length;
 const staff=await (await f.get([], '', 'staff')).json();
 assert.equal(staff.internalAccent,undefined);
 await f.get(['profile',id(5)],'', 'staff');
 await f.get(['link',id(99)]);
 assert.equal(f.calls.filter(c=>c.name==='guestColors').length,before);
});

for (const status of ['pending','acknowledged','cancelled']) test(`table guests can cancel only their exact ${status} request and retry safely`,async()=>{
 const saved={id:id(12),venue_id:id(2),link_id:id(1),dancer_id:id(5),status,created_at:new Date().toISOString()};
 const f=fixture({requests:[saved]});
 const body={action:'cancel_request',dancerId:id(5),requestId:id(12),venueId:id(999)};
 for(let i=0;i<2;i++) {
  const response=await f.post(body,['link',id(3)],'');assert.equal(response.status,200);
  assert.deepEqual((await response.json()).receipt,{id:id(12),status:'cancelled'});
 }
 assert.equal(saved.status,'cancelled');assert.ok(f.calls.some(c=>c.name==='cancelAlert'&&c.requestId===id(12)));
 assert.equal(f.calls.some(c=>c.name==='internal_roster_request'||c.name==='internal_roster_manage'),false);
});

for(const changed of [{link_id:id(99)},{venue_id:id(99)},{dancer_id:id(99)},{id:id(99)},{status:'completed'}])test('cancellation cannot target foreign or completed requests '+JSON.stringify(changed),async()=>{
 const saved={id:id(12),venue_id:id(2),link_id:id(1),dancer_id:id(5),status:'pending',...changed};
 const before={...saved},f=fixture({requests:[saved]});
 const res=await f.post({action:'cancel_request',dancerId:id(5),requestId:id(12)},['link',id(3)],'');
 assert.equal(res.status,409);assert.deepEqual(saved,before);assert.equal(f.calls.some(c=>c.name==='cancelAlert'),false);
});

test('cancellation requires an active table capability and valid request identity',async()=>{
 const body={action:'cancel_request',dancerId:id(5),requestId:id(12)};
 assert.equal((await fixture({active:false}).post(body,['link',id(3)],'')).status,404);
 assert.equal((await fixture({kind:'display'}).post(body,['link',id(3)],'')).status,404);
 for(const invalid of [{requestId:'bad'},{requestId:null},{dancerId:'bad'},{action:'delete_request'}])
  assert.equal((await fixture().post({...body,...invalid},['link',id(3)],'')).status,400);
});

test('the lightweight staff inbox is authenticated, venue scoped, and excludes cancelled requests',async()=>{
 const saved={id:id(12),venue_id:id(2),link_id:id(1),dancer_id:id(5),status:'pending',created_at:new Date().toISOString()};
 const f=fixture({requests:[saved,{...saved,id:id(13),status:'cancelled'},{...saved,id:id(14),venue_id:id(99)}]});
 assert.equal((await f.get(['requests'])).status,401);
 assert.equal((await f.get(['requests'],'?token='+id(3))).status,404);
 const data=await (await f.get(['requests'],'','staff')).json();
 assert.deepEqual(data.requests.map(row=>row.id),[id(12)]);assert.equal(data.dancers,undefined);assert.equal(data.links,undefined);
});

test('cancelled requests leave the staff inbox and guest buttons while replacement requests stay open',async()=>{
 const saved={id:id(12),venue_id:id(2),link_id:id(1),dancer_id:id(5),status:'pending',created_at:new Date().toISOString()};
 const requests=[saved],f=fixture({requests});
 assert.equal((await (await f.get(['link',id(3)])).json()).dancers[0].requestId,id(12));
 assert.equal((await (await f.get(['profile',id(5)],'?token='+id(3))).json()).profile.requestId,id(12));
 await f.post({action:'cancel_request',dancerId:id(5),requestId:id(12)},['link',id(3)],'');
 assert.equal((await (await f.get([], '', 'staff')).json()).requests.length,0);
 assert.equal((await (await f.get(['link',id(3)])).json()).dancers[0].requestId,null);
 requests.push({...saved,id:id(13),status:'pending'});
 await f.post({action:'cancel_request',dancerId:id(5),requestId:id(12)},['link',id(3)],'');
 assert.equal(requests[1].status,'pending');
 assert.equal((await (await f.get(['link',id(3)])).json()).dancers[0].requestId,id(13));
});
test('staff roster requires a real signed-in venue session',async()=>{assert.equal((await fixture().get()).status,401);assert.equal((await fixture({staff:false}).get([], '', 'staff')).status,403);});

test('venue roster exposes table labels for requests without QR bearer tokens',async()=>{
 const data=await (await fixture().get([], '', 'staff')).json();
 assert.deepEqual(data.links,[{id:id(1),label:'Table 4'}]);
 assert.equal(JSON.stringify(data).includes(id(3)),false);
});
test('staff keep a departed dancer’s request and can record arrival only through their own venue identity',async()=>{
 const saved={id:id(12),venue_id:id(2),link_id:id(1),dancer_id:id(5),status:'acknowledged',attendance:null,created_at:new Date().toISOString()};
 const f=fixture({members:false,requests:[saved]});
 const response=await f.get(['requests'],'','staff'); const data=await response.json();
 assert.equal(data.requests.length,1); assert.equal(data.requests[0].dancerName,'Aster'); assert.doesNotMatch(JSON.stringify(data),/PRIVATE/);
 const body={action:'request_attendance',id:id(12),expectedStatus:'acknowledged',attendance:'arrived',actor:id(999),venueId:id(999)};
 assert.equal((await f.post(body)).status,200);
 const call=f.calls.find(c=>c.name==='record_internal_request_attendance'); assert.equal(call.args.p_actor,id(4)); assert.equal(call.args.p_venue,id(2));
 assert.equal((await f.post({...body,expectedStatus:'pending'})).status,400);
 assert.equal((await f.post(body,['link',id(3)],'')).status,400);
});
test('a valid club capability exposes only opted-in photo card metadata',async()=>{const response=await fixture().get(['link',id(3)]);assert.equal(response.status,200);const body=await response.json();assert.equal(body.venueLogoUrl,'/venue-logos/fictional/silver-circuit.svg');assert.deepEqual(Object.keys(body.dancers[0]).sort(),['id','stageName','workingUntil','avatarRevision','mainPhotoId','mainPhotoRevision','requestStatus','requestId'].sort());assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path|user_id/);assert.match(response.headers.get('cache-control'),/no-store/);});
test('internal-only profile opens through the roster with full approved customer content',async()=>{const response=await fixture().get(['profile',id(5)],'?token='+id(3));assert.equal(response.status,200);const body=await response.json();assert.equal(body.profile.stage_name,'Aster');assert.equal(body.profile.photos.length,2);assert.equal(body.profile.socialLinks[0].url,'https://instagram.com/aster');assert.doesNotMatch(JSON.stringify(body),/PRIVATE|real_name|email|storage_path|is_public/);});
test('revoked, guessed, and absent capabilities cannot read full profiles',async()=>{assert.equal((await fixture({active:false}).get(['profile',id(5)],'?token='+id(3))).status,404);assert.equal((await fixture().get(['profile',id(5)],'?token='+id(999))).status,403);assert.equal((await fixture().get(['profile',id(5)])).status,401);});
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

test('the authorized Internal route rejects oversized and non-image storage responses',async()=>{
 for(const upstreamHeaders of [{'content-type':'text/html'},{'content-length':String(10*1024*1024+1)}]){
  const response=await fixture({upstreamHeaders}).get(['photo',id(6)],'?token='+id(3));
  assert.equal(response.status,404);
 }
});

test('invalid Internal ranges fail before a signed media URL is created',async()=>{
 const f=fixture(),response=await f.get(['photo',id(6)],'?token='+id(3),'',{'range':'bytes=-'});
 assert.equal(response.status,416);assert.equal(f.calls.some(c=>c.name==='signMedia'),false);
});

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
 assert.equal(profile.videos.find(video=>video.id===id(20)).has_poster,true);assert.equal(profile.videos.find(video=>video.id===id(21)).has_poster,false);
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
 ['guessed link',{},{},'?token='+id(99),403],
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
test('staff request updates ignore client-supplied actor and club identities',async()=>{const f=fixture();const response=await f.post({action:'request_status',id:id(12),expectedStatus:'pending',status:'acknowledged',actor:id(666),venueId:id(777)});assert.equal(response.status,200);const call=f.calls.find(c=>c.name==='internal_roster_manage');assert.equal(call.args.p_actor,id(4));assert.equal(call.args.p_venue,id(2));});

for (const action of ['link_create', 'link_update', 'link_revoke']) test(`venue sessions cannot ${action} even from an older dashboard`, async () => {
 const f=fixture();
 const before=structuredClone(f.tables.internal_roster_links);
 const response=await f.post({action,id:id(1),kind:'table',label:'Table 2',role:'admin',actor:id(666),venueId:id(777)});
 assert.equal(response.status,403);
 assert.match((await response.json()).error,/Table (?:NFC|phone tap) setup is managed by MyDancr Admin/);
 assert.equal(f.calls.some(call=>call.name==='internal_roster_manage'),false);
 assert.deepEqual(f.tables.internal_roster_links,before);
 assert.equal((await f.get([], '', 'staff')).status,200,'existing table codes remain available');
 const guest=fixture();
 assert.equal((await guest.post({action,id:id(1)},['link',id(3)],'')).status,400);
 assert.equal(guest.calls.some(call=>call.name==='internal_roster_manage'),false);
});
test('table requests require valid identities and revocable table access',async()=>{assert.equal((await fixture().post({dancerId:'invalid',requestKey:id(9)},['link',id(3)],'')).status,400);assert.equal((await fixture({active:false}).post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'')).status,404);});

test('retired entrance-display capabilities cannot open a roster, profile, media, or submit requests', async()=>{
 const f=fixture({kind:'display'});
 for(const path of [['link',id(3)],['profile',id(5)],['avatar',id(5)]])assert.equal((await f.get(path,'?token='+id(3))).status,404);
 assert.equal((await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'')).status,404);
});
test('staff use the unified affiliated roster for private profiles while guests use internal opt-in', async()=>{
 const f=fixture(); assert.equal((await f.get(['profile',id(5)],'', 'staff')).status,200);
 await f.get(['profile',id(5)],'?token='+id(3));
 assert.deepEqual(f.calls.filter(call=>['venue_roster_members','internal_roster_members'].includes(call.name)).map(call=>call.name),['venue_roster_members','internal_roster_members']);
});

test('only successful table requests schedule staff and dancer alerts for the saved request identity',async()=>{
 const f=fixture();const response=await f.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'');
 assert.equal(response.status,200);assert.equal(f.calls.filter(c=>c.name==='after').length,1);
 assert.equal(f.calls.find(c=>c.name==='deliverInternalRequestAlerts').requestId,id(9));
 const bad=fixture({active:false});await bad.post({dancerId:id(5),requestKey:id(9)},['link',id(3)],'');
 assert.equal(bad.calls.some(c=>c.name==='after'),false);
 const manager=fixture();await manager.post({action:'link_create',kind:'table',label:'Table 2'});
 assert.equal(manager.calls.some(c=>c.name==='after'),false);
});

for(const [label,options,expected] of [
 ['existing dancers use approved primary',{},6],
 ['legacy roster choice cannot override the shared main photo',{choice:10},6],
 ['foreign choice falls back to own primary',{choice:7},6],
 ['rejected selection falls back to approved gallery',{choice:6,photoStatus:'rejected'},10],
 ['pending selection falls back to approved gallery',{choice:6,photoStatus:'pending'},10],
]) test(label,async()=>{
 const response=await fixture(options).get(['link',id(3)]);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.dancers[0].mainPhotoId,id(expected));
 assert.match(body.dancers[0].mainPhotoRevision,/^[a-f0-9]{16}$/);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path/);
});

test('internal and venue roster grids apply score order only after authorization, scoped to the actual club',async()=>{
 const rows=[{id:id(5),stage_name:'Aster',avatar_storage_path:'private/avatar',working_until:new Date(Date.now()+3600000).toISOString()},{id:id(8),stage_name:'Beacon',avatar_storage_path:'private/other',working_until:new Date(Date.now()+3600000).toISOString()}];
 for(const [path,auth] of [[['link',id(3)],''],[[],'staff']]) {
  const f=fixture({members:rows});const response=await f.get(path,'',auth);assert.equal(response.status,200);
  const body=await response.json();assert.deepEqual(body.dancers.map(r=>r.id),[id(8),id(5)]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c.name==='performancePlacement').identities)),rows.map(r=>({dancerId:r.id,venueId:id(2)})));
  assert.doesNotMatch(JSON.stringify(body.dancers),/score|private/);
 }
 const denied=fixture({active:false,members:rows});assert.equal((await denied.get(['link',id(3)])).status,404);
 assert.equal(denied.calls.some(c=>c.name==='performancePlacement'),false);
});

// Keep the same legacy choice while the dancer changes the shared main photo.
test('roster cards follow main photo changes and never publish rejected or foreign photos',async()=>{
 const f=fixture({choice:10});
 const displayed=async()=> (await (await f.get(['link',id(3)])).json()).dancers[0]?.mainPhotoId ?? null;
 assert.equal(await displayed(),id(6));
 for(const photo of f.tables.dancer_photos) photo.is_primary=photo.id===id(10);
 assert.equal(await displayed(),id(10));
 f.tables.dancer_photos.find(p=>p.id===id(10)).review_status='rejected';
 assert.equal(await displayed(),id(6));
 f.tables.dancer_photos.find(p=>p.id===id(6)).review_status='pending';
 assert.equal(await displayed(),null);
});


test('VIP profile and media reads require current membership and privacy, and cannot access staff endpoints',async()=>{
 const f=fixture();const query='?vipVenueId='+id(2);
 const response=await f.get(['profile',id(5)],query,'vip');assert.equal(response.status,200);
 const payload=await response.json();assert.equal(payload.profile.requestsTonight,0);assert.equal(payload.profile.internalAccent,null);
 assert.doesNotMatch(JSON.stringify(payload),/PRIVATE NAME|PRIVATE EMAIL/);
 assert.equal((await f.get(['photo',id(6)],query,'vip')).status,200);
 assert.equal((await f.get(['photo',id(7)],query,'vip')).status,404);
 assert.equal((await f.get(['profile',id(5)],query)).status,403);
 assert.equal((await f.get(['profile',id(5)],'?vipVenueId='+id(99),'vip')).status,403);
 for(const path of [[],['requests'],['link',id(3)]])assert.equal((await f.get(path,query,'vip')).status,404);
 assert.equal((await f.get(['profile',id(5)],query+'&token='+id(3),'vip')).status,404);
 f.tables.dancer_profiles[0].is_incognito=true;f.calls.length=0;
 for(const path of [['profile',id(5)],['avatar',id(5)],['photo',id(6)]])assert.equal((await f.get(path,query,'vip')).status,404);
 assert.ok(!f.calls.some(c=>c.name==='signMedia'));
 assert.equal((await fixture({active:false}).get(['profile',id(5)],query,'vip')).status,403);
});

test('club decisions filter full profiles and deny direct photo and video access, with an approved fallback',async()=>{
 const video={id:id(20),dancer_id:id(5),status:'approved',storage_path:'private/video.mp4',published_at:'2026-01-01',expires_at:null};
 const f=fixture({declinedPhotos:[id(6)],declinedVideos:[id(20)],videos:[video]});
 const response=await f.get(['profile',id(5)],'?token='+id(3));assert.equal(response.status,200);
 const profile=(await response.json()).profile;assert.deepEqual(profile.photos.map(p=>p.id),[id(10)]);assert.deepEqual(profile.videos,[]);
 assert.equal((await f.get(['photo',id(6)],'?token='+id(3))).status,404);
 assert.equal((await f.get(['video',id(20)],'?token='+id(3))).status,404);
 assert.equal((await f.get(['photo',id(10)],'?token='+id(3))).status,200);
 const hidden=fixture({declinedPhotos:[id(6),id(10)]});assert.deepEqual((await(await hidden.get(['link',id(3)])).json()).dancers,[]);
});
