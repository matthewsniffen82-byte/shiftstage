import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { isLiquorRelatedClubDeal } from '../src/lib/dancr/deal-policy.ts';
import { customerFacingDealTitle } from '../src/lib/dancr/deal-copy.ts';

function load(path, imports, extra = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Set, Map, require:name=>imports[name] || {}, ...extra });
  return exports;
}
const deals = load('../src/lib/dancr/deals.ts', { './deal-policy':{isLiquorRelatedClubDeal} });
const warnings = [];
const { getCustomerPlanEntryDeals } = load('../src/lib/dancr/customer-plan-entry.ts', {
  './deals':deals, './deal-copy':{customerFacingDealTitle},
}, { console:{warn:message=>warnings.push(message)} });
const now = Date.parse('2026-10-11T18:00:00Z');
const plan = (id, changes = {}) => ({ shift:{status:'posted',endsAt:'2026-10-12T08:00:00Z',venue:{id},...changes} });
const offer = (id, venue_id, changes = {}) => ({ id, venue_id, deal_title:'Free admission', offer_type:'admission', is_active:true, payout_type:'flat', payout_amount_cents:1000, sort_order:0, ...changes });
const copy = value=>JSON.parse(JSON.stringify(value));

function fixture(rows, error = null) {
  const calls = [];
  return { calls, from(table) {
    const call = {table,methods:[]}; calls.push(call);
    const query = new Proxy({}, { get(_target,key) {
      if (key === 'then') return (resolve,reject) => {
        const matches = rows.filter(row=>call.methods.every(([method,column,value])=>
          method==='in' ? value.includes(row[column]) : method==='eq' ? row[column]===value : method==='gt' ? row[column]>value : true));
        return Promise.resolve({data:matches,error}).then(resolve,reject);
      };
      return (...args)=>{call.methods.push([key,...args]); return query;};
    } });
    return query;
  } };
}

test('plan entry lookup uses the existing active offer query and exposes only an eligible deal ID', async () => {
  const client = fixture([
    offer('inactive','club',{is_active:false}), offer('unfunded','club',{payout_amount_cents:0}),
    offer('paid','club',{deal_title:'Half-off admission'}), offer('other','club',{offer_type:'other'}),
    offer('alcohol','club',{deal_description:'Free beer'}), offer('free','club'),
    offer('unrelated','another-club'),
  ]);
  assert.deepEqual(copy(await getCustomerPlanEntryDeals(client,[plan('club'),plan('club')],now)), {club:'free'});
  assert.equal(client.calls.length,1);
  assert.equal(client.calls[0].table,'club_deals');
  assert.deepEqual(copy(client.calls[0].methods.filter(([method])=>['in','eq','gt'].includes(method))), [
    ['in','venue_id',['club']], ['eq','is_active',true], ['eq','payout_type','flat'], ['gt','payout_amount_cents',0],
  ]);
});

test('clubs without free admission, cancelled plans, expired plans and missing venues have no entry action', async () => {
  const client = fixture([offer('paid','club',{deal_title:'Half-off admission'})]);
  assert.deepEqual(copy(await getCustomerPlanEntryDeals(client,[plan('club')],now)),{});
  client.calls.length = 0;
  assert.deepEqual(copy(await getCustomerPlanEntryDeals(client,[plan('club',{status:'cancelled'}),plan('club',{endsAt:new Date(now).toISOString()}),plan(null),{shift:null}],now)),{});
  assert.equal(client.calls.length,0);
});

test('public offer lookup stays bounded and accepts the Free Entry title', async () => {
  const ids = Array.from({length:201},(_,i)=>`club-${i}`);
  const client = fixture(ids.map(id=>offer(`deal-${id}`,id,{deal_title:'Free Entry'})));
  const result = await getCustomerPlanEntryDeals(client,ids.map(id=>plan(id)),now);
  assert.equal(Object.keys(result).length,201);
  assert.deepEqual(client.calls.map(call=>call.methods.find(([method])=>method==='in')[2].length),[200,1]);
});

test('an optional offer lookup failure leaves plans available without stale entry actions', async () => {
  const client = fixture([],{code:'unavailable'});
  assert.deepEqual(copy(await getCustomerPlanEntryDeals(client,[plan('club')],now)),{});
  assert.equal(warnings.at(-1),'CUSTOMER_PLAN_ENTRY_DEALS_UNAVAILABLE');
});

test('saved activity exposes entry IDs only for the authenticated customer’s visible plans', async () => {
  const client = fixture([offer('free','club'),offer('unrelated','another-club')]);
  const requestClient = {}, session = {accessToken:'synthetic-session'};
  const savedItems = {goingSignals:[plan('club')],follows:[]};
  const { GET } = load('../app/api/customer/saved/route.ts', {
    'next/server':{NextResponse:{json:value=>value}},
    '@/src/lib/api':{apiError:error=>{throw error;}},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:requestClient,user:{id:'customer'},session})},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/dancr/customer':{
      getCustomerSavedItems:async (request,id,publicClient)=>{
        assert.equal(request,requestClient); assert.equal(id,'customer'); assert.equal(publicClient,client); return savedItems;
      },
      getCustomerSavedClubDeals:async()=>[],
    },
    '@/src/lib/dancr/deals':{getCustomerDealRedemptions:async()=>[]},
    '@/src/lib/dancr/customer-plan-entry':{getCustomerPlanEntryDeals:(publicClient,plans)=>getCustomerPlanEntryDeals(publicClient,plans,now)},
  });
  const response = await GET({});
  assert.equal(response.session,session);
  assert.equal(response.saved.goingSignals,savedItems.goingSignals);
  assert.deepEqual(copy(response.saved.planEntryDeals),{club:'free'});
});
