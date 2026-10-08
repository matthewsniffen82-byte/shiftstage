import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { VENUE_SHARING_CONSENT_VERSION } from "../src/lib/dancr/venue-customers.ts";
const require=createRequire(import.meta.url);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function find(tree,predicate) {
  if(!tree||typeof tree!=="object")return;
  if(Array.isArray(tree))return tree.map(node=>find(node,predicate)).find(Boolean);
  return predicate(tree)?tree:find(tree.props?.children,predicate);
}
function fixture(component, request, props) {
  const source=ts.transpileModule(readFileSync(new URL("../app/dashboard/"+component+".tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const states=[],refs=[],effects=[],exports={};let si=0,ri=0,ei=0,pending=[];
  const imports={
    react:{useState(initial){const i=si++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==="function"?value(states[i]):value;}];},
      useRef(initial){const i=ri++;return refs[i]??=( {current:initial} );},
      useEffect(callback,deps){const i=ei++,prior=effects[i];if(!prior||deps.some((d,n)=>d!==prior.deps[n])){effects[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{effects[i].cleanup?.();effects[i].cleanup=callback();});}}},
    "react/jsx-runtime":require("react/jsx-runtime"),
    "./dashboard-session":{requestDashboardJson:request},
    "@/src/lib/dancr/venue-customers":{VENUE_SHARING_CONSENT_VERSION},
    "./venue-customers.css":{},
  };
  vm.runInNewContext(source,{exports,AbortController,Map,Date,JSON,encodeURIComponent,document:{visibilityState:"visible",addEventListener(){},removeEventListener(){}},
    FormData:class {constructor(values){this.values=values;}get(key){return this.values[key]??null;}},
    require:name=>{assert.ok(imports[name],name);return imports[name];}});
  return {render(next=props){si=ri=ei=0;pending=[];const tree=exports.default(next);pending.forEach(run=>run());return tree;},
    close(){effects.forEach(effect=>effect.cleanup?.());}};
}
test("following has no automatic sharing request; the explicit consent checkbox starts unchecked",async()=>{
  const requests=[];const f=fixture("VenueCustomerSharing",async(path,options)=>{requests.push([path,options]);return {share:null,email:"me@example.test"};},{venueId:"venue",venueName:"Example Club",disabled:false});
  const closed=f.render();assert.equal(requests.length,0);
  closed.props.onToggle({currentTarget:{open:true}});f.render();await flush();
  const tree=f.render(),checkbox=find(tree,n=>n.type==="input"&&n.props.name==="consent");
  assert.ok(checkbox);assert.equal(checkbox.props.required,true);assert.equal(checkbox.props.defaultChecked,undefined);assert.equal(checkbox.props.checked,undefined);
  assert.equal(requests.length,1);assert.equal(requests[0][1].expectedRole,"customer");f.close();
});
test("customer consent is separate from following and can be withdrawn",async()=>{
  const requests=[];const f=fixture("VenueCustomerSharing",async(_path,options)=>{
    if(!options.body)return {share:null,email:"me@example.test"};
    const body=JSON.parse(options.body);requests.push(body);
    return {share:body.sharing?{name:body.name,email:body.email,city:body.city}:null};
  },{venueId:"venue",venueName:"Example Club",disabled:false});
  f.render().props.onToggle({currentTarget:{open:true}});f.render();await flush();
  await find(f.render(),n=>n.type==="form").props.onSubmit({preventDefault(){},currentTarget:{name:"My chosen name",city:"Las Vegas",consent:"on"}});
  assert.equal(requests[0].consent,true);assert.equal(requests[0].consentVersion,VENUE_SHARING_CONSENT_VERSION);assert.equal(requests[0].email,"me@example.test");
  const stop=find(f.render(),n=>n.type==="button"&&n.props.children==="Stop sharing");assert.ok(stop);
  stop.props.onClick();await flush();assert.equal(requests[1].sharing,false);
  assert.ok(find(f.render(),n=>n.type==="form"));f.close();
});
test("a venue authorization failure clears already displayed private contacts",async()=>{
  let fail=false;
  const f=fixture("VenueCustomersPanel",async()=>{if(fail)throw new Error("Access removed");return {entries:[{id:"person",name:"Private Person",email:"person@example.test",is_follower:true,joined_at:"2026-10-01"}],hasMore:false};},{refreshKey:"owner",active:true});
  f.render();await flush();assert.ok(find(f.render(),n=>n.type==="strong"&&n.props.children==="Private Person"));
  fail=true;find(f.render(),n=>n.type==="button"&&n.props.children==="Refresh").props.onClick();await flush();
  const tree=f.render();assert.equal(find(tree,n=>n.type==="strong"&&n.props.children==="Private Person"),undefined);assert.ok(find(tree,n=>n.props.role==="alert"));f.close();
});
