import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { compileVip, dashboardHarness, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';
import { filterVipDancers, isVipFavorite } from '../src/lib/dancr/vip-dashboard.ts';
import { followAlertKey } from '../src/lib/dancr/customer-notification-preferences.ts';
import { notificationIconName } from '../src/lib/dancr/notification-icon.ts';

const dancer={id:'aria',stage_name:'Aria',working_now:false,favorite:true,following:true,canRequest:true,profileHref:'/dancers/aria'};

test('VIP inbox reuses read controls and opens working alerts in the correct club workspace',()=>{
  let index=0;
  const notices=[{id:'notice',title:'Aria is working now',body:'Aria checked in at Club B.',createdAt:'2026-10-12T00:00:00Z',payload:{kind:'vip_dancer_working_now',venueId:venues[1].id}}];
  const shared=compileVip('app/dashboard/DashboardShared.tsx',{
    react:{...React,useState:initial=>[index++===0?notices:initial,()=>{}],useEffect(){},useRef:initial=>({current:initial}),useCallback:cb=>cb},
    'next/link':{__esModule:true,default:'a'},
    '@/app/components/NotificationIcon':{__esModule:true,default:'svg'},
    '@/src/lib/dancr/pickup-links':{pickupNotificationHref:()=>''},
  });
  const html=renderToStaticMarkup(shared.NotificationPanel({customerMode:true,vipMode:true}));
  assert.match(html,/Aria checked in at Club B/);assert.match(html,/Mark all read/);
  assert.match(html,/href="\/vip\?venueId=venue-2#vip-plan"/);
  assert.doesNotMatch(html,/Follow dancers and clubs/);
});

test('bells toggle independently, suppress duplicate clicks, persist on reload and retain visit drafts',async()=>{
  let saved={...dancer},resolveSave;
  const ui=dashboardHarness({hash:'#vip-plan',request:async(url,options)=>{
    if(options.method==='POST') return new Promise(resolve=>{resolveSave=()=>{saved={...saved,workingAlertsEnabled:JSON.parse(options.body).enabled};resolve({enabled:saved.workingAlertsEnabled});};});
    return state(venues[0].id,{dancers:[saved]});
  }});
  await ui.settle();ui.planner().props.onChange({selected:['aria'],date:'2027-01-02',time:'21:00'});ui.render();
  const pending=ui.planner().props.onWorkingAlert(ui.planner().props.dancers[0]);ui.render();
  await ui.planner().props.onWorkingAlert(ui.planner().props.dancers[0]);
  assert.equal(ui.calls.filter(c=>c.options.method==='POST').length,1);
  assert.deepEqual(Array.from(ui.planner().props.alertPending),['aria']);
  assert.deepEqual(JSON.parse(ui.calls.at(-1).options.body),{venueId:venues[0].id,dancerId:'aria',enabled:true});
  resolveSave();await pending;await ui.settle();
  assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,true);
  assert.equal(ui.planner().props.dancers[0].favorite,true);assert.equal(ui.planner().props.dancers[0].following,true);
  assert.deepEqual(Array.from(ui.planner().props.draft.selected),['aria']);
  ui.navigate('overview');await ui.settle();
  assert.ok(ui.nodes().some(n=>n.type==='vip-notifications'&&n.props.vipMode));
  ui.navigate('plan');await ui.settle();assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,true);
  const off=ui.planner().props.onWorkingAlert(ui.planner().props.dancers[0]);resolveSave();await off;await ui.settle();
  assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,false);ui.unmount();
});

test('bell failures retain previous preferences and can be retried',async()=>{
  let fail=true;
  const ui=dashboardHarness({hash:'#vip-plan',request:async(url,options)=>{
    if(options.method==='POST'){if(fail)throw new Error('Could not save alerts');return{enabled:true};}
    return state(venues[0].id,{dancers:[dancer]});
  }});
  await ui.settle();await ui.planner().props.onWorkingAlert(dancer);await ui.settle();
  assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,undefined);
  assert.equal(ui.planner().props.alertPending.length,0);assert.match(renderToStaticMarkup(ui.tree()),/Could not save alerts/);
  fail=false;await ui.planner().props.onWorkingAlert(dancer);await ui.settle();
  assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,true);ui.unmount();
});

test('late bell responses cannot change another club or account, and unmount aborts writes',async()=>{
  for(const change of ['venue','account','unmount']){
    let resolveSave;
    const ui=dashboardHarness({hash:'#vip-plan',request:async(url,options)=>options.method==='POST'
      ?new Promise(resolve=>{resolveSave=resolve;})
      :state(new URL(url,'https://example.test').searchParams.get('venueId')||venues[0].id,{dancers:[dancer]})});
    await ui.settle();const pending=ui.planner().props.onWorkingAlert(dancer);const write=ui.calls.at(-1);
    if(change==='venue'){ui.nodes().find(n=>n.type==='select').props.onChange({target:{value:venues[1].id}});await ui.settle();}
    else if(change==='account')ui.session({id:'other'});
    else ui.unmount();
    resolveSave({enabled:true});await pending;
    if(change!=='unmount'){await ui.settle();assert.equal(ui.planner().props.dancers[0].workingAlertsEnabled,undefined);ui.unmount();}
    if(change==='unmount')assert.equal(write.options.signal.aborted,true);
  }
});

