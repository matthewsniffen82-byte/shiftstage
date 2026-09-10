import assert from "node:assert/strict";
import test,{before,beforeEach,after} from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {PublicApiError,resolveApiError} from "../src/lib/api-error-policy.ts";
import {safeErrorMetadata} from "../src/lib/security/safe-error-metadata.ts";
import {buildContentReviewVersion,isContentReviewVersion} from "../src/lib/dancr/content-review-version.ts";
import {createDecisionDatabase,seedDecisionDatabase,decisionVersion,decisionSnapshot,decideContent,fixtureId as id} from "./helpers/content-decision-database.mjs";
const source=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={};
vm.runInNewContext(compile(source("src/lib/dancr/content-decisions.ts")),{exports:helpers,Error,require:()=>({PublicApiError,isContentReviewVersion})});
const libraryCode=compile(source("src/lib/dancr/admin.ts")+"\nexports.map=mapAdminApprovalDancer;");
const routeCode=compile(source("app/api/admin/approvals/route.ts"));
let pg;before(async()=>{pg=await createDecisionDatabase();});beforeEach(async()=>seedDecisionDatabase(pg));after(async()=>pg?.close());
function harness(options={}){
 const calls=[],notifications=[],deliveries=[],warnings=[];
 const client={
  async rpc(name,args){
   assert.equal(name,"review_dancer_content_safely");calls.push(args);
   if(options.failure)return {data:null,error:options.failure};
   if(options.override)return {data:options.override(),error:null};
   try{
    const data=await decideContent(pg,{reviewer:args.p_reviewer_id,dancer:args.p_dancer_id,type:args.p_target_type,target:args.p_target_id,status:args.p_status,notes:args.p_notes,label:args.p_label,expected:args.p_expected});
    if(options.lost){options.lost=false;return {data:null,error:{code:"08006",message:"private response"}};}
    return {data,error:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   assert.ok(["app_users","notifications"].includes(table),"No direct decision, summary, history or audit writes");
   let user,notification;const q={
    select(){return q;},eq(key,value){assert.equal(key,"id");user=value;return q;},
    insert(row){assert.equal(table,"notifications");notification=row;notifications.push(row);return q;},
    async maybeSingle(){assert.equal(table,"app_users");return {data:(await pg.query("select id,role,account_state from public.app_users where id=$1",[user])).rows[0],error:null};},
    async single(){
     assert.equal(table,"notifications");assert.ok(notification);
     if(options.notificationThrow)throw new Error("private notification details");
     if(options.notificationFailure)return {data:null,error:{code:"08006",message:"private notification details"}};
     return {data:options.notificationMissing?null:{id:id(500)},error:null};
    },
   };return q;
  },
 };
 const library={},route={};
 vm.runInNewContext(libraryCode,{exports:library,Error,Date,console:{warn:(...args)=>warnings.push(args)},require(name){
  if(name.endsWith("content-decisions"))return helpers;
  if(name.endsWith("content-review-version"))return {buildContentReviewVersion};
  if(name.endsWith("notification-delivery"))return {async deliverNotificationRows(...args){deliveries.push(args);if(options.deliveryFailure)throw new Error("private delivery details");return {push:0,email:0};}};
  if(name.endsWith("safe-error-metadata"))return {safeErrorMetadata};
  return {PublicApiError,responsivePublicImage:()=>({imageUrl:"https://example.invalid/photo"})};
 }});
 vm.runInNewContext(routeCode,{exports:route,Error,require(name){
  if(name==="next/server")return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith("/api"))return {apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
  if(name.endsWith("supabase/admin"))return {createAdminSupabaseClient:()=>client};
  if(name.endsWith("/admin"))return library;
  if(name.endsWith("supabase/request"))return {async createRequestSupabaseContext(){if(options.noAuth)throw new Error("Sign in required.");return {client,user:{id:options.user||id(3)},session:null};}};
  if(name.endsWith("bounded-json-body"))return {readBoundedJsonObject:r=>r.json()};
  return {};
 }});
 return {client,library,calls,notifications,deliveries,warnings,
  async post(extra={}){
   const expected=await decisionVersion(pg,extra.targetType||"photo",extra.targetId||id(101),extra.dancerId||id(11));
   const payload={action:"review_content",dancerId:id(11),targetType:"photo",targetId:id(101),status:"approved",label:"Synthetic item",expectedVersion:expected,...extra};
   const response=await route.POST(new Request("https://example.invalid/approvals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}));return {response,body:await response.json()};
  },
 };
}
test("actual administrator endpoint commits one decision, then attempts optional notification",async()=>{
 const h=harness(),r=await h.post();assert.equal(r.response.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.review.status,"approved");assert.equal(r.body.review.reviewId,id(300));assert.equal(h.calls.length,1);assert.equal(h.notifications.length,1);assert.equal(h.deliveries.length,1);
 assert.equal(r.body.review.reviewedAt,h.notifications[0].sent_at);assert.equal(r.body.review.reviewVersion.review.id,id(300));assert.ok(!("recipientId" in r.body.review));
});
test("the endpoint uses the signed-in administrator, ignoring a supplied reviewer identity",async()=>{
 const h=harness();await h.post({reviewerId:id(4)});assert.equal(h.calls[0].p_reviewer_id,id(3));
});
test("a stale social snapshot returns conflict with no review, audit or notification",async()=>{
 const expected=await decisionVersion(pg,"social_link",id(200));await pg.query("update public.social_links set handle='changed' where id=$1",[id(200)]);
 const before=await decisionSnapshot(pg),h=harness(),r=await h.post({targetType:"social_link",targetId:id(200),expectedVersion:expected});
 assert.equal(r.response.status,409);assert.equal(r.body.ok,false);assert.deepEqual(await decisionSnapshot(pg),before);assert.equal(h.notifications.length,0);
});
test("lost committed response does not delete or retry the decision; repeating its old snapshot conflicts",async()=>{
 const expected=await decisionVersion(pg),h=harness({lost:true});const first=await h.post({expectedVersion:expected});
 assert.equal(first.response.status,503);assert.equal(h.calls.length,1);const before=await decisionSnapshot(pg);
 const again=await h.post({expectedVersion:expected});assert.equal(again.response.status,409);assert.deepEqual(await decisionSnapshot(pg),before);assert.equal(h.notifications.length,0);
});
for(const option of ["notificationFailure","notificationThrow","notificationMissing","deliveryFailure"])test(option+" preserves a confirmed decision and returns a notification warning",async()=>{
 const h=harness({[option]:true}),r=await h.post();assert.equal(r.response.status,200);assert.equal(r.body.review.notificationNeedsReview,true);assert.equal(r.body.review.status,"approved");assert.equal(h.calls.length,1);assert.equal(h.notifications.length,1);
 assert.equal((await decisionSnapshot(pg)).admin_actions.length,2);assert.equal(h.warnings.length,1);assert.doesNotMatch(JSON.stringify(h.warnings),/private|details/);
});
test("approval of a draft profile item preserves the existing no-notification behavior",async()=>{
 await pg.query("update public.dancer_profiles set status='draft' where id=$1",[id(11)]);
 const h=harness(),r=await h.post();assert.equal(r.response.status,200);assert.equal(h.notifications.length,0);assert.equal((await decisionSnapshot(pg)).dancer_profiles[0].status,"draft");
});
test("rejection still requires a reason before a database call",async()=>{
 const h=harness(),r=await h.post({status:"rejected",notes:" "});assert.equal(r.response.status,400);assert.equal(h.calls.length,0);
});
for(const [name,options,status]of [["signed out",{noAuth:true},401],["dancer",{user:id(1)},403],["customer",{user:id(5)},403]])test(name+" cannot enter the decision transaction",async()=>{
 const h=harness(options),r=await h.post();assert.equal(r.response.status,status);assert.equal(h.calls.length,0);
});
for(const expectedVersion of [undefined,null,{},[],{target:{},review:null}])test("missing/malformed loaded version requires refresh before writing: "+JSON.stringify(expectedVersion),async()=>{
 const h=harness(),r=await h.post({expectedVersion});assert.equal(r.response.status,409);assert.equal(h.calls.length,0);
});
for(const [code,status]of [["42501",403],["P0002",404],["40001",409],["22023",400],["22007",400],["22008",400],["40P01",503],["55P03",503],["57014",503],["PGRST202",503],["08006",503]])test(code+" is handled without fallback or notification",async()=>{
 const h=harness({failure:{code,message:"private database data"}}),r=await h.post();assert.equal(r.response.status,status);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.doesNotMatch(JSON.stringify(r.body),/private database/);
});
for(const primary of [true,false])for(const native of [true,false])test((primary?"primary":"gallery")+" constraint "+(native?"native":"REST")+" conflict is safe",async()=>{
 const name=primary?"dancer_photos_one_active_primary_idx":"dancer_photos_one_active_gallery_position_idx";
 const failure={code:"23505",...(native?{constraint:name}:{message:'duplicate key violates unique constraint "'+name+'"'})};
 const h=harness({failure}),r=await h.post();assert.equal(r.response.status,409);assert.equal(h.notifications.length,0);
});
test("unrelated uniqueness errors retain their original server error",async()=>{
 const failure={code:"23505",message:"different constraint"},h=harness({failure});
 await assert.rejects(helpers.recordContentDecision(h.client,{dancerId:id(11),reviewerId:id(3),targetType:"photo",targetId:id(101),status:"approved",expectedVersion:await decisionVersion(pg)}),e=>e===failure);
});
test("actual mapper supplies exact native versions and prioritizes a pending review over skewed completed history",async()=>{
 const h=harness(),state=await decisionSnapshot(pg),row={...state.dancer_profiles[0],dancer_photos:state.dancer_photos,approval_reviews:state.approval_reviews};
 row.social_links=(await pg.query("select to_jsonb(s) value from public.social_links s")).rows.map(r=>r.value);
 row.approval_reviews=(await pg.query("select to_jsonb(r) value from public.approval_reviews r")).rows.map(r=>r.value);
 row.approval_reviews.find(r=>r.id===id(303)).reviewed_at="2099-01-01T00:00:00Z";
 const mapped=await h.library.map(h.client,JSON.parse(JSON.stringify(row)));
 assert.equal(mapped.socialLinks[0].reviewStatus,"pending");
 assert.deepEqual(mapped.socialLinks[0].reviewVersion,await decisionVersion(pg,"social_link",id(200)));
 for(const photo of mapped.photos)assert.deepEqual(photo.reviewVersion,await decisionVersion(pg,"photo",photo.id));
});
const receipt=()=>({dancer_id:id(11),target_id:id(101),target_type:"photo",status:"approved",review_id:id(300),audit_id:id(401),recipient_id:id(1),profile_status:"approved",reviewed_at:"2026-01-02T00:00:00Z",version:{target:{storage_path:"synthetic/photo-101",is_primary:false,sort_order:2,review_status:"approved"},review:{id:id(300),status:"approved",reviewed_at:"2026-01-02T00:00:00Z"}}});
for(const [name,change]of [
 ["missing",()=>null],["foreign profile",r=>({...r,dancer_id:id(12)})],["foreign target",r=>({...r,target_id:id(100)})],["wrong type",r=>({...r,target_type:"social_link"})],
 ["wrong status",r=>({...r,status:"rejected"})],["missing audit",r=>({...r,audit_id:null})],["invalid review",r=>({...r,review_id:"bad"})],["invalid recipient",r=>({...r,recipient_id:null})],
 ["invalid date",r=>({...r,reviewed_at:"bad"})],["missing version",r=>({...r,version:null})],["wrong version review",r=>({...r,version:{...r.version,review:{...r.version.review,id:id(303)}}})],
 ["unconfirmed version status",r=>({...r,version:{...r.version,target:{...r.version.target,review_status:"pending"}}})],
])test(name+" RPC receipt cannot report success",async()=>{
 const h=harness({override:()=>change(receipt())}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.notifications.length,0);assert.equal(h.calls.length,1);
});

const uiSource=source("app/admin/AdminClient.tsx"),uiAst=ts.createSourceFile("AdminClient.tsx",uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let uiNode;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==="reviewContent")uiNode=n;ts.forEachChild(n,visit);}visit(uiAst);assert.ok(uiNode);
const uiCode=compile(uiNode.getText(uiAst)+"\nexports.review=reviewContent;");
async function uiHarness(options={}){
 const h=harness(options),photos=[{id:id(101),reviewVersion:await decisionVersion(pg)}],socials=[],feedback={},statuses={},versions={current:{}},ui={},requests=[];
 const context={exports:ui,Error,JSON,isContentReviewVersion,photos,socials,dancerId:id(11),asText:v=>typeof v==="string"?v:"",reasonByKey:{["photo:"+id(101)]:"Later reason"},versionByKeyRef:versions,
  activeActionRef:{current:null},onKeepOpen(){},beginAction:()=>({controller:new AbortController()}),isCurrentAction:()=>true,onActionStarted(){},finishAction(){},setWorkingByKey(){},
  setFeedbackByKey(fn){Object.assign(feedback,fn(feedback));},setStatusByKey(fn){Object.assign(statuses,fn(statuses));},onSocialReviewed(){},onActionConfirmed(){},
  async requestAdminJson(_url,input){const payload=JSON.parse(input.body);requests.push(payload);const r=await h.post(payload);if(r.response.status>=400)throw new Error(r.body.error);return options.uiOverride?options.uiOverride(r.body):r.body;},
 };
 vm.runInNewContext(uiCode,context);
 return {...h,photos,feedback,statuses,versions,requests,click:(status="approved")=>ui.review({preventDefault(){},stopPropagation(){}},"photo",id(101),status,"Synthetic item")};
}
test("actual UI posts loaded version and retains the returned version for a later decision",async()=>{
 const h=await uiHarness(),original=JSON.parse(JSON.stringify(h.photos[0].reviewVersion));await h.click();
 assert.deepEqual(h.requests[0].expectedVersion,original);assert.equal(h.statuses["photo:"+id(101)],"approved");
 const first=await decisionSnapshot(pg);await h.click("rejected");assert.equal(h.requests[1].expectedVersion.review.status,"approved");assert.equal(h.statuses["photo:"+id(101)],"rejected");
 assert.deepEqual((await decisionSnapshot(pg)).approval_reviews.find(r=>r.id===id(300)),first.approval_reviews.find(r=>r.id===id(300)));
});
test("a newer loaded target version replaces the UI's prior decision cache",async()=>{
 const h=await uiHarness();await h.click();await pg.query("update public.dancer_photos set storage_path='synthetic/new-photo' where id=$1",[id(101)]);
 h.photos[0].reviewVersion=await decisionVersion(pg);await h.click("rejected");assert.equal(h.requests[1].expectedVersion.target.storage_path,"synthetic/new-photo");
});
test("actual UI never invents success from a malformed server acknowledgment",async()=>{
 const h=await uiHarness({uiOverride:body=>({...body,review:{...body.review,status:undefined}})});await h.click();assert.equal(h.statuses["photo:"+id(101)],undefined);assert.equal(h.feedback["photo:"+id(101)].tone,"error");assert.deepEqual(h.versions.current,{});
});
test("actual UI shows notification uncertainty while retaining the confirmed decision",async()=>{
 const h=await uiHarness({notificationFailure:true});await h.click();assert.equal(h.statuses["photo:"+id(101)],"approved");assert.match(h.feedback["photo:"+id(101)].message,/Notification could not be confirmed/);
});
test("legacy UI without loaded version asks for refresh before sending",async()=>{
 const h=await uiHarness();delete h.photos[0].reviewVersion;await h.click();assert.equal(h.requests.length,0);assert.match(h.feedback["photo:"+id(101)].message,/Refresh/);
});
