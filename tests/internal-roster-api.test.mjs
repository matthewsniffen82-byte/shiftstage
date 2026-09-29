import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import {safeSocialProfileUrl} from '../src/lib/dancr/social-profile-url.ts';
const id=n=>'98000000-0000-4000-8000-'+String(n).padStart(12,'0');
const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({members=true,active=true,staff=true,kind='table'}={}){
 const calls=[];
 const tables={
  internal_roster_links:[{id:id(1),venue_id:id(2),token:id(3),active,kind,label:'Table 4'}],
  venues:[{id:id(2),name:'Synthetic club',owner_user_id:id(4),is_active:true}],
  app_users:[{id:id(4),role:'venue',account_state:'active'}],
  dancer_profiles:[{id:id(5),stage_name:'Aster',city:'Las Vegas',real_name:'PRIVATE NAME',email:'PRIVATE EMAIL',is_public:false}],
  dancer_photos:[{id:id(6),dancer_id:id(5),storage_path:'PRIVATE STORAGE',review_status:'approved',is_primary:true,is_pinned:false,sort_order:0},{id:id(7),dancer_id:id(8),review_status:'approved',storage_path:'OTHER PROFILE'}],
  social_links:[{dancer_id:id(5),platform:'instagram',handle:'aster',url:'https://instagram.com/aster',is_active:true}],
  mydancr_tv_videos:[],internal_roster_requests:[],
 };
 const admin={
  from(table){let rows=[...(tables[table]||[])],columns='';const q={select(value){columns=value;return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q},order(){return q},limit(){return q},gte(){return q},lte(){return q},or(){return q},single(){return finish(true)},maybeSingle(){return finish(true)},then(resolve,reject){return finish(false).then(resolve,reject)}};function finish(single){const data=rows.map(row=>Object.fromEntries(columns.split(',').filter(key=>key in row).map(key=>[key,row[key]])));return Promise.resolve({data:single?data[0]||null:data,error:null});}return q;},
  async rpc(name,args){calls.push({name,args});return {data:['internal_roster_members','venue_roster_members'].includes(name)?(members?[{id:id(5),stage_name:'Aster',avatar_storage_path:'private/avatar',working_until:new Date(Date.now()+3600000).toISOString()}]:[]):{id:id(9)},error:null};},
  storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://storage.invalid/private-signed-link'}})}}},
 };
 const lib={},route={};
 vm.runInNewContext(compile('src/lib/dancr/internal-roster.ts'),{exports:lib,require(name){if(name==='server-only')return {};if(name.endsWith('api-error-policy'))return {PublicApiError};if(name.endsWith('venue-access'))return {requireVenueAccess:async()=>{if(!staff)throw new Error('An active venue account is required.');return {venueId:id(2),venueName:'Synthetic club',role:'owner'}}};if(name.endsWith('supabase/request'))return {createRequestSupabaseContext:async request=>{if(request.headers.get('authorization')!=='Bearer staff')throw new Error('Sign in required.');return {user:{id:id(4)}}}};throw Error(name);}});
 vm.runInNewContext(compile('app/api/internal/[[...path]]/route.ts'),{exports:route,URL,Response,Headers,Request,Date,fetch:async()=>new Response('synthetic-image',{headers:{'content-type':'image/jpeg'}}),require(name){if(name==='node:crypto')return {createHash};if(name==='next/server')return {NextResponse:{json:Response.json}};if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>admin};if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject};if(name.endsWith('api-error-policy'))return {PublicApiError,resolveApiError};if(name.endsWith('internal-roster'))return lib;if(name.endsWith('social-profile-url'))return {safeSocialProfileUrl};throw Error(name);}});
 async function get(path=[],query='',auth=''){return route.GET(new Request('https://example.invalid/api/internal/'+path.join('/')+query,{headers:auth?{authorization:'Bearer '+auth}:{}}),{params:Promise.resolve({path})});}
 return {calls,get,post:async(body={},path=[],auth='staff')=>route.POST(new Request('https://example.invalid/api/internal',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({path})})};
}
test('staff roster requires a real signed-in venue session',async()=>{assert.equal((await fixture().get()).status,401);assert.equal((await fixture({staff:false}).get([], '', 'staff')).status,403);});
test('a valid club capability exposes only opted-in avatar card metadata',async()=>{const response=await fixture().get(['link',id(3)]);assert.equal(response.status,200);const body=await response.json();assert.deepEqual(Object.keys(body.dancers[0]).sort(),['id','stageName','workingUntil','avatarRevision'].sort());assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path|user_id/);assert.match(response.headers.get('cache-control'),/no-store/);});
test('internal-only profile opens through the roster with full approved customer content',async()=>{const response=await fixture().get(['profile',id(5)],'?token='+id(3));assert.equal(response.status,200);const body=await response.json();assert.equal(body.profile.stage_name,'Aster');assert.equal(body.profile.photos.length,1);assert.equal(body.profile.socialLinks[0].url,'https://instagram.com/aster');assert.doesNotMatch(JSON.stringify(body),/PRIVATE|real_name|email|storage_path|is_public/);});
test('revoked, guessed, and absent capabilities cannot read full profiles',async()=>{assert.equal((await fixture({active:false}).get(['profile',id(5)],'?token='+id(3))).status,404);assert.equal((await fixture().get(['profile',id(5)],'?token='+id(999))).status,404);assert.equal((await fixture().get(['profile',id(5)])).status,401);});
test('opt-out or shift end removes cards, full profiles, avatars and gallery access',async()=>{const f=fixture({members:false});assert.deepEqual((await (await f.get(['link',id(3)])).json()).dancers,[]);for(const [kind,media]of [['profile',5],['avatar',5],['photo',6]])assert.equal((await f.get([kind,id(media)],'?token='+id(3))).status,404);});
test('club link cannot fetch another dancer gallery photo',async()=>{assert.equal((await fixture().get(['photo',id(7)],'?token='+id(3))).status,404);});
test('authorized media is proxied without exposing its storage URL',async()=>{const response=await fixture().get(['photo',id(6)],'?token='+id(3));assert.equal(response.status,200);assert.equal(await response.text(),'synthetic-image');assert.equal(response.headers.get('location'),null);assert.match(response.headers.get('cache-control'),/no-store/);});
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
