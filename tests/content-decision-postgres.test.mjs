import assert from "node:assert/strict";
import test,{before,beforeEach,after} from "node:test";
import {createDecisionDatabase,seedDecisionDatabase,decisionSnapshot,decisionVersion,decideContent,decisionSignature,decisionSchema,fixtureId as id} from "./helpers/content-decision-database.mjs";
let pg;before(async()=>{pg=await createDecisionDatabase();});beforeEach(async()=>seedDecisionDatabase(pg));after(async()=>pg?.close());
test("pending photo decision, profile summary and audit commit together with one stored time",async()=>{
 const before=await decisionSnapshot(pg),r=await decideContent(pg),after=await decisionSnapshot(pg);
 assert.equal(r.review_id,id(300));assert.equal(r.status,"approved");assert.equal(r.recipient_id,id(1));assert.equal(r.profile_status,"approved");
 const audit=after.admin_actions.find(a=>a.id===r.audit_id),review=after.approval_reviews.find(a=>a.id===r.review_id);
 assert.equal(audit.created_at.toISOString(),review.reviewed_at.toISOString());assert.equal(audit.admin_id,id(3));assert.equal(audit.action,"approve_submitted_content");
 assert.equal(after.dancer_profiles.find(p=>p.id===id(11)).photo_review_status,"approved");
 assert.deepEqual(after.dancer_profiles.map(p=>({...p,photo_review_status:"ignored"})),before.dancer_profiles.map(p=>({...p,photo_review_status:"ignored"})));
 assert.deepEqual(after.social_links,before.social_links);assert.deepEqual(after.app_users,before.app_users);assert.deepEqual(after.venues,before.venues);
 assert.deepEqual(after.dancer_photos.map(p=>({...p,review_status:"ignored"})),before.dancer_photos.map(p=>({...p,review_status:"ignored"})));
 assert.deepEqual(after.approval_reviews.filter(p=>p.id!==id(300)),before.approval_reviews.filter(p=>p.id!==id(300)));
 assert.deepEqual(after.admin_actions.filter(a=>a.id===id(400)),before.admin_actions);
});
test("social decision preserves all link fields and older completed history",async()=>{
 const before=await decisionSnapshot(pg),r=await decideContent(pg,{type:"social_link",target:id(200)}),after=await decisionSnapshot(pg);
 assert.equal(r.review_id,id(302));assert.deepEqual(after.social_links,before.social_links);assert.deepEqual(after.dancer_profiles,before.dancer_profiles);
 assert.deepEqual(after.approval_reviews.find(r=>r.id===id(303)),before.approval_reviews.find(r=>r.id===id(303)));
});
test("rejection trims the reason and stores it with the audit",async()=>{
 const r=await decideContent(pg,{status:"rejected",notes:"  Fix this item  "}),s=await decisionSnapshot(pg);
 assert.equal(s.approval_reviews.find(x=>x.id===r.review_id).notes,"Fix this item");assert.equal(s.admin_actions.find(x=>x.id===r.audit_id).notes,"Synthetic item: Fix this item");assert.equal(s.dancer_profiles[0].photo_review_status,"rejected");
});
test("reviewing completed content appends a decision instead of rewriting it",async()=>{
 const before=await decisionSnapshot(pg),r=await decideContent(pg,{target:id(100),status:"rejected",notes:"New finding"}),after=await decisionSnapshot(pg);
 assert.notEqual(r.review_id,id(301));assert.equal(after.approval_reviews.length,before.approval_reviews.length+1);
 assert.deepEqual(after.approval_reviews.filter(x=>before.approval_reviews.some(b=>b.id===x.id)),before.approval_reviews);
});
test("content with no prior review receives one completed record",async()=>{
 await pg.query("delete from public.approval_reviews where review_type=$1",["photo:"+id(101)]);
 assert.equal((await decideContent(pg)).status,"approved");assert.equal((await decisionSnapshot(pg)).approval_reviews.filter(x=>x.review_type==="photo:"+id(101)).length,1);
});
test("pending request wins over a later timestamp on completed history",async()=>{
 await pg.query("update public.approval_reviews set reviewed_at='2099-01-01Z' where id=$1",[id(303)]);
 assert.equal((await decideContent(pg,{type:"social_link",target:id(200)})).review_id,id(302));
});
for(const type of ["photo","social_link"])test(type+" same-snapshot queued decisions produce one decision and one audit",async()=>{
 const target=type==="photo"?id(101):id(200),expected=await decisionVersion(pg,type,target),before=await decisionSnapshot(pg);
 const results=await Promise.allSettled([decideContent(pg,{type,target,expected}),decideContent(pg,{type,target,expected,reviewer:id(4)})]);
 assert.equal(results[0].status,"fulfilled");assert.equal(results[1].status,"rejected");assert.equal(results[1].reason.code,"40001");
 assert.equal((await decisionSnapshot(pg)).admin_actions.length,before.admin_actions.length+1);
});
test("returned version supports a deliberate later decision without modifying the first",async()=>{
 const first=await decideContent(pg),before=await decisionSnapshot(pg);
 const next=await decideContent(pg,{status:"rejected",notes:"Later finding",expected:first.version});
 assert.notEqual(first.review_id,next.review_id);assert.deepEqual((await decisionSnapshot(pg)).approval_reviews.find(r=>r.id===first.review_id),before.approval_reviews.find(r=>r.id===first.review_id));
});
for(const [field,value]of [["handle","changed"],["url","https://instagram.com/changed"],["is_active",false],["updated_at","2026-01-01T12:34:56.123457Z"]])test("stale social "+field+" is rejected without review changes",async()=>{
 const expected=await decisionVersion(pg,"social_link",id(200));await pg.query("update public.social_links set "+field+"=$1 where id=$2",[value,id(200)]);
 const before=await decisionSnapshot(pg);await assert.rejects(decideContent(pg,{type:"social_link",target:id(200),expected}),{code:"40001"});assert.deepEqual(await decisionSnapshot(pg),before);
});
for(const [field,value]of [["storage_path","changed/path"],["sort_order",3],["is_primary",true],["review_status","rejected"]])test("stale photo "+field+" is rejected",async()=>{
 const expected=await decisionVersion(pg);await pg.query("update public.dancer_photos set "+field+"=$1 where id=$2",[value,id(101)]);
 const before=await decisionSnapshot(pg);await assert.rejects(decideContent(pg,{expected}),{code:"40001"});assert.deepEqual(await decisionSnapshot(pg),before);
});
test("stale review status or reviewed timestamp cannot overwrite another decision",async()=>{
 const expected=await decisionVersion(pg);await pg.query("update public.approval_reviews set status='rejected',reviewed_at=now() where id=$1",[id(300)]);
 const before=await decisionSnapshot(pg);await assert.rejects(decideContent(pg,{expected}),{code:"40001"});assert.deepEqual(await decisionSnapshot(pg),before);
});
for(const timezone of ["America/Los_Angeles","Pacific/Auckland"])test("version timestamps compare values in "+timezone,async()=>{
 await pg.exec("set timezone='"+timezone+"'");const expected=await decisionVersion(pg,"social_link",id(200));
 assert.equal((await decideContent(pg,{type:"social_link",target:id(200),expected})).status,"approved");
});
test("equivalent reviewed timestamp offset is accepted for a later decision",async()=>{
 const expected=await decisionVersion(pg,"photo",id(100));expected.review.reviewed_at="2026-01-01T16:00:00-08:00";assert.equal((await decideContent(pg,{target:id(100),expected})).status,"approved");
});
for(const [label,options,code]of [
 ["missing reviewer",{reviewer:null},"22023"],["missing dancer",{dancer:null,expected:{target:{},review:null}},"22023"],
 ["missing target",{target:null,expected:{target:{},review:null}},"22023"],["wrong target type",{type:"video",expected:{target:{},review:null}},"22023"],
 ["pending status",{status:"pending"},"22023"],["null status",{status:null},"22023"],["empty rejection reason",{status:"rejected",notes:"  "},"22023"],
 ["oversized notes",{notes:"x".repeat(12001)},"22023"],["oversized label",{label:"x".repeat(1001)},"22023"],
 ["null version",{expected:null},"22023"],["empty version",{expected:{}},"22023"],["array target",{expected:{target:[],review:null}},"22023"],
 ["foreign owner as admin",{reviewer:id(2)},"42501"],["customer",{reviewer:id(5)},"42501"],["unknown admin",{reviewer:id(99)},"42501"],
 ["unknown profile",{dancer:id(99),expected:{target:{},review:null}},"P0002"],["foreign target",{dancer:id(12),expected:{target:{},review:null}},"P0002"],
 ["deleted target",{target:id(99),expected:{target:{},review:null}},"P0002"],
])test(label+" fails without any writes",async()=>{const before=await decisionSnapshot(pg);await assert.rejects(decideContent(pg,options),{code});assert.deepEqual(await decisionSnapshot(pg),before);});
for(const state of ["disabled","suspended"])test(state+" administrator is denied",async()=>{
 await pg.query("update public.app_users set account_state=$1 where id=$2",[state,id(3)]);await assert.rejects(decideContent(pg),{code:"42501"});
});
for(const primary of [true,false])test("active "+(primary?"primary":"gallery")+" uniqueness failure rolls everything back",async()=>{
 await pg.query("update public.dancer_photos set is_primary=$1,sort_order=1,review_status='rejected' where id=$2",[primary,id(101)]);
 await pg.query("update public.dancer_photos set is_primary=$1 where id=$2",[primary,id(100)]);
 const before=await decisionSnapshot(pg);await assert.rejects(decideContent(pg),{code:"23505"});assert.deepEqual(await decisionSnapshot(pg),before);
});
for(const table of ["dancer_photos","dancer_profiles","approval_reviews","admin_actions"])for(const mode of ["throw","skip"])test(table+" "+mode+" failure rolls back the entire decision",async()=>{
 const before=await decisionSnapshot(pg),expected=await decisionVersion(pg);
 await pg.exec("reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin "+(mode==="throw"?"raise exception 'Synthetic write failure';":"return null;")+" end;$$;create trigger synthetic_failure before insert or update on public."+table+" for each row execute function public.synthetic_failure();set role service_role");
 await assert.rejects(decideContent(pg,{expected}));assert.deepEqual(await decisionSnapshot(pg),before);
});
for(const role of ["anon","authenticated"])test(role+" cannot execute content decisions",async()=>{
 const expected=await decisionVersion(pg);await pg.exec("reset role;set role "+role);await assert.rejects(decideContent(pg,{expected}),{code:"42501"});
});
test("function stays service-only/invoker; existing functions, indexes and RLS remain",async()=>{
 await pg.exec("reset role");const [r]=(await pg.query("select prosecdef,proconfig,has_function_privilege('service_role',oid,'execute') allowed from pg_proc where oid=$1::regprocedure",[decisionSignature])).rows;
 assert.equal(r.prosecdef,false);assert.equal(r.allowed,true);assert.ok(r.proconfig.includes('search_path=""'));assert.ok(r.proconfig.includes("lock_timeout=3s"));assert.ok(r.proconfig.includes("TimeZone=UTC"));
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[])'::regprocedure)) hash")).rows[0].hash,decisionSchema.existing_hashes.social_save);
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[])'::regprocedure)) hash")).rows[0].hash,decisionSchema.existing_hashes.queue);
 assert.equal((await pg.query("select count(*)::int n from pg_class where oid in('public.dancer_profiles'::regclass,'public.dancer_photos'::regclass,'public.social_links'::regclass,'public.approval_reviews'::regclass,'public.admin_actions'::regclass) and relrowsecurity")).rows[0].n,5);
});
