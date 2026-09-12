import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { toPublicClubDeal } from "../src/lib/dancr/public-club-deal.ts";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id="10000000-0000-4000-8000-000000000001", venueId="20000000-0000-4000-8000-000000000002";
const visible={id,venueId,dealTitle:"Free admission",dealDescription:"Synthetic offer",dealTerms:"Valid tonight",isActive:true,validDays:["fri"],validStartTime:"18:00",validEndTime:"23:59",offerType:"admission",bookingUrl:null,sortOrder:2};
const internal={...visible,payoutType:"flat",payoutAmountCents:7654,currency:"usd",redemptionRules:{private:"synthetic internal receipt"},futurePrivateField:{email:"private@example.invalid"}};
const copy=value=>JSON.parse(JSON.stringify(value));
const query = data => { const chain = new Proxy({ then: resolve=>Promise.resolve(resolve({data,error:null})) },{get:(target,key)=>target[key]||(()=>chain)});return chain; };
function load(path, dependencies={},globals={},selectedSource) {
  const exports={};
  const source=selectedSource||read(path);
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compiled,{exports,Request,Response,URL,URLSearchParams,console:{log(){},info(){},warn(){},error(){}},require:name=>{
    if(name in dependencies)return dependencies[name];
    if(name==="@/src/lib/dancr/public-club-deal"||name==="./public-club-deal")return {toPublicClubDeal};
    if(name==="next/server")return require(name);
    if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==="next/navigation")return {notFound(){throw new Error("not found");},permanentRedirect(){throw new Error("redirect");}};
    if(name==="@/src/lib/supabase/admin")return {createAdminSupabaseClient:()=>({from:()=>query([])})};
    return {};
  },...globals});return exports;
}
for (const [field,value] of Object.entries(internal).filter(([key])=>!(key in visible))) {
  test(`public deal mapper excludes ${field} and preserves customer fields`,()=>{
    const input={...visible,[field]:value};assert.deepEqual(copy(toPublicClubDeal(input)),visible);assert.deepEqual(input,{...visible,[field]:value});
  });
}
test("discovery JSON removes internal fields from both venue and dancer offer lists",async()=>{
  const dancer={id:"dancer",venueId,shiftId:"shift",shiftSource:"nfc_presence"};
  const client={from:()=>query([{id:venueId,name:"Venue"}])};
  const route=load("app/api/public/discovery/route.ts",{
    "@/src/lib/supabase/admin":{createAdminSupabaseClient:()=>client},
    "@/src/lib/dancr/markets":{isAllMyDancrCities:()=>false},
    "@/src/lib/dancr/public":{getLiveDancerDiscovery:async()=>({dancers:[dancer],tonightDancers:[dancer]}),getPublicVenuePopularity:async()=>new Map(),formatVenueHours:()=>"Tonight"},
    "@/src/lib/dancr/deals":{getActiveClubDealListsForVenues:async()=>new Map([[venueId,[internal]]])},
    "@/src/lib/dancr/responsive-image":{responsivePublicImage:()=>null},
    "@/src/lib/dancr/venue-branding":{verifiedVenueLogoUrl:()=>null},
    "@/src/lib/dancr/deal-attribution":{createDancerDealAttributionToken:input=>`attribution-${input.dealId}`},
    "@/src/lib/dancr/public-cache-policy":{PUBLIC_DYNAMIC_CACHE_CONTROL:"public, max-age=5"},
  });
  const response=await route.GET(new Request("https://example.test/api/public/discovery"));assert.equal(response.status,200);
  const body=await response.json();
  for(const item of [...body.venues,...body.dancers,...body.tonightDancers]){assert.deepEqual(item.activeDeal,visible);assert.deepEqual(item.activeDeals,[visible]);}
  assert.equal(body.dancers[0].dealAttributionTokens[id],`attribution-${id}`);
  assert.deepEqual(internal.redemptionRules,{private:"synthetic internal receipt"});
});
function nfcFixture() {
  let redemptions=0;
  const tag={id:"tag",type:"cashier",venueId,venue:{name:"Venue"}};
  const route=load("app/api/nfc/[token]/route.ts",{
    "@/src/lib/dancr/nfc":{resolveNfcTag:async()=>tag,recordNfcTagScan:async()=>{}},
    "@/src/lib/dancr/deals":{getActiveClubDealsForVenue:async()=>[internal]},
    "@/src/lib/dancr/public-request-rate-limit":{enforcePublicRequestRateLimit:async()=>{},PublicRequestRateLimitError:class extends Error{}},
    "@/src/lib/bounded-json-body":{readBoundedJsonObject:request=>request.json()},
    "@/src/lib/dancr/cashier-deal-redemption":{completeCashierDealRedemption:async()=>{redemptions++;return {deal:internal,confirmation:{status:"redeemed"},sourceType:"club_page"};}},
  });return {route,count:()=>redemptions};
}
test("NFC offer lookup serializes the public projection without issuing a redemption",async()=>{
  const f=nfcFixture();const response=await f.route.GET(new Request("https://example.test/api/nfc/tag"),{params:Promise.resolve({token:"tag"})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).deals,[visible]);assert.equal(f.count(),0);
});
test("NFC completion minimizes the deal as well as the financial confirmation",async()=>{
  const f=nfcFixture();const response=await f.route.POST(new Request("https://example.test/api/nfc/tag",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:id,dealId:id,sourceType:"club_page"})}),{params:Promise.resolve({token:"tag"})});
  assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.deal,visible);assert.equal(body.confirmation.status,"redeemed");assert.equal(f.count(),1);
});
test("TV enrichment selects public deal fields while preserving attribution",async()=>{
  const path="src/lib/dancr/tv.ts",source=read(path);
  const start=source.indexOf("export async function getPublicMyDancrTvFeed("),end=source.indexOf("\nfunction publicTvRowsQuery",start);
  assert.ok(start>0&&end>start);
  const video={id:"video",dancer:{id:"dancer",city:"Vegas"},venue:{id:venueId},shift:{id:"shift",isActive:true}};
  const service=load(path,{}, {
    normalizeTvCity:()=>"",MYDANCR_TV_FILTERS:new Set(["for-you"]),UUID_PATTERN:/^[a-f0-9-]+$/,MYDANCR_TV_PROFILE_VIDEO_LIMIT:50,
    publicTvRowsQuery:()=>query([video]),normalizeFeedRow:row=>row,getPublicTvShiftContexts:async()=>new Map(),applyPublicTvShiftContext:row=>row,
    diversifyFeed:rows=>rows,prioritizeMyDancrTvVenue:rows=>rows,signPublicVideos:async(_admin,rows)=>rows,
    getActiveClubDealListsForVenues:async()=>new Map([[venueId,[internal]]]),createDancerDealAttributionToken:input=>`attribution-${input.dealId}`,toPublicClubDeal,
  },source.slice(start,end));
  const rows=await service.getPublicMyDancrTvFeed({},{});assert.equal(rows.length,1);assert.deepEqual(copy(rows[0].deal),visible);assert.deepEqual(copy(rows[0].deals),[visible]);assert.equal(rows[0].dealAttributionToken,`attribution-${id}`);
});
function walk(node,visit){if(!node||typeof node!=="object")return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==="object")walk(value,visit);}
test("claim page passes only public offer props to its client component",async()=>{
  const page=load("app/deals/claim/[dealId]/page.tsx",{
    "@/src/lib/dancr/deal-campaign":{verifyVenueDealCampaignToken:()=>({dealId:id,venueId})},
    "@/src/lib/dancr/deals":{getActiveClubDealById:async()=>internal},
  });
  const tree=await page.default({params:Promise.resolve({dealId:id}),searchParams:Promise.resolve({campaign:"synthetic"})});assert.deepEqual(copy(tree.props.deal),visible);
});
test("dancer page passes public offer props across the React client boundary",async()=>{
  const profile={id:"dancer",slug:"fixture",stageName:"Fixture",city:"Vegas",photos:[],socialLinks:[],upcomingShifts:[{id:"shift",venueId,venueName:"Venue",venueSlug:"venue",shiftSource:"nfc_presence",startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+60000).toISOString()}]};
  const page=load("app/dancers/[slug]/page.tsx",{
    "@/src/lib/dancr/public":{getDancerProfile:async()=>profile,getVenueProfile:async()=>null},
    "@/src/lib/dancr/deals":{getActiveClubDealsForVenue:async()=>[internal]},
    "@/src/lib/dancr/tv":{getPublicMyDancrTvFeed:async()=>[]},
    "@/src/lib/dancr/shift-presence":{isActiveNfcPresence:()=>true},
    "@/src/lib/dancr/image-focal-point":{imageFocalPointCss:()=>"50% 50%"},
    "@/src/lib/dancr/deal-attribution":{createDancerDealAttributionToken:()=>"synthetic-attribution"},
  });
  const tree=await page.default({params:Promise.resolve({slug:"fixture"})});const deals=[];
  walk(tree,node=>{if(node.props?.deal)deals.push(node.props);});assert.equal(deals.length,1);assert.deepEqual(copy(deals[0].deal),visible);assert.deepEqual(copy(deals[0].deals),[visible]);assert.equal(deals[0].attributionToken,"synthetic-attribution");
});
