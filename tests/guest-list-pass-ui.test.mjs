import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as transportation from "../src/lib/dancr/club-deal-transportation.ts";
import * as copy from "../src/lib/dancr/deal-copy.ts";

function render(file, method, scanner = false, schedule = {}, now = Date.now(), runtime = {}) {
  let stateIndex=0;
  const exports={};
  const imports={
    "react/jsx-runtime":jsx,
    react:{useState(value){return [scanner && stateIndex++ === 3 ? "staff-token" : value,()=>{}];},useEffect:runtime.useEffect || (()=>{}),useRef(value){return {current:value};}},
    "next/link":{default:"a"},
    "./AdmissionPassSaveButton":{default:()=>null},
    "@/src/lib/dancr/club-deal-transportation":transportation,
    "@/src/lib/dancr/deal-copy":copy,
    "@/src/lib/dancr/browser-session":{readBrowserAccessToken:()=>"staff-token"},
    "@/app/dashboard/dashboard-session":{requestDashboardJson(){throw new Error("Render must not send a request");}},
  };
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source,{exports,Date:class extends Date { static now(){return runtime.clock?.() ?? now;} },Intl,...runtime,require(name){assert.ok(name in imports,name);return imports[name];}});
  const Component=scanner?exports.RedeemDealClient:exports.default;
  return renderToStaticMarkup(Component({token:"p".repeat(43),qrImage:"/test-qr.png",initialRedemption:{
    isAdmissionPass:true,status:"generated",arrivalMethod:method,expiresAt:new Date(now+3600000).toISOString(),
    venue:{name:"Test Club",timezone:"UTC"},deal:{dealTitle:"Free Entry",dealDescription:"Receive one complimentary general-admission entry after cashier confirmation.",isActive:true,dealTerms:transportation.CLUB_TRANSPORTATION_TERMS+" Valid ID required.",...schedule},
  }}));
}

test("guests see the offer hours before opening and the door QR only during the offer",()=>{
  const schedule={validDays:["Wednesday"],validStartTime:"19:00:00",validEndTime:"22:00:00"};
  for(const [utc,open] of [["12:00",false],["19:00",true],["22:00",false]]){
    const html=render("../app/deals/pass/[token]/AdmissionPassClient.tsx","guest_list",false,schedule,Date.parse("2026-11-11T"+utc+":00Z"));
    assert.equal(html.includes("Outside offer hours"),!open);
    assert.equal(html.includes("Your admission QR code"),open);
    assert.equal(html.includes("Ready to use"),open);
    assert.match(html,/7:00 PM–10:00 PM/);
  }
});

test("overnight offers use the club’s opening day, including a daylight saving transition",()=>{
  const schedule={validDays:["Saturday"],validStartTime:"20:00",validEndTime:"03:00"};
  const open=time=>transportation.isAdmissionOfferOpen(schedule,"America/Los_Angeles",Date.parse(time));
  for(const time of ["2026-11-01T03:00Z","2026-11-01T08:30Z","2026-11-01T09:30Z"])assert.equal(open(time),true);
  assert.equal(open("2026-11-01T11:00Z"),false);
  assert.equal(open("2026-11-02T09:30Z"),false);
});

test("admission polling coalesces focus and interval refreshes and waits for Retry-After",async()=>{
  const start=Date.now(), intervals=[], cleanups=[], listeners=new Map(), calls=[];
  let clock=start;
  const events={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const runtime={clock:()=>clock,AbortController,useEffect:fn=>cleanups.push(fn()),
    window:{...events,setInterval:(fn,delay)=>{intervals.push({fn,delay});return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}},
    document:{...events,visibilityState:"visible"},fetch:async()=>{calls.push(clock);return new Response(null,{status:429,headers:{"retry-after":"90"}});}
  };
  render("../app/deals/pass/[token]/AdmissionPassClient.tsx","guest_list",false,{},start,runtime);
  const poll=intervals.find(timer=>timer.delay===30000);
  assert.ok(poll);assert.equal(calls.length,0);
  clock+=poll.delay;await Promise.all([poll.fn(),listeners.get("focus")()]);assert.equal(calls.length,1);
  clock+=60000;await listeners.get("focus")();assert.equal(calls.length,1);
  clock+=30000;await listeners.get("focus")();assert.equal(calls.length,2);
  cleanups.forEach(cleanup=>cleanup());
});

test("guest-list passes and scanner instructions show guest-list admission with the venue rules",()=>{
  const pass=render("../app/deals/pass/[token]/AdmissionPassClient.tsx","guest_list");
  const scanner=render("../app/deals/redeem/[token]/RedeemDealClient.tsx","guest_list",true);
  assert.match(pass,/1 guest · Guest list/);assert.match(pass,/Staff verifies guest-list registration/);
  assert.match(pass,/<h1>Guest list<\/h1>/);assert.match(pass,/club determines any cover charge/);
  assert.doesNotMatch(pass,/<h1>Free Entry<\/h1>/);
  assert.match(scanner,/Admission: Guest list/);assert.match(scanner,/I verified this guest’s guest-list admission and entry requirements/);
  assert.doesNotMatch(scanner,/Receive one complimentary/);
  assert.match(scanner,/The club determines any cover charge/);
  for(const html of [pass,scanner]){
    assert.match(html,/Valid ID required/);
    assert.doesNotMatch(html,/eligible arrival method|private car|Waymo|rideshares or taxis/);
  }
});

test("transportation passes retain their arrival restrictions and staff verification",()=>{
  const pass=render("../app/deals/pass/[token]/AdmissionPassClient.tsx","self_drive");
  const scanner=render("../app/deals/redeem/[token]/RedeemDealClient.tsx","self_drive",true);
  assert.match(pass,/1 guest · Private car/);assert.match(pass,/Staff verifies arrival/);
  assert.match(scanner,/Arrival method: Private car/);assert.match(scanner,/eligible arrival method/);
  for(const html of [pass,scanner])assert.match(html,/Uber, Lyft/);
});
