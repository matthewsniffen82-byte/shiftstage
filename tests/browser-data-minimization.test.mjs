import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { readBrowserAuthSession, clearBrowserAuthSession } from "../src/lib/dancr/browser-session.ts";

const source=readFileSync(new URL("../outputs/index.html",import.meta.url),"utf8");
const authKey="dancrAuthSessionV1";
const account=(id="admin-a",role="admin")=>({accessToken:`synthetic-${id}`,account:{id,role,email:`${id}@example.invalid`}});
const declarations=["normalizeAccountEmail","accountEmailStorageKey","persistAccountEmail","sessionEmailForRole","clearRetiredAccountCaches","loadAuthSession","adminContentReviewStorageKey","loadSavedAdminContentReviews","writeSavedAdminContentReviews","adminContentReviewProfileKey","saveAdminContentReview","browserAccountIdentity","saveAuthSession","readAuthResumeStore","writeAuthResumeStore","pruneAuthResumeStore","takeAuthResume"];
function declaration(name){const start=source.indexOf(`    function ${name}(`);if(start<0)return "";const end=source.indexOf("\n    }",start);assert.ok(end>start);return source.slice(start,end+6);}
function fixture(initial=account()){
  const stored=new Map([[authKey,JSON.stringify(initial)],["unrelated","preserve"],["dancrAccountEmail:customer","old-customer@example.invalid"],["dancrAccountEmail:admin","old-admin@example.invalid"],["mydancr:admin-content-reviews:old-admin",JSON.stringify([{notes:"private legacy note"}])]]);
  const context={authSession:initial,authResumeStorageKey:"dancrAuthResumeV1",savedAdminContentReviews:[],savedAdminContentReviewAccount:"",visibleAuthAccountIdentity:"",clearCustomerPushDevice(){},updateCurrentEmailDisplays(){},
    localStorage:{get length(){return stored.size;},key:i=>[...stored.keys()][i]??null,getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}};
  vm.runInNewContext(declarations.map(declaration).join("\n"),context);
  return {context,stored};
}
test("normal session loading purges only retired personal-data caches",()=>{
  const f=fixture();assert.equal(f.context.loadAuthSession().account.id,"admin-a");
  assert.equal(f.stored.size,2);assert.equal(f.stored.get("unrelated"),"preserve");assert.ok(f.stored.has(authKey));
});
for(const role of ["customer","dancer","venue","admin"]){
  test(`email persistence for ${role} does not create another long-lived copy`,()=>{
    const f=fixture(account("a",role));f.context.persistAccountEmail(role,"new@example.invalid");assert.equal(f.stored.has(`dancrAccountEmail:${role}`),false);
  });
  test(`current ${role} account email comes only from its signed-in session`,()=>{
    const f=fixture(account("a",role));assert.equal(f.context.sessionEmailForRole(role),"a@example.invalid");
    f.context.authSession=null;assert.equal(f.context.sessionEmailForRole(role),"");
    f.context.authSession=account("b",role==="customer"?"dancer":"customer");assert.equal(f.context.sessionEmailForRole(role),"");
  });
}
test("role-only and tokenless account objects cannot reveal a saved email",()=>{
  for(const session of [{role:"customer"},{account:{role:"customer",email:"old@example.invalid"}},{accessToken:"synthetic",account:{role:"admin",email:"admin@example.invalid"}}]){
    const f=fixture(session);assert.equal(f.context.sessionEmailForRole("customer"),"");
  }
});
test("review notes remain available in the current admin page without browser persistence",()=>{
  const f=fixture();f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","rejected","Private note");
  const rows=f.context.loadSavedAdminContentReviews();assert.equal(rows.length,1);assert.equal(rows[0].notes,"Private note");
  assert.ok(!JSON.stringify([...f.stored]).includes("Private note"));assert.ok(![...f.stored.keys()].some(key=>key.startsWith("mydancr:admin-content-reviews:")));
  assert.equal(fixture().context.loadSavedAdminContentReviews().length,0,"a fresh page reloads authoritative server reviews");
});
for(const replacement of [null,account("admin-b"),account("admin-a","customer")]){
  test(`changing the session to ${replacement?.account.role||"signed out"}/${replacement?.account.id||"none"} clears review notes`,()=>{
    const f=fixture();f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","approved","Private note");
    f.context.saveAuthSession(replacement);assert.equal(f.context.savedAdminContentReviews.length,0);assert.equal(f.context.loadSavedAdminContentReviews().length,0);
    assert.equal(f.stored.get(authKey)??null,replacement?JSON.stringify(replacement):null);
  });
}
test("same-account credential refresh preserves current page review feedback",()=>{
  const f=fixture();f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","approved","Private note");
  f.context.saveAuthSession({...account(),accessToken:"synthetic-refreshed"});assert.equal(f.context.loadSavedAdminContentReviews().length,1);
});
test("review state cannot be reused after an externally replaced in-memory account",()=>{
  const f=fixture();f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","approved","Private note");
  f.context.authSession=account("admin-b");assert.equal(f.context.loadSavedAdminContentReviews().length,0);
});
test("anonymous, non-admin and unidentified sessions cannot save review notes",()=>{
  for(const session of [null,account("customer","customer"),{accessToken:"synthetic",account:{role:"admin"}}]){
    const f=fixture(session);f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","approved","Private note");assert.equal(f.context.savedAdminContentReviews.length,0);
  }
});
test("storage denial leaves current session email and in-page review feedback usable",()=>{
  const f=fixture();Object.defineProperty(f.context.localStorage,"length",{get(){throw new Error("blocked");}});
  f.context.localStorage.getItem=()=>{throw new Error("blocked");};f.context.localStorage.removeItem=()=>{throw new Error("blocked");};
  assert.doesNotThrow(()=>f.context.clearRetiredAccountCaches());assert.equal(f.context.sessionEmailForRole("admin"),"admin-a@example.invalid");
  f.context.saveAdminContentReview({id:"profile"},"photo","photo-id","approved","Private note");assert.equal(f.context.loadSavedAdminContentReviews().length,1);
});

