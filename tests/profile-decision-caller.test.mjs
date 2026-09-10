import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';
import {buildProfileReviewVersion,isProfileReviewVersion,PROFILE_REVIEW_FIELDS} from '../src/lib/dancr/profile-review-version.ts';
import {buildContentReviewVersion} from '../src/lib/dancr/content-review-version.ts';
import {createProfileDecisionDatabase,seedDecisionDatabase,profileDecisionVersion,profileDecisionSnapshot,reviewProfile,fixtureId as id,profileVersionFields} from './helpers/profile-decision-database.mjs';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={};vm.runInNewContext(compile(source('src/lib/dancr/profile-decisions.ts')),{exports:helpers,Error,require:()=>({PublicApiError,isProfileReviewVersion})});
const libraryCode=compile(source('src/lib/dancr/admin.ts')+'\nexports.map=mapAdminApprovalDancer;');
const routeCode=compile(source('app/api/admin/approvals/route.ts'));
let pg;before(async()=>{pg=await createProfileDecisionDatabase();});beforeEach(async()=>seedDecisionDatabase(pg));after(async()=>pg?.close());
function harness(options={}){
 const calls=[],notifications=[],deliveries=[],warnings=[],summaryReads=[];
 const client={
  async rpc(name,args){
   assert.equal(name,'review_dancer_profile_safely');calls.push(args);
   if(options.failure)return {data:null,error:options.failure};
   if(options.override)return {data:options.override(),error:null};
   try{
    const data=await reviewProfile(pg,{reviewer:args.p_reviewer_id,dancer:args.p_dancer_id,status:args.p_status,notes:args.p_notes,expected:args.p_expected});
    if(options.lost){options.lost=false;return {data:null,error:{code:'08006',message:'private response'}};}return {data,error:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   assert.ok(['app_users','approval_reviews','notifications'].includes(table),'No separate profile, publication or audit writes');
   let identity,notification;const q={
    select(){return q;},eq(key,value){assert.ok(['id','dancer_id'].includes(key));identity=value;return q;},
    insert(row){assert.equal(table,'notifications','No separate history writes');notification=row;notifications.push(row);return q;},
    async maybeSingle(){assert.equal(table,'app_users');return {data:(await pg.query('select id,role,account_state from public.app_users where id=$1',[identity])).rows[0],error:null};},
    async single(){assert.equal(table,'notifications');assert.ok(notification);if(options.notificationThrow)throw new Error('private notification details');if(options.notificationFailure)return {data:null,error:{code:'08006',message:'private notification details'}};return {data:options.notificationMissing?null:{id:id(500)},error:null};},
    then(resolve,reject){
     assert.equal(table,'approval_reviews');summaryReads.push(identity);
     return (async()=>{if(options.summaryThrow)throw new Error('private summary details');if(options.summaryFailure)return {data:null,error:{code:'08006',message:'private summary details'}};return {data:(await pg.query('select * from public.approval_reviews where dancer_id=$1',[identity])).rows,error:null};})().then(resolve,reject);
    },
   };return q;
  },
 };
 const library={},route={};vm.runInNewContext(libraryCode,{exports:library,Error,Date,console:{warn:(...args)=>warnings.push(args)},require(name){
  if(name.endsWith('profile-decisions'))return helpers;
  if(name.endsWith('profile-review-version'))return {buildProfileReviewVersion};
  if(name.endsWith('content-review-version'))return {buildContentReviewVersion};
  if(name.endsWith('safe-error-metadata'))return {safeErrorMetadata};
  if(name.endsWith('notification-delivery'))return {async deliverNotificationRows(...args){deliveries.push(args);if(options.deliveryFailure)throw new Error('private delivery details');return {push:0,email:0};}};
  return {PublicApiError,responsivePublicImage:()=>({imageUrl:'https://example.invalid/photo'})};
 }});
 vm.runInNewContext(routeCode,{exports:route,Error,require(name){
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api'))return {apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
  if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>client};
  if(name.endsWith('/admin'))return library;
  if(name.endsWith('supabase/request'))return {async createRequestSupabaseContext(){if(options.noAuth)throw new Error('Sign in required.');return {client,user:{id:options.user||id(3)},session:null};}};
  if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject:r=>r.json()};return {};
 }});
 return {client,library,calls,notifications,deliveries,warnings,summaryReads,
  async post(extra={}){
   const expected=await profileDecisionVersion(pg,extra.dancerId||id(11));
   const payload={dancerId:id(11),status:'rejected',notes:'Synthetic notes',expectedVersion:expected,...extra};
   const response=await route.POST(new Request('https://example.invalid/approvals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));return {response,body:await response.json()};
  },
 };
}
for(const status of ['approved','rejected'])test('actual endpoint '+status+' uses one transaction and confirms the private resulting state',async()=>{
 const h=harness(),result=await h.post({status});assert.equal(result.response.status,200);assert.equal(result.body.review.status,status==='approved'?'pending_review':'rejected');assert.equal(result.body.review.decision,status);assert.equal(result.body.review.reviewVersion.is_public,false);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,1);assert.equal(h.deliveries.length,1);assert.equal(h.notifications[0].sent_at,result.body.review.reviewedAt);assert.ok(!('recipientId' in result.body.review));
});
test('the actual mapper preserves all fifteen native snapshot fields, including microseconds and nulls',async()=>{
 assert.deepEqual(PROFILE_REVIEW_FIELDS,profileVersionFields);
 await pg.query("update public.dancer_profiles set updated_at='2026-01-02T00:00:00.123456Z' where id=$1",[id(11)]);
 const row=(await pg.query('select to_jsonb(r) value from public.dancer_profiles r where id=$1',[id(11)])).rows[0].value,h=harness();
 const mapped=await h.library.map(h.client,row);assert.deepEqual(mapped.profileReviewVersion,await profileDecisionVersion(pg));assert.ok(isProfileReviewVersion(mapped.profileReviewVersion));
 assert.equal((await h.post({expectedVersion:mapped.profileReviewVersion})).response.status,200);
});
test('the queue requests every raw version column',()=>{
 const select=source('src/lib/dancr/admin.ts').match(/const APPROVAL_QUEUE_SELECT = `([\s\S]*?)`;/)[1];for(const field of PROFILE_REVIEW_FIELDS)assert.match(select,new RegExp('\\b'+field+'\\b'));
});
test('an edited profile cannot be reviewed using its old loaded version',async()=>{
 const expected=await profileDecisionVersion(pg);await pg.query("update public.dancer_profiles set city='Changed' where id=$1",[id(11)]);const before=await profileDecisionSnapshot(pg),h=harness(),result=await h.post({expectedVersion:expected});assert.equal(result.response.status,409);assert.deepEqual(await profileDecisionSnapshot(pg),before);assert.equal(h.notifications.length,0);
});
test('a lost committed response has no retry, compensating write or optional notification',async()=>{
 const expected=await profileDecisionVersion(pg),h=harness({lost:true}),first=await h.post({expectedVersion:expected});assert.equal(first.response.status,503);const before=await profileDecisionSnapshot(pg),again=await h.post({expectedVersion:expected});assert.equal(again.response.status,409);assert.deepEqual(await profileDecisionSnapshot(pg),before);assert.equal(h.calls.length,2);assert.equal(h.notifications.length,0);
});
test('reviewer identity is taken from the authenticated administrator',async()=>{const h=harness();await h.post({reviewerId:id(4)});assert.equal(h.calls[0].p_reviewer_id,id(3));});
for(const option of ['summaryFailure','summaryThrow','notificationFailure','notificationMissing','notificationThrow','deliveryFailure'])test(option+' preserves the saved decision and returns a notification warning',async()=>{
 const h=harness({[option]:true}),r=await h.post();assert.equal(r.response.status,200);assert.equal(r.body.review.status,'rejected');assert.equal(r.body.review.notificationNeedsReview,true);assert.equal(h.calls.length,1);assert.equal(h.warnings.length,1);assert.doesNotMatch(JSON.stringify(h.warnings),/private.*details/);assert.equal((await profileDecisionSnapshot(pg)).admin_actions.length,2);
});
for(const expectedVersion of [undefined,null,{},[],{status:'approved'}])test('missing/legacy loaded snapshot fails before writes: '+JSON.stringify(expectedVersion),async()=>{const h=harness(),r=await h.post({expectedVersion});assert.equal(r.response.status,409);assert.equal(h.calls.length,0);});
for(const [name,options,status]of [['signed out',{noAuth:true},401],['dancer',{user:id(1)},403],['customer',{user:id(5)},403]])test(name+' cannot reach the privileged transaction',async()=>{const h=harness(options),r=await h.post();assert.equal(r.response.status,status);assert.equal(h.calls.length,0);});
for(const [code,status]of [['42501',403],['P0002',404],['40001',409],['22023',400],['22007',400],['22008',400],['40P01',503],['55P03',503],['57014',503],['PGRST202',503],['08006',503]])test(code+' has a safe response without fallback writes',async()=>{const h=harness({failure:{code,message:'private database details'}}),r=await h.post();assert.equal(r.response.status,status);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.doesNotMatch(JSON.stringify(r.body),/private database/);});
for(const [name,mutate]of [
 ['missing',()=>null],['foreign profile',r=>({...r,dancer_id:id(12)})],['wrong decision',r=>({...r,decision:'approved'})],['wrong resulting state',r=>({...r,status:'approved'})],
 ['missing audit',r=>({...r,audit_id:null})],['missing review',r=>({...r,review_id:null})],['foreign recipient',r=>({...r,recipient_id:id(2),version:{...r.version,user_id:id(2)}})],
 ['wrong date',r=>({...r,reviewed_at:'bad'})],['missing version',r=>({...r,version:null})],['still public',r=>({...r,version:{...r.version,is_public:true}})],['wrong verification',r=>({...r,version:{...r.version,verification_status:'approved'}})],
])test(name+' acknowledgment cannot report success',async()=>{
 const expected=await profileDecisionVersion(pg),receipt={dancer_id:id(11),recipient_id:id(1),stage_name:expected.stage_name,decision:'rejected',status:'rejected',review_id:id(700),audit_id:id(701),reviewed_at:'2026-01-02T00:00:00Z',version:{...expected,status:'rejected',verification_status:'rejected',approved_at:null,is_public:false,updated_at:'2026-01-02T00:00:00Z'}};
 const h=harness({override:()=>mutate(receipt)}),result=await h.post({expectedVersion:expected});assert.equal(result.response.status,503);assert.equal(h.notifications.length,0);assert.equal(h.calls.length,1);
});
const uiSource=source('app/admin/AdminClient.tsx'),ast=ts.createSourceFile('AdminClient.tsx',uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let node;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='rejectProfile')node=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(node);
const uiCode=compile(node.getText(ast)+'\nexports.reject=rejectProfile;');
async function uiHarness(options={}){
 const h=harness(options),items=[{id:id(11),profileReviewVersion:await profileDecisionVersion(pg)}],statuses={},confirmations=[],removed=[],requests=[],ui={};
 vm.runInNewContext(uiCode,{exports:ui,Error,Date,Number,isProfileReviewVersion,items,asText:v=>typeof v==='string'?v:'',notesById:{},
  beginApprovalAction:()=>({controller:new AbortController()}),isCurrentApprovalAction:()=>true,finishApprovalAction(){},setActionBusyKey(){},setStatusById(fn){Object.assign(statuses,fn(statuses));},onActionConfirmed:message=>confirmations.push(message),onReviewed:id=>removed.push(id),
  async requestAdminJson(_url,input){const payload=JSON.parse(input.body);requests.push(payload);const r=await h.post(payload);if(r.response.status>=400)throw new Error(r.body.error);return options.uiOverride?options.uiOverride(r.body):r.body;},
 });return {...h,items,statuses,confirmations,removed,requests,click:()=>ui.reject(id(11))};
}
test('actual UI submits its loaded version and removes only a confirmed rejected profile',async()=>{const h=await uiHarness();await h.click();assert.deepEqual(h.requests[0].expectedVersion,h.items[0].profileReviewVersion);assert.deepEqual(h.removed,[id(11)]);assert.match(h.confirmations[0],/rejected successfully/);});
test('actual UI preserves a confirmed decision and displays its notification warning',async()=>{const h=await uiHarness({summaryFailure:true});await h.click();assert.deepEqual(h.removed,[id(11)]);assert.match(h.confirmations[0],/Notification could not be confirmed/);});
test('actual UI keeps the profile visible when a response omits the confirmed decision',async()=>{const h=await uiHarness({uiOverride:r=>({...r,review:{...r.review,decision:undefined}})});await h.click();assert.equal(h.removed.length,0);assert.equal(h.confirmations.length,0);assert.match(h.statuses[id(11)],/could not be confirmed/);});
test('actual UI asks a legacy page to refresh without sending a request',async()=>{const h=await uiHarness();delete h.items[0].profileReviewVersion;await h.click();assert.equal(h.requests.length,0);assert.equal(h.removed.length,0);assert.match(h.statuses[id(11)],/Refresh/);});
