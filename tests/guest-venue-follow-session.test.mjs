import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const home = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/customer/venue-follows/route.ts', import.meta.url), 'utf8');
const key = 'dancrAuthSessionV1';
function between(start, end) {
 const a=home.indexOf(start), b=home.indexOf(end,a+start.length);
 assert.ok(a>=0 && b>a); return home.slice(a,b);
}
function headersFixture(stored, blocked=false) {
 const context=createDiscoveryContext({authSession:{accessToken:'old-access',refreshToken:'old-refresh'},localStorage:{getItem(){if(blocked)throw new Error('blocked');return stored ? JSON.stringify(stored) : null;}}});
 vm.runInContext(between('    function synchronizeAuthSession()', '    function applyResponseSession('),context);
 return context;
}
test('homepage requests use session credentials refreshed by the dashboard',()=>{
 const context=headersFixture({accessToken:'new-access',refreshToken:'new-refresh'});
 const headers=context.authenticatedRequestHeaders('application/json');
 assert.equal(headers.Authorization,'Bearer new-access');
 assert.equal(headers['X-Dancr-Refresh-Token'],'new-refresh');
 assert.equal(headers['Content-Type'],'application/json');
});
test('a removed browser session cannot be resurrected from a cached homepage',()=>{
 assert.equal(headersFixture(null).authenticatedRequestHeaders(),null);
});
test('blocked browser storage retains a usable in-memory session',()=>{
 assert.equal(headersFixture(null,true).authenticatedRequestHeaders().Authorization,'Bearer old-access');
});

for(const following of [true,false])test(`venue ${following?'follow':'unfollow'} returns refreshed credentials and scopes the write to the authenticated guest`,async()=>{
 const writes=[]; const session={accessToken:'renewed-access',refreshToken:'renewed-refresh'};
 const user={id:'signed-in-guest'}; const venueId='11111111-1111-4111-8111-111111111111';
 const exports={};
 const context=createDiscoveryContext({exports,require(name){
  if(name==='next/server')return {NextResponse:{json:Response.json}};
  if(name.endsWith('/request'))return {createRequestSupabaseContext:async()=>({user,session,client:{from:(table)=>({upsert:async(row)=>{writes.push({table,row});return {error:null};}})}})};
  if(name.endsWith('/admin'))return {createAdminSupabaseClient:()=>({})};
  if(name.endsWith('/bounded-json-body'))return {readBoundedJsonObject:async(request)=>request.json()};
  if(name.endsWith('/public-request-rate-limit'))return {enforcePublicRequestRateLimit:async()=>{},PublicRequestRateLimitError:class extends Error{}};
  if(name.endsWith('/resource-authorization'))return {requirePublicVenue:async()=>{}};
  if(name.endsWith('/customer'))return {unfollowVenue:async(_client,customerId,id)=>writes.push({customerId,venueId:id})};
  if(name.endsWith('/api'))return {apiError:(error)=>{throw error;}};
  throw new Error(name);
 }});
 vm.runInContext(ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const result=await exports.POST(new Request('https://example.test/api/customer/venue-follows',{method:'POST',body:JSON.stringify({venueId,following})}));
 const data=await result.json();
 assert.deepEqual(data.session,session);assert.equal(data.following,following);assert.equal(writes.length,1);
 assert.equal(following?writes[0].row.customer_id:writes[0].customerId,user.id);
});

for(const succeeds of [true,false])test(`venue save ${succeeds?'refreshes credentials before saving':'does not claim success for an expired sign-in'}`,async()=>{
 const calls=[],notices=[],saved=[];const button={dataset:{venueFollow:'Test Club'},disabled:false,setAttribute(){},removeAttribute(){}};
 const context=createDiscoveryContext({
  event:{target:{closest:()=>button},preventDefault(){},stopPropagation(){}},
  requireCustomerAccountForProfileAction:()=>true,citySelect:{value:'Test City'},markets:{'Test City':{venues:[{name:'Test Club',id:'club-id'}]}},followedVenuesByCity:{'Test City':saved},
  getAuthenticatedJson:async()=>{calls.push('refresh');if(!succeeds)throw new Error('Sign in required.');},
  postAuthenticatedJson:async()=>{calls.push('follow');return {ok:true,following:true};},
  customerSavedStateVersion:0,actionButtonLabel:(_icon,label)=>label,
  render(){},customerDashboard:{classList:{contains:()=>false}},renderDashboard(){},
  showToast:(text)=>notices.push(text),openAuthRole:()=>calls.push('sign-in'),setCustomerAuthStatus:(text)=>notices.push(text),
 });
 vm.runInContext('async function save(){'+between('      const followVenueButton = event.target.closest("[data-venue-follow]");','      const venueJump = event.target.closest("[data-venue-jump]");')+'}',context);
 await context.save();
 assert.deepEqual(calls,succeeds?['refresh','follow']:['refresh','sign-in']);
 assert.equal(context.followedVenuesByCity['Test City'].length,succeeds?1:0);
 if(!succeeds){assert.equal(button.disabled,false);assert.match(notices[0],/expired/);}
});

function createDiscoveryContext(values) {
  const context = vm.createContext({ ALL_CITIES: "All cities", allCitiesMarket: { dancers: [], venues: [] }, ...values });
  const start = home.indexOf("    function discoveryMarket(");
  const end = home.indexOf("    const citySelect =", start);
  vm.runInContext(home.slice(start, end), context);
  const resolver = home.match(/    function resolveVenueByName\([\s\S]*?\n    }/)[0];
  context.slugify = value => String(value).toLowerCase().replaceAll(' ', '-');
  vm.runInContext(resolver, context);
  return context;
}