test("unused signup/reset records expire after a day and future or malformed dates are removed",()=>{
  const f=fixture(),now=Date.now(),key=f.context.authResumeStorageKey;
  const valid={role:"customer",email:"current@example.invalid",createdAt:now-1000};
  f.stored.set(key,JSON.stringify({valid,expired:{...valid,createdAt:now-86400001},future:{...valid,createdAt:now+60000},missing:{role:"dancer"},invalid:{...valid,createdAt:"today"}}));
  assert.deepEqual(JSON.parse(JSON.stringify(f.context.readAuthResumeStore())),{valid});assert.deepEqual(JSON.parse(f.stored.get(key)),{valid});
});
test("resume records keep only the twenty newest entries",()=>{
  const f=fixture(),now=Date.now();const records=Object.fromEntries(Array.from({length:30},(_,index)=>[`token-${index}`,{role:"customer",createdAt:now-1000-index}]));
  f.context.writeAuthResumeStore(records);const retained=JSON.parse(f.stored.get(f.context.authResumeStorageKey));assert.equal(Object.keys(retained).length,20);assert.ok(retained["token-0"]);assert.ok(retained["token-19"]);assert.ok(!retained["token-20"]);
});
test("resume storage projects required navigation state without accidental credentials or unknown fields",()=>{
  const f=fixture(),state={role:"dancer",createdAt:Date.now()-1000,email:"current@example.invalid",destination:"/dashboard/dancer",setupStep:"profile",freshDancerVerification:true,scrollY:25};
  f.context.writeAuthResumeStore({token:{...state,password:"synthetic private password",accessToken:"synthetic token",profile:{notes:"private"},futurePrivateField:"private",city:"x".repeat(300)}});
  assert.deepEqual(JSON.parse(f.stored.get(f.context.authResumeStorageKey)),{token:state});
  assert.deepEqual(JSON.parse(JSON.stringify(f.context.takeAuthResume("token"))),state);assert.equal(f.stored.has(f.context.authResumeStorageKey),false);
});
for(const raw of ["{invalid","[]","null","x".repeat(262145)])test(`malformed or excessive resume cache is removed (${raw.length} bytes)`,()=>{
  const f=fixture();f.stored.set(f.context.authResumeStorageKey,raw);assert.deepEqual(Object.keys(f.context.readAuthResumeStore()),[]);assert.equal(f.stored.has(f.context.authResumeStorageKey),false);
});

for(const operation of [readBrowserAuthSession,clearBrowserAuthSession])test(`dedicated account pages purge retired caches during ${operation.name}`,()=>{
  const prior=globalThis.window,f=fixture();globalThis.window={localStorage:f.context.localStorage,navigator:{}};
  try{
    operation();assert.equal(f.stored.get("unrelated"),"preserve");assert.ok(![...f.stored.keys()].some(key=>key.startsWith("dancrAccountEmail:")||key.startsWith("mydancr:admin-content-reviews:")));
    assert.equal(f.stored.has(authKey),operation===readBrowserAuthSession);
  }finally{globalThis.window=prior;}
});
