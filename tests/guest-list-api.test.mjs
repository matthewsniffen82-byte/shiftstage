import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {normalizeGuestListDetails} from '../src/lib/dancr/guest-list.ts';
const require=createRequire(import.meta.url),{NextResponse}=require('next/server');
const source=ts.transpileModule(readFileSync(new URL('../app/api/venue/guest-list/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({access=true,authenticated=true,permissions=['view_deals'],rows=[],error=null}={}){
 const calls=[],exports={},query={};
 const browserClient={from(){assert.fail('Private venue ownership must not be read through the browser client');}};
 const adminClient={from(table){calls.push(['from',table]);assert.equal(table,'venue_guest_list_entries');return query;}};
 for(const method of ['select','eq','gt','in','order'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
 query.range=async(...args)=>{calls.push(['range',...args]);return {data:rows,error};};
 const imports={
  'next/server':{NextResponse},'@/src/lib/api-error-policy':{PublicApiError},
  '@/src/lib/api':{apiError(error,fallback){const r=resolveApiError(error,fallback);return NextResponse.json(r.body,{status:r.status});}},
  '@/src/lib/supabase/request':{async createRequestSupabaseContext(_request,options){assert.equal(options.role,'venue');if(!authenticated)throw new PublicApiError('UNAUTHORIZED','Sign in.',401);return {client:browserClient,user:{id:'staff'},session:{accessToken:'renewed'}};}},
  '@/src/lib/dancr/venue-access':{async getVenueAccess(client,userId){assert.equal(client,adminClient,'Resolve ownership with the server client');assert.equal(userId,'staff','Use the verified identity, never a supplied venue/user ID');return access?{venueId:'authorized-venue',permissions}:null;}},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient(){calls.push('admin');return adminClient;}},
 };
 vm.runInNewContext(source,{exports,URL,Date,Number,require:name=>{assert.ok(name in imports,name);return imports[name];}});
 return {calls,get:(search='')=>exports.GET(new Request('https://mydancr.com/api/venue/guest-list'+search))};
}
test('guest list is limited to the authenticated venue and never returns pass tokens',async()=>{
 const row={pass_id:'entry',guest_name:'Guest',phone:'+17025550123',email:null,created_at:'2026-09-30',redemption_token:'private',qr_redemptions:{expires_at:'2026-10-01',arrival_method:'self_drive',status:'generated',redemption_token:'private'}};
 const f=fixture({rows:Array(51).fill(row)}),r=await f.get('?venueId=forged&offset=50'),body=await r.json();
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='venue_id'&&c[2]==='authorized-venue'));
 assert.ok(f.calls.some(c=>c[0]==='range'&&c[1]===50&&c[2]===100));
 assert.equal(body.entries.length,50);assert.equal(body.hasMore,true);assert.doesNotMatch(JSON.stringify(body),/redemption_token|private/);
});
test('anonymous, revoked and invalid paging requests cannot read guest contact details',async()=>{
 for(const [options,query,status]of [[{authenticated:false},'',401],[{access:false},'',403],[{permissions:[]},'',403],[{},'?offset=-1',400],[{},'?offset=NaN',400]]){
  const f=fixture(options),response=await f.get(query);assert.equal(response.status,status);assert.equal(f.calls.some(call=>call[0]==='from'),false,'Do not query guest data before authorization and paging checks pass');
  if(options.authenticated===false)assert.equal(f.calls.includes('admin'),false);
 }
});

test('an authorized empty guest list succeeds while database failures remain errors',async()=>{
 const empty=await fixture().get();assert.equal(empty.status,200);
 const body=await empty.json();assert.deepEqual(body.entries,[]);assert.equal(body.hasMore,false);assert.equal(body.session.accessToken,'renewed');
 const failed=await fixture({error:{code:'XX000',message:'Private database diagnostic'}}).get();
 assert.equal(failed.status,500);const failure=await failed.json();assert.equal(failure.ok,false);assert.equal(failure.error,'Unable to load the guest list.');
 assert.doesNotMatch(JSON.stringify(failure),/Private database diagnostic/);
});
test('guest validation keeps international names and phones and rejects invalid contact data',()=>{
 assert.deepEqual(normalizeGuestListDetails({name:'  María Guest  ',phone:'+44 7700 900123',email:'',consent:true}),{name:'María Guest',phone:'+447700900123',email:'',consent:true});
 for(const override of [{name:'bad\nname'},{name:'a'.repeat(101)},{phone:'7025550123 ext 2'},{email:'<script>@bad.test'},{consent:'true'}])assert.equal(normalizeGuestListDetails({name:'Test Guest',phone:'7025550123',email:'',consent:true,...override}),null);
});

test('Free Entry opens the arrival page directly and keeps the selected offer attribution',()=>{
 const script=readFileSync(new URL('../src/live-shell/app/08-save-customer-deal-pass.js',import.meta.url),'utf8');
 const selection=script.match(/    function selectDealPassForNfc\([^]*?\n    \}/)?.[0];assert.ok(selection);
 let destination;const context={URLSearchParams,encodeURIComponent,pendingNfcDealIntentForPass:()=>({passUrl:'/deals/pass/old',expired:false}),window:{location:{assign:url=>{destination=url;}}}};
 vm.createContext(context);vm.runInContext(selection,context);
 context.selectDealPassForNfc({dealId:'offer',sourceType:'dancer_profile',dancerId:'dancer',attributionToken:'signed'},true);
 const url=new URL(destination,'https://mydancr.com');assert.equal(url.pathname,'/deals/transportation/offer');assert.equal(url.searchParams.get('attributionToken'),'signed');assert.equal(url.searchParams.get('dancerId'),'dancer');
 assert.match(script,/createRevenueDealPass\(config\);\s*selectDealPassForNfc\(pass, true\)/);
 const reactCard=readFileSync(new URL('../app/components/ClubDealCard.tsx',import.meta.url),'utf8');
 assert.match(reactCard,/offerDeals.length === 1 && displayTitle === "Free Entry"[\s\S]*?selectForNfcTap\(true\)/);
});
