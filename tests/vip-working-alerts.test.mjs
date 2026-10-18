import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { compileVip, dashboardHarness, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';
import { filterVipDancers, isVipFollowing } from '../src/lib/dancr/vip-dashboard.ts';
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

test('returning from a profile immediately refreshes Follow and Unfollow without changing visit drafts',async()=>{
  let saved={...dancer,following:false};
  const ui=dashboardHarness({hash:'#vip-plan',request:async()=>state(venues[0].id,{dancers:[saved]})});
  await ui.settle();ui.planner().props.onChange({selected:['aria'],date:'2027-01-02',time:'21:00'});ui.render();
  saved={...saved,following:true};ui.advance(1000);ui.event('focus');await ui.settle();
  assert.equal(ui.planner().props.dancers[0].following,true);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.planner().props.draft)),{selected:['aria'],date:'2027-01-02',time:'21:00'});
  saved={...saved,following:false};ui.advance(1000);ui.event('visibilitychange');await ui.settle();
  assert.equal(ui.planner().props.dancers[0].following,false);
  assert.ok(!ui.calls.some(c=>c.options.method==='POST'));
  assert.equal(ui.planner().props.onWorkingAlert,undefined);
  ui.navigate('overview');await ui.settle();
  assert.ok(ui.nodes().some(n=>n.type==='vip-notifications'&&n.props.vipMode));ui.unmount();
});

test('failed Following refresh retains the saved list and can be retried',async()=>{
  let fail=false;
  const ui=dashboardHarness({hash:'#vip-plan',request:async()=>{
    if(fail)throw new Error('Could not load following');
    return state(venues[0].id,{dancers:[dancer]});
  }});
  await ui.settle();fail=true;ui.event('focus');await ui.settle();
  assert.equal(ui.planner().props.dancers[0].following,true);
  assert.match(renderToStaticMarkup(ui.tree()),/Could not load following/);
  fail=false;ui.event('focus');await ui.settle();
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()),/Could not load following/);ui.unmount();
});

test('late Following refreshes cannot change another club or account, and unmount aborts reads',async()=>{
  for(const change of ['venue','account','unmount']){
    let resolveRead,pending=false;
    const ui=dashboardHarness({hash:'#vip-plan',request:async url=>pending
      ?new Promise(resolve=>{resolveRead=resolve;pending=false;})
      :state(new URL(url,'https://example.test').searchParams.get('venueId')||venues[0].id,{dancers:[dancer]})});
    await ui.settle();pending=true;ui.event('focus');const read=ui.calls.at(-1);
    if(change==='venue'){ui.nodes().find(n=>n.type==='select').props.onChange({target:{value:venues[1].id}});await ui.settle();}
    else if(change==='account')ui.session({id:'other'});
    else ui.unmount();
    resolveRead(state(venues[0].id,{dancers:[{...dancer,following:false}]}));await ui.settle();
    if(change!=='unmount'){assert.equal(ui.planner().props.dancers[0].following,true);ui.unmount();}
    if(change==='unmount')assert.equal(read.options.signal.aborted,true);
  }
});

test('Following shows followed dancers on or off shift, with no Favorites filter or photo bells',()=>{
  const roster=[dancer,{...dancer,id:'past',stage_name:'Past',canRequest:false,profileHref:null,favorite:false},
    {...dancer,id:'favorite',stage_name:'Favorite only',following:false,working_now:true}];
  const ui=plannerHarness({dancers:roster});
  const cards=()=>ui.nodes().filter(n=>n.type==='article');
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()),/vip-dancer-alert|data-notification-icon="bell"|Notify me|Working alerts for/);
  assert.ok(ui.nodes().some(n=>n.props?.className==='vip-dancer-follow'));
  assert.ok(ui.nodes().some(n=>n.props?.className==='vip-dancer-select'));
  ui.filter('Following');assert.equal(cards().length,2);
  const profile=ui.nodes().find(n=>n.type==='a'&&n.props.className==='vip-profile-link');
  assert.equal(profile.props.target,'_blank');assert.match(profile.props.href,/\/dancers\/aria\?return_to=/);
  assert.match(renderToStaticMarkup(ui.tree()),/Affiliated · off shift|Unavailable at this club/);
  ui.search('past');assert.equal(cards().length,1);ui.search('missing');assert.equal(cards().length,0);ui.search('');
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()), /Favorites/);
  assert.deepEqual(filterVipDancers(roster,'','following',[]).map(d=>d.id),['aria','past']);
  ui.props.dancers=roster.map(d=>({...d,following:false}));ui.filter('Following');
  assert.equal(cards().length,0);assert.match(renderToStaticMarkup(ui.tree()),/No dancers followed yet/);
  assert.equal(isVipFollowing({...dancer,favorite:false,following:true}),true);
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
