import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as transportation from "../src/lib/dancr/club-deal-transportation.ts";
import * as copy from "../src/lib/dancr/deal-copy.ts";

function render(file, method, scanner = false) {
  let stateIndex=0;
  const exports={};
  const imports={
    "react/jsx-runtime":jsx,
    react:{useState(value){return [scanner && stateIndex++ === 3 ? "staff-token" : value,()=>{}];},useEffect(){},useRef(value){return {current:value};}},
    "next/link":{default:"a"},
    "@/src/lib/dancr/club-deal-transportation":transportation,
    "@/src/lib/dancr/deal-copy":copy,
    "@/src/lib/dancr/browser-session":{readBrowserAccessToken:()=>"staff-token"},
    "@/app/dashboard/dashboard-session":{requestDashboardJson(){throw new Error("Render must not send a request");}},
  };
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source,{exports,Date,Intl,require(name){assert.ok(name in imports,name);return imports[name];}});
  const Component=scanner?exports.RedeemDealClient:exports.default;
  return renderToStaticMarkup(Component({token:"p".repeat(43),qrImage:"/test-qr.png",initialRedemption:{
    isAdmissionPass:true,status:"generated",arrivalMethod:method,expiresAt:new Date(Date.now()+3600000).toISOString(),
    venue:{name:"Test Club",timezone:"UTC"},deal:{dealTitle:"Free Entry",isActive:true,dealTerms:transportation.CLUB_TRANSPORTATION_TERMS+" Valid ID required."},
  }}));
}

test("guest-list passes and scanner instructions show guest-list admission with the venue rules",()=>{
  const pass=render("../app/deals/pass/[token]/AdmissionPassClient.tsx","guest_list");
  const scanner=render("../app/deals/redeem/[token]/RedeemDealClient.tsx","guest_list",true);
  assert.match(pass,/1 guest · Guest list/);assert.match(pass,/Staff verifies guest-list registration/);
  assert.match(pass,/<h1>Guest list<\/h1>/);assert.match(pass,/venue determines any cover charge/);
  assert.doesNotMatch(pass,/<h1>Free Entry<\/h1>/);
  assert.match(scanner,/Admission: Guest list/);assert.match(scanner,/I verified this guest’s guest-list admission and entry requirements/);
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
