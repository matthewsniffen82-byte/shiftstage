import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {createSocialDatabase,seedSocialDatabase,saveSocials,socialSnapshot,fixtureId as id,link,socialSignature,socialSchema} from "./helpers/social-save-database.mjs";
let pg;before(async()=>{pg=await createSocialDatabase();});after(async()=>{await pg?.close();});beforeEach(async()=>seedSocialDatabase(pg));
const rows=async table=>(await pg.query("select * from public."+table+" order by id")).rows;
test("new social save and pending review commit together",async()=>{
 assert.deepEqual(await saveSocials(pg),{dancer_id:id(11),changed_count:1,queued_count:1});
 const [s]=await rows("social_links"),[r]=await rows("approval_reviews");
 assert.equal(r.review_type,"social_link:"+s.id);assert.equal(r.status,"pending");assert.equal(r.reviewer_id,null);
 assert.equal(s.handle,"synthetic");assert.equal(s.dancer_id,id(11));
});
for(const platform of ["instagram","tiktok","snapchat","x","onlyfans"])test("canonical "+platform+" profile is supported",async()=>{
 await saveSocials(pg,{links:[link(platform)]});assert.equal((await rows("social_links"))[0].platform,platform);
});
test("all five canonical platforms commit with five reviews",async()=>{
 const links=["instagram","tiktok","snapchat","x","onlyfans"].map(p=>link(p));
 assert.equal((await saveSocials(pg,{links})).queued_count,5);
});
test("identical queued requests create one link and one pending review",async()=>{
 const results=await Promise.all([saveSocials(pg),saveSocials(pg),saveSocials(pg)]);
 assert.deepEqual(results.map(r=>r.changed_count),[1,0,0]);assert.deepEqual(results.map(r=>r.queued_count),[1,0,0]);
 assert.equal((await rows("social_links")).length,1);assert.equal((await rows("approval_reviews")).length,1);
});
test("unchanged save preserves all rows and timestamps",async()=>{
 await saveSocials(pg);const before=await socialSnapshot(pg);await saveSocials(pg);assert.deepEqual(await socialSnapshot(pg),before);
});
test("editing preserves identity and prior completed reviews",async()=>{
 await saveSocials(pg);await pg.query("update public.approval_reviews set status='approved',notes='Prior decision',reviewer_id=$1,reviewed_at='2026-01-01Z'",[id(2)]);
 const [old]=await rows("social_links"),history=await rows("approval_reviews");
 await saveSocials(pg,{links:[link("instagram","changed")]});
 const [next]=await rows("social_links");assert.equal(next.id,old.id);assert.deepEqual(next.created_at,old.created_at);assert.equal(next.handle,"changed");assert.ok(next.updated_at>=old.updated_at);
 assert.deepEqual((await rows("approval_reviews")).filter(r=>r.status==="approved"),history);assert.equal((await rows("approval_reviews")).length,2);
});
test("explicit platform cannot suppress another changed platform review",async()=>{
 await saveSocials(pg,{links:[link("instagram"),link("x")],platforms:["x"]});assert.equal((await rows("approval_reviews")).length,2);
});
test("explicit resubmission queues unchanged completed content once",async()=>{
 await saveSocials(pg);await pg.exec("update public.approval_reviews set status='rejected',notes='Keep reason'");
 assert.equal((await saveSocials(pg,{platforms:["instagram"]})).queued_count,1);assert.equal((await saveSocials(pg,{platforms:["instagram"]})).queued_count,0);
 assert.equal((await rows("approval_reviews")).filter(r=>r.status==="rejected")[0].notes,"Keep reason");
});
test("inactive submitted links clear only themselves without deleting history",async()=>{
 await saveSocials(pg,{links:[link(),link("x")]});const before=await rows("approval_reviews");
 assert.equal((await saveSocials(pg,{links:[{platform:"instagram",handle:"",url:"",is_active:false}]})).changed_count,1);
 const all=await rows("social_links");assert.equal(all.find(s=>s.platform==="instagram").is_active,false);assert.equal(all.find(s=>s.platform==="x").handle,"synthetic");assert.deepEqual(await rows("approval_reviews"),before);
});
test("absent inactive and omitted platforms are not invented",async()=>{
 assert.deepEqual(await saveSocials(pg,{links:[{platform:"x",handle:"",url:"",is_active:false}],platforms:["x"]}),{dancer_id:id(11),changed_count:0,queued_count:0});assert.deepEqual(await rows("social_links"),[]);
});
test("reactivation creates a new pending review after a prior decision",async()=>{
 await saveSocials(pg);await pg.exec("update public.social_links set is_active=false;update public.approval_reviews set status='approved'");
 assert.equal((await saveSocials(pg)).queued_count,1);assert.equal((await rows("social_links"))[0].is_active,true);
});
test("empty batch is a safe no-op",async()=>{
 assert.deepEqual(await saveSocials(pg,{links:[]}),{dancer_id:id(11),changed_count:0,queued_count:0});
});
for(const [label,options,code] of [
 ["foreign owner",{actor:id(2)},"42501"],["missing actor",{actor:id(99)},"42501"],["missing profile",{dancer:id(99)},"P0002"],
 ["null actor",{actor:null},"22023"],["null profile",{dancer:null},"22023"],
 ["null links",{links:null},"22023"],["object links",{links:{}},"22023"],["missing platform",{links:[{}]},"22023"],
 ["null link",{links:[null]},"22023"],["unknown platform",{links:[{...link(),platform:"unknown"}]},"22023"],
 ["duplicate platform",{links:[link(),link()]},"22023"],["oversized batch",{links:Array(6).fill(link())},"22023"],
 ["boolean handle",{links:[{...link(),handle:true}]},"22023"],["null url",{links:[{...link(),url:null}]},"22023"],
 ["string active",{links:[{...link(),is_active:"true"}]},"22023"],["blank active",{links:[{...link(),handle:"",url:""}]},"22023"],
 ["inactive content",{links:[{...link(),is_active:false}]},"22023"],["foreign URL",{links:[{...link(),url:"https://evil.invalid/synthetic"}]},"22023"],
 ["handle too long",{links:[link("x","x".repeat(101))]},"22023"],["markup handle",{links:[link("x","<script>")]},"22023"],
 ["null requested platforms",{platforms:null},"22023"],["unknown requested platform",{platforms:["bad"]},"22023"],
 ["null requested platform",{platforms:[null]},"22023"],["too many requested platforms",{platforms:Array(6).fill("x")},"22023"],
])test(label+" is rejected without any writes",async()=>{const before=await socialSnapshot(pg);await assert.rejects(saveSocials(pg,options),{code});assert.deepEqual(await socialSnapshot(pg),before);});
for(const state of ["disabled","suspended","deleted"])test(state+" accounts cannot save",async()=>{
 await pg.query("update public.app_users set account_state=$1 where id=$2",[state,id(1)]);const before=await socialSnapshot(pg);await assert.rejects(saveSocials(pg),{code:"42501"});assert.deepEqual(await socialSnapshot(pg),before);
});
for(const role of ["customer","venue","admin"])test(role+" account cannot use owner social saves",async()=>{
 await pg.query("update public.app_users set role=$1 where id=$2",[role,id(1)]);await assert.rejects(saveSocials(pg),{code:"42501"});
});
test("DMCA suspended dancer cannot save",async()=>{await pg.exec("update public.app_users set dmca_suspended_at=now()");await assert.rejects(saveSocials(pg),{code:"42501"});});
for(const table of ["social_links","approval_reviews"])for(const mode of ["throw","skip"])test(table+" "+mode+" rolls back the complete batch",async()=>{
 await saveSocials(pg,{links:[link("x")]});const before=await socialSnapshot(pg);
 await pg.exec("reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin "+(mode==="throw"?"raise exception 'Synthetic failure';":"return null;")+" end;$$;create trigger synthetic_failure before insert or update on public."+table+" for each row execute function public.synthetic_failure();set role service_role");
 await assert.rejects(saveSocials(pg,{links:[link(),link("x","newvalue")]}));assert.deepEqual(await socialSnapshot(pg),before);
});
test("deactivation suppressed by a trigger is not acknowledged",async()=>{
 await saveSocials(pg);const before=await socialSnapshot(pg);
 await pg.exec("reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin return null;end;$$;create trigger synthetic_failure before update on public.social_links for each row execute function public.synthetic_failure();set role service_role");
 await assert.rejects(saveSocials(pg,{links:[{platform:"instagram",handle:"",url:"",is_active:false}]}),{code:"40001"});assert.deepEqual(await socialSnapshot(pg),before);
});
for(const role of ["anon","authenticated"])test(role+" cannot execute privileged social saves",async()=>{
 await pg.exec("reset role;set role "+role);await assert.rejects(saveSocials(pg),{code:"42501"});
});
test("new function is an invoker with bounded lock and empty search path; dependency unchanged",async()=>{
 await pg.exec("reset role");const [r]=(await pg.query("select prosecdef,proconfig,has_function_privilege('service_role',oid,'execute') as allowed from pg_proc where oid=$1::regprocedure",[socialSignature])).rows;
 assert.equal(r.prosecdef,false);assert.equal(r.allowed,true);assert.ok(r.proconfig.includes('search_path=""'));assert.ok(r.proconfig.includes("lock_timeout=3s"));
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[])'::regprocedure)) as hash")).rows[0].hash,socialSchema.queue.fingerprint);
 assert.equal((await pg.query("select count(*)::int as n from pg_class where oid in('public.social_links'::regclass,'public.approval_reviews'::regclass) and relrowsecurity")).rows[0].n,2);
});