test('card bells expose their state and remain mutable for unavailable subscribed dancers',()=>{
  const changes=[];
  const roster=[dancer,{...dancer,id:'past',canRequest:false,profileHref:null,favorite:false,workingAlertsEnabled:true}];
  const ui=plannerHarness({dancers:roster,onWorkingAlert:async d=>changes.push(d.id)});
  const bell=()=>ui.nodes().find(n=>n.props?.className==='vip-dancer-alert');
  assert.equal(bell().props['aria-pressed'],false);assert.match(bell().props['aria-label'],/Notify me: Aria working at/);
  bell().props.onClick();assert.deepEqual(changes,['aria']);
  ui.filter('Notify me');assert.equal(ui.nodes().filter(n=>n.type==='article').length,1);
  assert.equal(bell().props.disabled,false);assert.equal(bell().props['aria-pressed'],true);
  ui.props.alertPending=['past'];ui.render();assert.equal(bell().props.disabled,true);
  ui.props.alertPending=[];ui.props.dancers=roster.map(d=>({...d,workingAlertsEnabled:false}));ui.filter('This club');
  assert.equal(filterVipDancers(ui.props.dancers,'','alerts',[]).length,0);
  assert.equal(isVipFavorite({...dancer,favorite:false,following:true}),false);
  assert.equal(followAlertKey('vip_dancer_working_now'),'workingNow');
  assert.equal(notificationIconName({payload:{kind:'vip_dancer_working_now'}}),'clock');
});

test('working preference endpoint validates input, uses the authenticated actor, and keeps responses private',async()=>{
  const calls=[];let rpcError;
  class PublicApiError extends Error{constructor(code,message,status){super(message);this.status=status;}}
  class PublicRequestRateLimitError extends Error{}
  const uuid='96000000-0000-4000-8000-000000000001';
  const vip=compileVip('src/lib/dancr/vip.ts',{'../api-error-policy':{PublicApiError}});
  const route=compileVip('app/api/vip/working-alerts/route.ts',{
    'next/server':{NextResponse:Response},
    '@/src/lib/api':{PublicApiError,apiError:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_request,options)=>{assert.equal(options.role,'customer');return{user:{id:'authenticated-vip'},session:{accessToken:'rotated'}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:args.p_enabled,error:rpcError};}})},
    '@/src/lib/dancr/vip':vip,
    '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError,enforcePublicRequestRateLimit:async(_client,input)=>assert.equal(input.subject,'authenticated-vip')},
  });
  const post=body=>route.POST(new Request('https://example.test/api/vip/working-alerts',{method:'POST',body:JSON.stringify(body)}));
  for(const body of [{venueId:uuid,dancerId:uuid,enabled:'true'},{venueId:'bad',dancerId:uuid,enabled:true}])assert.equal((await post(body)).status,400);
  assert.equal(calls.length,0);
  const response=await post({venueId:uuid,dancerId:uuid,enabled:false,userId:'attacker'});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.equal((await response.json()).enabled,false);assert.equal(calls[0].args.p_actor,'authenticated-vip');
  rpcError={code:'42501'};assert.equal((await post({venueId:uuid,dancerId:uuid,enabled:true})).status,403);
  rpcError={code:'40001'};assert.equal((await post({venueId:uuid,dancerId:uuid,enabled:true})).status,409);
});

test('verified working broadcasts reach private-club VIPs, suppress duplicate follower alerts, and tolerate optional delivery failure',async()=>{
  for(const listed of [false,true]){
    const delivered=[],inserted=[];
    const notices=[{id:'vip-notice',recipient_id:'both',payload:{kind:'vip_dancer_working_now'}}];
    const broadcast=compileVip('src/lib/dancr/customer-follow-notifications.ts',{
      './notification-delivery':{deliverNotificationRows:async(_client,rows)=>{delivered.push(...rows);if(rows[0]?.id==='vip-notice')throw new Error('push unavailable');}},
      './customer-notification-preferences':{customerFollowAlertEnabled:()=>true},
    },{console:{warn(){}}});
    const client={rpc:async(name,args)=>{assert.equal(name,'vip_emit_working_alerts');assert.equal(args.p_shift,'shift-1');return{data:{notifications:notices,recipientIds:['both']}};},from(table){
      const rows={dancer_profiles:{id:'aria'},venues:listed?{id:'club'}:null,follows:[{customer_id:'both'},{customer_id:'follower'}],app_users:[{id:'both'},{id:'follower'}],customer_profiles:[]};
      let data=rows[table];
      const q={select(){return q;},eq(){return q;},is(){return q;},in(){return q;},maybeSingle(){return q;},
        upsert(values){inserted.push(...values);data=values;return q;},then(resolve){return Promise.resolve({data}).then(resolve);}};return q;
    }};
    const count=await broadcast.broadcastFollowedDancerWorkingNow(client,{eventId:'shift-1',dancerId:'aria',venueId:'club',venueName:'Club',stageName:'Aria'});
    assert.equal(count,listed?2:1);assert.deepEqual(inserted.map(n=>n.recipient_id),listed?['follower']:[]);
    assert.equal(delivered.filter(n=>n.recipient_id==='both').length,1);
  }
});
