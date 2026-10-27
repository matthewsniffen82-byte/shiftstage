import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {dancerCheckInState} from '../src/lib/dancr/dancer-check-in-state.ts';

const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
vm.runInNewContext(compile('src/lib/dancr/nfc.ts'),{exports,require:name=>name==='node:crypto'?require(name):{}});

test('dashboard exposes saved check-in stage and current presence without exposing the tap audit',async()=>{
  const calls=[];
  const rows={dancer_profiles:{id:'dancer',status:'approved',venue_approved_at:'2026-10-27T10:00:00Z'},
    venue_dancer_affiliations:[{id:'a',status:'active',venues:{id:'club',name:'Club'}}],
    dancer_nfc_enrollments:[{id:'e',venue_id:'club',status:'pending',tapped_at:'2026-10-27T10:00:00Z',expires_at:'2026-11-03',audit:{sessionId:'private-session',ip_address:'private-ip',checkInStatus:'media_pending'},venues:{id:'club',name:'Club'}}],
    dancer_channel_preferences:{visibility:'internal'},club_dancer_approvals:[{venue_id:'club',status:'approved',venues:{id:'club',name:'Club'}}],
    shifts:{status:'posted',location_status:'club_confirmed',checked_in_at:'2026-10-27T10:00:00Z',nfc_last_tapped_at:'2026-10-27T10:00:00Z',location_verification_expires_at:'2026-10-27T16:00:00Z',checked_out_at:null,venues:{id:'club',name:'Club'}}};
  const client={from(table){const q={};for(const method of ['select','eq','order','not','limit'])q[method]=(...args)=>{calls.push({table,method,args});return q;};q.maybeSingle=()=>Promise.resolve({data:rows[table],error:null});q.then=resolve=>resolve({data:rows[table],error:null});return q;}};
  let result=await exports.getDancerNfcDashboardState(client,'user');
  assert.equal(result.enrollment.checkInStatus,'media_pending');assert.equal(result.clubApprovals[0].status,'approved');
  assert.equal(result.presence.workingUntil,'2026-10-27T16:00:00Z');assert.equal(result.presence.nextTapAllowedAt,'2026-10-27T22:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result),/private-session|private-ip|sessionId|ip_address/);
  assert.ok(calls.some(c=>c.table==='dancer_profiles'&&c.method==='eq'&&c.args[0]==='user_id'&&c.args[1]==='user'));
  rows.shifts.status='cancelled';result=await exports.getDancerNfcDashboardState(client,'user');
  assert.equal(result.presence.workingUntil,null);assert.equal(result.presence.nextTapAllowedAt,'2026-10-27T22:00:00.000Z');
});

for(const active of [true,false])test(`status refresh ${active?'completes only an existing saved enrollment':'rejects inactive accounts before completion'}`,async()=>{
  const calls=[],route={};
  const deps={NextResponse:{json:(body,init)=>Response.json(body,init)},createRequestSupabaseContext:async()=>({client:{},user:{id:'signed-in-dancer'}}),
    getAccountByUserId:async()=>({role:'dancer',accountState:active?'active':'disabled'}),createAdminSupabaseClient:()=>({}),
    finalizePendingDancerNfcEnrollment:async(_client,input)=>calls.push(['complete',input.dancerUserId]),
    getDancerNfcDashboardState:async(_client,user)=>{calls.push(['read',user]);return {enrollment:null,presence:null};},
    VenueAffiliationUserError:class extends Error {},safeErrorMetadata:()=>({}),apiError:()=>Response.json({ok:false},{status:500})};
  vm.runInNewContext(compile('app/api/dancer/venue-verification/route.ts'),{exports:route,require:()=>deps,console});
  const result=await route.GET(new Request('https://example.invalid/api/dancer/venue-verification?dancerUserId=other'));
  assert.equal(result.status,active?200:403);
  assert.deepEqual(calls,active?[['complete','signed-in-dancer'],['read','signed-in-dancer']]:[]);
  if(active)assert.match(result.headers.get('cache-control'),/private, no-store/);
});

for(const saved of [false,true])test(`dashboard bootstrap reports ${saved?'the stored club request':'no tap when completion finds no enrollment'}`,async()=>{
  const calls=[],route={};
  const enrollment=saved?{id:'saved-tap',status:'pending',tappedAt:'2026-10-27T10:00:00Z',expiresAt:'2099-01-01',venue:{id:'club',name:'Club'}}:null;
  const snapshot={enrollment,clubApprovals:saved?[{status:'pending',venue:{id:'club'}}]:[],affiliations:[],profileAuthorization:{authorized:false,profileStatus:'pending_review'}};
  const deps={NextResponse:{json:(body,init)=>Response.json(body,init)},
    createRequestSupabaseContext:async()=>({client:{},user:{id:'signed-in-dancer'}}),
    getAccountByUserId:async()=>({role:'dancer',accountState:'active'}),createAdminSupabaseClient:()=>({}),
    getDancerAgeVerification:async()=>({required:true,status:'verified'}),getDancerAgreementAccess:async()=>({accepted:true}),
    finalizePendingDancerNfcEnrollment:async(_client,input)=>{calls.push(['complete',input.dancerUserId]);return {enrollmentStatus:saved?'pending':'none',shiftCheckedIn:false};},
    getDancerNfcDashboardState:async(_client,user)=>{calls.push(['read',user]);return snapshot;},
    getOwnDancerDashboardAnalytics:()=>assert.fail('Bootstrap must not load reports'),
    getDancerDealMetrics:()=>assert.fail('Bootstrap must not load deals'),
    apiError:error=>{throw error;},safeErrorMetadata:()=>({})};
  vm.runInNewContext(compile('app/api/dancer/dashboard/route.ts'),{exports:route,URL,require:()=>deps,console});
  const response=await route.GET(new Request('https://example.invalid/api/dancer/dashboard?view=bootstrap'));
  assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(data.nfc,snapshot);assert.deepEqual(calls,[['complete','signed-in-dancer'],['read','signed-in-dancer']]);
  assert.equal(dancerCheckInState(data.nfc,Date.parse('2026-10-27T12:00:00Z')).stage,saved?'club_pending':'no_tap');
  assert.doesNotMatch(JSON.stringify(data),/enrollmentStatus/);assert.match(response.headers.get('cache-control'),/private, no-store/);
});
