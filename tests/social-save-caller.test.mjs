import assert from "node:assert/strict";
import test,{before,beforeEach,after} from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {PublicApiError} from "../src/lib/api-error-policy.ts";
import {safeSocialProfileUrl,socialProfileHandle} from "../src/lib/dancr/social-profile-url.ts";
import {createSocialDatabase,seedSocialDatabase,socialSnapshot,saveSocials,link,fixtureId as id} from "./helpers/social-save-database.mjs";
const source=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const actions={};
vm.runInNewContext(compile(source("src/lib/dancr/social-saves.ts")),{exports:actions,Error,require:()=>({PublicApiError})});
const route={};
vm.runInNewContext(compile(source("app/api/dancer/profile/route.ts")+"\nexports.saveSocials=saveSubmittedSocialLinks;"),{
 exports:route,Error,require:()=>({PublicApiError,safeSocialProfileUrl,socialProfileHandle,...actions}),console:{log(){},warn(){},error(){}},
});
let pg;before(async()=>{pg=await createSocialDatabase();});beforeEach(async()=>seedSocialDatabase(pg));after(async()=>pg?.close());
function harness(options={}){
 const calls=[];
 const client={
  from(){assert.fail("Social saves must use one atomic call without a pre-read, upsert, fallback or compensation");},
  async rpc(name,args){
   assert.equal(name,"save_dancer_social_links_safely");calls.push(JSON.parse(JSON.stringify(args)));
   if(options.failure)return {data:null,error:options.failure};
   if(options.override)return {data:options.override(),error:null};
   try{
    const data=await saveSocials(pg,{dancer:args.p_dancer_id,actor:args.p_actor_user_id,links:args.p_links,platforms:args.p_review_platforms});
    if(options.lost){options.lost=false;return {data:null,error:{code:"08006",message:"private database details"}};}
    return {data,error:null};
   }catch(error){return {data:null,error};}
  },
 };
 return {calls,client,save:(body={socials:[{platform:"instagram",handle:"synthetic"}]},actor=id(1),dancer=id(11))=>route.saveSocials(client,dancer,actor,body)};
}
test("actual profile helper canonicalizes and commits a link with its review using authenticated identities",async()=>{
 const h=harness(),result=await h.save();assert.deepEqual(JSON.parse(JSON.stringify(result)),{changedCount:1,queuedCount:1});assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0],{p_dancer_id:id(11),p_actor_user_id:id(1),p_links:[link()],p_review_platforms:[]});
 const state=await socialSnapshot(pg);assert.equal(state.social_links.length,1);assert.equal(state.approval_reviews.length,1);
});
for(const [platform,url] of [
 ["instagram","https://www.instagram.com/synthetic/?utm_source=test"],
 ["tiktok","@synthetic"],["snapchat","https://snapchat.com/add/synthetic"],
 ["x","https://twitter.com/synthetic"],["onlyfans","synthetic"],
])test("existing "+platform+" normalization reaches native SQL",async()=>{
 const h=harness();await h.save({socials:[{platform,url}]});assert.deepEqual(h.calls[0].p_links,[link(platform)]);
});
test("client-supplied identities cannot change the actor or target profile",async()=>{
 const h=harness();await h.save({dancerId:id(12),userId:id(2),socials:[{platform:"instagram",handle:"synthetic",dancer_id:id(12)}]});
 assert.equal(h.calls[0].p_dancer_id,id(11));assert.ok(!("dancer_id" in h.calls[0].p_links[0]));
});
test("identical save preserves the first committed receipt state without duplicate reviews",async()=>{
 const h=harness();await h.save();const before=await socialSnapshot(pg);assert.equal((await h.save()).changedCount,0);assert.deepEqual(await socialSnapshot(pg),before);
});
test("lost committed acknowledgment fails safely; a later identical submission preserves rows",async()=>{
 const h=harness({lost:true});await assert.rejects(h.save(),{status:503});assert.equal(h.calls.length,1);
 const before=await socialSnapshot(pg);assert.equal(before.social_links.length,1);assert.equal(before.approval_reviews.length,1);
 await h.save();assert.deepEqual(await socialSnapshot(pg),before);assert.equal(h.calls.length,2);
});
test("empty active form value clears an existing link without inventing a review",async()=>{
 const h=harness();await h.save();await h.save({socials:[{platform:"instagram",handle:""}]});
 assert.deepEqual(h.calls[1].p_links,[{platform:"instagram",handle:"",url:"",is_active:false}]);
 assert.equal((await socialSnapshot(pg)).social_links[0].is_active,false);
});
test("explicit inactive link clears submitted content",async()=>{
 const h=harness();await h.save();await h.save({socials:[{platform:"instagram",handle:"old",isActive:false}]});assert.equal((await socialSnapshot(pg)).social_links[0].url,"");
});
test("omitted socials do not make any database call",async()=>{
 const h=harness();await h.save({stageName:"Unrelated edit",submittedSocialPlatforms:["instagram"]});assert.equal(h.calls.length,0);
});
test("explicit review requests are filtered and deduplicated without suppressing changed platforms",async()=>{
 const h=harness();await h.save({socials:[{platform:"instagram",handle:"synthetic"},{platform:"x",handle:"synthetic"}],submittedSocialPlatforms:["x","x","unknown"]});
 assert.deepEqual(h.calls[0].p_review_platforms,["x"]);assert.equal((await socialSnapshot(pg)).approval_reviews.length,2);
});
test("unknown optional platform input retains established filtering behavior",async()=>{
 const h=harness();await h.save({socials:[{platform:"unknown",url:"javascript:bad"},null,{platform:"x",handle:"synthetic"}]});assert.deepEqual(h.calls[0].p_links,[link("x")]);
});
test("rejected URLs fail before any write",async()=>{
 const h=harness();await assert.rejects(h.save({socials:[{platform:"instagram",url:"https://evil.invalid/name"}]}),/valid profile link or username/);assert.equal(h.calls.length,0);
});
test("duplicate platforms are a safe validation failure with no partial rows",async()=>{
 const h=harness();await assert.rejects(h.save({socials:[{platform:"x",handle:"a"},{platform:"x",handle:"b"}]}),{status:400});assert.equal((await socialSnapshot(pg)).social_links.length,0);assert.equal(h.calls.length,1);
});
test("native review failure rolls back saved fields and exposes no success",async()=>{
 const h=harness();await h.save();const before=await socialSnapshot(pg);
 await pg.exec("reset role;update public.approval_reviews set status='approved';create function public.synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic queue failure';end;$$;create trigger synthetic_failure before insert on public.approval_reviews for each row execute function public.synthetic_failure();set role service_role");
 const expected=await socialSnapshot(pg);
 await assert.rejects(h.save({socials:[{platform:"instagram",handle:"changed"}]}));assert.deepEqual(await socialSnapshot(pg),expected);assert.equal(expected.social_links[0].handle,before.social_links[0].handle);
});
for(const [code,status] of [["42501",403],["P0002",404],["22023",400],["40001",503],["40P01",503],["55P03",503],["57014",503],["PGRST202",503],["08006",503]])test(code+" cannot report success or trigger fallback/retry",async()=>{
 const h=harness({failure:{code,message:"private details"}});await assert.rejects(h.save(),e=>e.status===status&&!e.message.includes("private"));assert.equal(h.calls.length,1);
});
test("unknown database errors are retained for existing safe profile error handling",async()=>{
 const failure={code:"XX000",message:"private details"},h=harness({failure});await assert.rejects(h.save(),e=>e===failure);assert.equal(h.calls.length,1);
});
const valid={dancer_id:id(11),changed_count:1,queued_count:1};
for(const [name,receipt] of [
 ["null",null],["empty",{}],["foreign",{...valid,dancer_id:id(12)}],["negative changes",{...valid,changed_count:-1}],
 ["excess changes",{...valid,changed_count:2}],["string changes",{...valid,changed_count:"1"}],
 ["fractional changes",{...valid,changed_count:0.5}],["negative reviews",{...valid,queued_count:-1}],
 ["excess reviews",{...valid,queued_count:2}],["fractional reviews",{...valid,queued_count:0.5}],
 ["string reviews",{...valid,queued_count:"1"}],["missing reviews",{dancer_id:id(11),changed_count:1}],
])test(name+" acknowledgment is rejected",async()=>{
 const h=harness({override:()=>receipt});await assert.rejects(h.save(),{status:503});assert.equal(h.calls.length,1);
});
test("native ownership denial preserves both profiles",async()=>{
 const h=harness(),before=await socialSnapshot(pg);await assert.rejects(h.save(undefined,id(2)),{status:403});assert.deepEqual(await socialSnapshot(pg),before);
});
test("only public receipt fields are returned",async()=>{
 const h=harness({override:()=>({...valid,private_data:"private"})});assert.deepEqual(JSON.parse(JSON.stringify(await h.save())),{changedCount:1,queuedCount:1});
});
test("profile PATCH runs the actual atomic helper at the social save stage",()=>{
 const text=source("app/api/dancer/profile/route.ts");assert.match(text,/setSaveStage\("update_social_links"\);\s*await saveSubmittedSocialLinks\(db, profile.id, user.id, body\)/);
 assert.doesNotMatch(text,/submitChangedSocialLinksForReview|readSubmittedSocialPlatforms|changedSocialPlatforms|\.upsert\(rows/);
});
