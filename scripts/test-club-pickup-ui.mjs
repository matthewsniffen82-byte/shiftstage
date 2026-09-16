import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';

// Runs actual React components against synthetic HTTP fixtures. Never signs into
// production, submits a real pickup, or sends venue/customer notifications.
const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'C:/Users/aix23/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium,webkit,devices} = require(playwrightPath);
const root = resolve(import.meta.dirname,'..'), modules = {}, seen = new Map();
function addSource(key,code,base) {
  const index=Object.keys(modules).length; seen.set(key,index); modules[index]={code:'',deps:{}};
  const deps={};
  for(const [,name] of code.matchAll(/require\(["']([^"']+)["']\)/g)) deps[name]=load(name,base);
  modules[index]={code,deps}; return index;
}
function load(name,base) {
  if(name.endsWith('.css')) return mock(name,'module.exports={}');
  if(name==='next/link') return mock(name,"module.exports=({children,href,prefetch:_prefetch,...props})=>require('react').createElement('a',{...props,href},children)");
  if(name==='next/navigation') return mock(name,"exports.useRouter=()=>({replace:url=>window.__destination=url})");
  if(name.endsWith('/dashboard-session')) return mock('dashboard-session',`exports.requestDashboardJson=async(path,options={})=>{
    const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});return data;};`);
  if(name.endsWith('/pickup-realtime')) return mock('pickup-realtime',"exports.subscribePickup=async(id,token,onChange,onState)=>{window.__realtimeRefresh=onChange;window.__subscriptions=(window.__subscriptions||0)+1;onState(true);return{setToken:async()=>{},close:async()=>{window.__subscriptions--;window.__realtimeRefresh=null}}}");
  let file;
  if(name.startsWith('@/')) file=resolve(root,name.slice(2));
  else if(name.startsWith('.')) file=resolve(base,name);
  else file=require.resolve(name,{paths:[base,root]});
  if(!/\.(?:js|mjs|ts|tsx)$/.test(file)) {
    const candidate=['.ts','.tsx','.js'].map(ext=>file+ext).find(path=>{try{readFileSync(path);return true;}catch{return false;}});
    file=candidate || require.resolve(file);
  }
  if(seen.has(file)) return seen.get(file);
  let code=readFileSync(file,'utf8');
  if(/\.tsx?$/.test(file)) code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  return addSource(file,code,dirname(file));
}
function mock(name,code) {return seen.get('mock:'+name) ?? addSource('mock:'+name,code,root);}
const entry=addSource('entry',`
const React=require('react'),{createRoot}=require('react-dom/client');
const Form=require('./app/pickups/PickupRequestForm.tsx').default;
const Chat=require('./app/pickups/PickupConversation.tsx').default;
const Inbox=require('./app/pickups/PickupInbox.tsx').default;
const Dashboard=require('./app/dashboard/PickupDashboardPanel.tsx').default;
const {DashboardStyles}=require('./app/dashboard/DashboardStyles.tsx');
const Transportation=require('./app/deals/transportation/[dealId]/TransportationClient.tsx').default;
const mode=new URLSearchParams(location.search).get('mode');
const venue={id:'96000000-0000-4000-8000-000000000010',name:'Test Club',slug:'test-club',club_pickup_enabled:true};
const component=['ride','entry','ride-only','phone'].includes(mode)?React.createElement(Transportation,{venue,deal:mode==='ride-only'?undefined:{id:'96000000-0000-4000-8000-000000000040',venueId:venue.id},shuttleAvailable:true,pickupAvailable:mode!=='phone',initialTransportation:mode==='entry'?'':'club_shuttle',sourceType:'dancer_profile',dancerId:'96000000-0000-4000-8000-000000000006',attributionToken:'synthetic-attribution'}):mode==='request'?React.createElement(Form,{venue}):mode==='dashboard'?React.createElement(Dashboard):mode==='inbox'?React.createElement(Inbox):React.createElement(Chat,{requestId:new URLSearchParams(location.search).get('requestId')||'96000000-0000-4000-8000-000000000020'});
const appRoot=createRoot(document.getElementById('app'));
window.__renderPickupDashboard=refreshKey=>appRoot.render(React.createElement('section',{className:'dashboard-shell dashboard-shell-venue'},React.createElement(DashboardStyles),React.createElement('section',{className:'info-panel'},React.createElement(Dashboard,{refreshKey}))));
window.__unmountPickupDashboard=()=>appRoot.unmount();
if(mode==='dashboard')window.__renderPickupDashboard();else appRoot.render(component);`,root);
const bundle=`var process={env:{NODE_ENV:'development'}};var modules={${Object.entries(modules).map(([id,m])=>`${JSON.stringify(id)}:[function(require,module,exports){${m.code}\n},${JSON.stringify(m.deps)}]`).join(',')}};var cache={};function run(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id][0](name=>run(modules[id][1][name]),m,m.exports);return m.exports;}run(${entry});`;
const css=['public/dancr-brand-tokens.v1.css','public/dancr-button-system.v1.css','public/dancr-aesthetic.v1.css','app/pickups/pickup.css','app/deals/transportation/[dealId]/transportation.css'].map(file=>readFileSync(resolve(root,file),'utf8')).join('\n');
const pushAssets=['/mydancr-push-invitations.js','/mydancr-push-device.js','/mydancr-push-invitations.css'];
const server=createServer((req,res)=>{
  if(pushAssets.includes(req.url)){res.setHeader('content-type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(resolve(root,'public'+req.url)));return;}
  res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');
  res.end(req.url==='/bundle.js'?bundle:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body class="dancr-button-system"><main class="pickup-page"><div id="app"></div></main><script src="/bundle.js"></script>${process.argv.includes('--push-only')?'<link rel="stylesheet" href="/mydancr-push-invitations.css"><script defer src="/mydancr-push-invitations.js" data-device-module="/mydancr-push-device.js"></script>':''}</body>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`, id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
mkdirSync(resolve(root,'.next-club-pickup'),{recursive:true});
try {
  for(const [name,engine,device] of [['android',chromium,'Pixel 5'],['iphone',webkit,'iPhone 13']]) {
    const browser=await engine.launch({headless:true,...(name==='android'?{channel:'msedge'}:{})});
    try {
      const context=await browser.newContext({...devices[device]});
      await context.addInitScript(()=>{if(!sessionStorage.getItem('syntheticGuest')&&!localStorage.getItem('dancrAuthSessionV1'))localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-token',account:{id:'96000000-0000-4000-8000-000000000001',role:'customer'}}));});
      const page=await context.newPage(), errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error('Synthetic UI runtime error:',e.message);});
      if(process.argv.includes('--push-only')) {
        let role='customer';const writes=[];
        await page.addInitScript(()=>{
          window.__permissionRequests=0;window.__pushOptIn=false;
          Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default',requestPermission:async()=>{window.__permissionRequests++;Notification.permission='granted';return 'granted';}}});
          Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>({scope:location.origin+'/push/onesignal/',pushManager:{getSubscription:async()=>window.__pushOptIn?{unsubscribe:async()=>{window.__pushOptIn=false;}}:null}})}});
          window.PushManager ||= function(){};
        });
        await page.route('**/api/notifications',route=>route.fulfill({json:{ok:true,pushUserId:id(1),notificationDelivery:{pushAvailable:true,pushAppId:'synthetic-app',pushExternalId:'synthetic-private-alias'}}}));
        await page.route('**/api/customer/profile',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,profile:{notificationSettings:{pushEnabled:true}}}});});
        await page.route('https://cdn.onesignal.com/**',route=>route.fulfill({contentType:'text/javascript',body:`
          const subscription={optedIn:false,id:'',optIn:async()=>{subscription.optedIn=true;subscription.id='synthetic-subscription';window.__pushOptIn=true;},optOut:async()=>{window.__pushOptIn=false;},addEventListener(){},removeEventListener(){}};
          const sdk={init:async()=>{},login:async()=>{},logout:async()=>{},Notifications:{isPushSupported:()=>true},User:{PushSubscription:subscription}};
          window.OneSignalDeferred.forEach(callback=>callback(sdk));`}));
        await page.route('**/api/pickups**',route=>{
          const path=new URL(route.request().url()).pathname;
          return route.fulfill({json:{ok:true,role,consented:true,request:{id:id(20),status:'requested',party_size:2,requested_at:new Date().toISOString(),expires_at:'2099-09-15T00:00:00Z',venue:{name:'Test Club'}},requests:[],phoneRequests:[],venues:[],messages:[],events:[],reports:[],evidence:[],...(path.endsWith('/settings')?{venues:[]}: {})}});
        });
        for(const nextRole of ['customer','venue']) {
          role=nextRole;
          await page.goto(base+'/?mode=dashboard');
          await page.getByText('No active pickup requests.',{exact:true}).waitFor();
          await page.evaluate(role=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic',account:{id:'96000000-0000-4000-8000-000000000001',role}})),role);
          await page.goto(base+'/?mode=chat');
          const control=page.getByRole('complementary',{name:'Pickup notifications'});
          await control.getByRole('button',{name:'Enable pickup notifications',exact:true}).waitFor();
          // Dismissing the automatic invitation must not hide the manual control.
          const invitation=page.locator('.mydancr-push-invitation');
          await invitation.waitFor();
          await invitation.getByRole('button',{name:'Not now',exact:true}).click();
          await control.getByRole('button',{name:'Enable pickup notifications',exact:true}).click();
          await invitation.waitFor();
          if(name==='iphone') {
            await invitation.getByText(/Add MyDancr to your Home Screen/).waitFor();
            assert.equal(await invitation.getByRole('button',{name:'Enable notifications',exact:true}).isDisabled(),true);
            await invitation.getByRole('button',{name:'Close',exact:true}).click();
            await page.evaluate(()=>{const original=window.matchMedia;window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true}:original(query);});
            await control.getByRole('button',{name:'Enable pickup notifications',exact:true}).click();
          }
          assert.equal(await page.evaluate(()=>window.__permissionRequests),0);
          await invitation.getByRole('button',{name:'Enable notifications',exact:true}).click();
          await invitation.getByText('Notifications are enabled on this device.',{exact:true}).waitFor();
          await control.getByRole('button',{name:'Manage pickup notifications',exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>window.__permissionRequests),1);
          await invitation.getByRole('button',{name:'Done',exact:true}).click();
          await control.getByRole('button',{name:'Manage pickup notifications',exact:true}).click();
          await invitation.getByRole('button',{name:'Disable on this device',exact:true}).click();
          await control.getByRole('button',{name:'Enable pickup notifications',exact:true}).waitFor();
          await invitation.getByRole('button',{name:'Done',exact:true}).click();
          await page.goto(base+'/?mode=inbox');await page.getByRole('button',{name:'Enable pickup notifications',exact:true}).waitFor();
          await page.getByText('No pickup requests in this group.',{exact:true}).waitFor();
          if(role==='venue'){await page.goto(base+'/?mode=dashboard');await page.getByRole('button',{name:'Enable pickup notifications',exact:true}).waitFor();await page.getByText('No active pickup requests.',{exact:true}).waitFor();}
        }
        assert.equal(writes.length,1,'only customer opt-in changes customer preferences');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({browser:name,pickupPushControls:true,customerAndVenue:true,inbox:true,dashboard:true,dismissedInvitationRetry:true,explicitPermission:true,enabledState:true,disableDevice:true,iphoneHomeScreenGuidance:name==='iphone',runtimeErrors:errors}));
        continue;
      }
      if(process.argv.includes('--dashboard-only')) {
        let reads=0, unread=2, failed=false, releaseRead=null;
        const phones=[{id:id(300),venue_id:id(10),venue_name:'Test Club',name:'Earlier Phone Guest',location:'Synthetic lobby',party_size:2,requested_at:'2026-09-15T07:46:33Z'}];
        await page.route('**/api/pickups?group=active',async route=>{
          reads++;
          if(releaseRead)await new Promise(done=>{releaseRead=done;});
          await route.fulfill({status:failed?503:200,json:failed?{ok:false,error:'Synthetic unavailable'}:{ok:true,requests:[{
            id:id(20),customer_user_id:null,venue_id:id(10),status:'requested',party_size:5,pickup_location_text:'Synthetic guest hotel',
            requested_at:'2026-09-15T18:20:49Z',venue:{name:'Test Club',slug:'test-club'},unread_count:unread,
          }],phoneRequests:phones}});
        });
        await page.goto(base+'/?mode=dashboard');
        const chat=page.getByRole('link',{name:/Open chat & reply/});
        await chat.getByText('2 unread',{exact:true}).waitFor();
        assert.equal(await chat.getAttribute('href'),'/pickups/'+id(20));
        assert.match(await chat.textContent(),/Guest 000020 · 5 guests/);
        assert.equal(await page.locator('.notification-row').first().getAttribute('href'),'/pickups/'+id(20));
        assert.equal(await page.getByRole('heading',{name:'Recent phone pickup requests'}).isVisible(),true);
        for(const width of [320,393,1280]) {
          await page.setViewportSize({width,height:850});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} pickup dashboard ${width} overflow`);
        }
        // Focus/online/visibility events must resume promptly without overlapping reads.
        const before=reads;unread=3;releaseRead=()=>{};
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        for(let attempt=0;reads===before&&attempt<500;attempt++)await new Promise(done=>setTimeout(done,10));
        await page.evaluate(()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal(reads,before+1);const finish=releaseRead;releaseRead=null;finish();
        await chat.getByText('3 unread',{exact:true}).waitFor();
        const visibleReads=reads;
        await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal(reads,visibleReads);
        unread=4;
        await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
        await chat.getByText('4 unread',{exact:true}).waitFor();
        failed=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByRole('alert').waitFor();
        assert.equal(await chat.count(),0,'failed access must not leave private pickup rows visible');
        failed=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await chat.waitFor();
        unread=5;await page.evaluate(()=>window.__renderPickupDashboard('manual-refresh'));await chat.getByText('5 unread',{exact:true}).waitFor();
        await page.evaluate(()=>window.__unmountPickupDashboard());const unmountedReads=reads;
        await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal(reads,unmountedReads,'refresh listeners removed on unmount');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({browser:name,guestPickupDashboard:true,chatsBeforePhoneRequests:true,unreadCounts:true,focusRefresh:true,visibilityRefresh:true,reconnectRefresh:true,deduplicatedReads:true,errorRecovery:true,manualRefresh:true,cleanup:true,runtimeErrors:errors}));
        continue;
      }
      let artwork='logo';
      await page.route('**/api/public/venues/test-club',route=>{
        assert.equal(route.request().headers()['x-pickup-guest-key'],undefined);
        assert.equal(route.request().headers().authorization,undefined);
        return route.fulfill({json:{ok:true,venue:{id:id(10),logoImageUrl:artwork==='logo'?'/synthetic-venue.svg':null,coverImageUrl:artwork==='cover'?'/synthetic-venue.svg':null}}});
      });
      await page.route('**/synthetic-venue.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#111118"/><text x="32" y="39" text-anchor="middle" font-size="22" fill="#f5f3ff">TC</text></svg>'}));
      let role='customer',consented=true,status='requested',failNextSend=true,failNextRequest=false;const actions=[],messages=[{id:id(30),sequence:1,sender_type:'system',message_text:'Pickup requested from the venue.',created_at:'2026-09-14T19:00:00Z'}];
      let showChats=true;const phoneRequests=[];
      let failNextGuest=false;const guestSubmissions=[];
      const guestKeys=new Map(), guestActions=[];
      await page.route('**/api/**/shuttle',async route=>{
        const req=route.request(), body=req.postDataJSON();guestSubmissions.push({url:req.url(),body});
        assert.equal(req.headers().authorization,undefined,'guest requests do not require an auth token');
        if(failNextGuest){failNextGuest=false;await route.fulfill({status:503,json:{ok:false,error:'Synthetic temporary failure'}});return;}
        if(!phoneRequests.some(request=>request.id===body.requestId))phoneRequests.unshift({id:body.requestId,venue_id:id(10),venue_name:'Test Club',
          name:body.name,location:body.location,phone:body.phone,email:body.email,party_size:body.partySize,requested_at:'2026-09-15T07:46:33Z'});
        await route.fulfill({json:{ok:true,requestId:body.requestId,message:'The club will contact you to confirm your pickup.'}});
      });
      const request=()=>({id:id(20),customer_user_id:id(1),venue_id:id(10),status,party_size:2,pickup_location_text:'Synthetic hotel lobby',pickup_location_details:'North entrance',customer_notes:'Blue jacket',requested_at:'2026-09-14T19:00:00Z',expires_at:'2099-09-14T19:00:00Z',referral_source:'mydancr',referral_outcome:'pending',venue:{name:'Test Club',slug:'test-club'}});
      await page.route('**/api/pickups**',async route=>{
        const req=route.request(), url=new URL(req.url());
        const guestKey=req.headers()['x-pickup-guest-key'];
        const conversationId=url.pathname.split('/').at(-1);
        if(guestKey && url.pathname!=='/api/pickups' && guestKeys.get(conversationId)!==guestKey) {
          await route.fulfill({status:403,json:{ok:false,error:'Private pickup link required.'}});return;
        }
        if(req.method()==='POST') {
          const body=req.postDataJSON();(guestKey?guestActions:actions).push({...body,...(guestKey?{guestKey}: {})});
          if(guestKey) {
            assert.match(guestKey,/^[a-f0-9]{64}$/);assert.equal(req.headers().authorization,undefined);
            if(url.pathname==='/api/pickups')guestKeys.set(body.requestId,guestKey);
          }
          if(!body.action && url.pathname==='/api/pickups' && failNextRequest){failNextRequest=false;await route.fulfill({status:503,json:{ok:false,error:'Synthetic request failure'}});return;}
          if(body.action==='message') {
            if(failNextSend){failNextSend=false;await route.fulfill({status:503,json:{ok:false,error:'Synthetic temporary failure'}});return;}
            if(!messages.some(m=>m.id===body.messageId))messages.push({id:body.messageId,sequence:messages.length+1,sender_type:role,message_text:body.text,created_at:'2026-09-14T19:01:00Z'});
          }
          if(body.action==='status')status=body.status;
          if(body.action==='consent')consented=true;
          await route.fulfill({json:{ok:true,id:guestKey?body.requestId||conversationId:id(20),guest:Boolean(guestKey)}});return;
        }
        if(url.pathname==='/api/pickups/settings'){await route.fulfill({json:{ok:true,venues:[{id:id(10),name:'Test Club',slug:'test-club',club_pickup_enabled:true,eligible:true}]}});return;}
        if(url.pathname==='/api/pickups'){
          const phoneOffset=Number(url.searchParams.get('phoneOffset')||0);
          const phones=role==='venue'&&(url.searchParams.get('group')||'active')==='active'?phoneRequests:[];
          await route.fulfill({json:{ok:true,role,requests:showChats?[{...request(),unread_count:1}]:[],hasMore:false,
            phoneRequests:phones.slice(phoneOffset,phoneOffset+1),hasMorePhoneRequests:phones.length>phoneOffset+1}});return;
        }
        const history=messages.filter(m=>!url.searchParams.has('before')||m.sequence<Number(url.searchParams.get('before')));
        await route.fulfill({json:{ok:true,request:{...request(),...(guestKey?{id:conversationId,customer_user_id:null,requested_at:new Date().toISOString()}: {})},guest:Boolean(guestKey),role,consented,messages:consented?history.slice(-50):[],hasOlderMessages:history.length>50,events:[],hasMoreEvents:false,reports:[],evidence:[]}});
      });
      await page.goto(base+'/?mode=request');
      await page.getByRole('heading',{name:'Request Club Pickup'}).waitFor();
      await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic hotel lobby');
      await page.getByLabel('Party size',{exact:true}).fill('2');
      assert.equal(await page.locator('input[name=locationDetails]').isVisible(),false);
      assert.equal(await page.locator('.pickup-request-terms').getAttribute('open'),null);
      await page.getByRole('button',{name:'Request pickup',exact:true}).click();
      assert.equal(actions.length,0,'consent is required even while the full terms are collapsed');
      await page.getByText('Add pickup details',{exact:false}).click();
      await page.getByLabel('Meeting spot (optional)',{exact:true}).fill('North entrance');
      await page.getByLabel('Note to the club (optional)',{exact:true}).fill('Blue jacket');
      await page.getByText('Add pickup details',{exact:false}).click();
      await page.locator('.pickup-request-terms summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.getByText('Messages in this pickup conversation',{exact:false}).isVisible(),true);
      assert.equal(await page.getByText('Transportation, if available',{exact:false}).isVisible(),true);
      await page.keyboard.press('Enter');
      await page.getByLabel('I agree to the pickup & chat terms.').check();
      await page.getByRole('button',{name:'Request pickup'}).click();
      await page.waitForFunction(()=>Boolean(window.__destination));
      assert.equal(actions[0].consentVersion,'pickup-chat-v1');assert.equal(actions[0].location,'Synthetic hotel lobby');assert.equal(actions[0].partySize,2);
      assert.equal(actions[0].locationDetails,'North entrance');assert.equal(actions[0].notes,'Blue jacket');
      for(const mode of ['ride','entry','ride-only']) {
        await page.goto(base+'/?mode='+mode);
        await page.evaluate(()=>localStorage.removeItem('mydancrPendingNfcDealV2'));
        if(mode==='entry')await page.getByLabel('Free club transport').click();
        await page.getByRole('button',{name:'Request pickup',exact:true}).waitFor();
        assert.equal(await page.locator('input[name=phone]').count(),0);
        for(const width of [320,393,1280]) {
          await page.setViewportSize({width,height:850});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} ${mode} ${width} overflow`);
        }
        await page.setViewportSize({width:393,height:850});
        if(mode==='ride')await page.screenshot({path:resolve(root,`.next-club-pickup/ride-${name}.png`),fullPage:true});
        await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic hotel lobby');
        await page.getByLabel('Party size',{exact:true}).fill('2');
        await page.getByLabel('I agree to the pickup & chat terms.').check();
        const start=actions.length;
        if(mode==='ride')failNextRequest=true;
        await page.getByRole('button',{name:'Request pickup',exact:true}).click();
        if(mode==='ride') {
          await page.getByRole('alert').waitFor();
          assert.equal(await page.evaluate(()=>localStorage.getItem('mydancrPendingNfcDealV2')),null);
          await page.getByRole('button',{name:'Request pickup',exact:true}).click();
          await page.waitForFunction(()=>Boolean(window.__destination));
          assert.equal(actions[start].requestId,actions[start+1].requestId);
        }
        await page.waitForFunction(()=>Boolean(window.__destination));
        assert.equal(await page.evaluate(()=>window.__destination),'/pickups/'+id(20));
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mydancrPendingNfcDealV2')));
        if(mode==='ride-only')assert.equal(saved,null);
        else {
          assert.equal(saved.dealId,id(40));assert.equal(saved.pickupRequestId,id(20));
          assert.equal(saved.transportation,'club_shuttle');assert.equal(saved.shuttleRequestId,null);
          assert.equal(saved.attributionToken,'synthetic-attribution');assert.equal(saved.dancerId,id(6));
          assert.equal(saved.expiresAt-saved.savedAt,12*60*60*1000);
        }
      }
      // A saved request remains accessible when local admission storage fails.
      await page.goto(base+'/?mode=ride');
      await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic hotel lobby');
      await page.getByLabel('I agree to the pickup & chat terms.').check();
      await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='mydancrPendingNfcDealV2')throw new Error('Synthetic storage failure');window.__originalSetItem.call(this,key,value)};});
      await page.getByRole('button',{name:'Request pickup',exact:true}).click();
      await page.getByRole('button',{name:'Save free entry and open chat',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Message Test Club',exact:true}).getAttribute('href'),'/pickups/'+id(20));
      assert.equal(await page.evaluate(()=>window.__destination),undefined);
      const sentBeforeRecovery=actions.length;
      await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;});
      await page.getByRole('button',{name:'Save free entry and open chat',exact:true}).click();
      await page.waitForFunction(()=>Boolean(window.__destination));assert.equal(actions.length,sentBeforeRecovery);
      await page.goto(base+'/?mode=phone');await page.getByRole('button',{name:'Send pickup request',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Request pickup',exact:true}).count(),0);
      // Guests can use every ride entry point even when the venue offers chat.
      await page.evaluate(()=>{sessionStorage.setItem('syntheticGuest','1');localStorage.removeItem('dancrAuthSessionV1');});
      let guestDestination;
      for(const mode of ['ride','entry','ride-only']) {
        await page.goto(base+'/?mode='+mode);
        if(mode==='entry')await page.getByLabel('Free club transport').click();
        await page.getByRole('button',{name:'Request pickup',exact:true}).waitFor();
        assert.equal(await page.getByRole('link',{name:'Customer sign in',exact:true}).count(),0);
        await page.getByText('No sign-in needed.',{exact:true}).waitFor();
        if(mode==='ride') {
          await page.setViewportSize({width:393,height:850});
          await page.screenshot({path:resolve(root,`.next-club-pickup/compact-guest-ride-${name}.png`),fullPage:true});
          console.log(JSON.stringify({browser:name,compactPickupHeight:await page.locator('.club-transport-card').evaluate(card=>Math.round(card.getBoundingClientRect().height))}));
          await page.locator('.pickup-request-terms summary').click();
          assert.equal(await page.getByText('Free entry is saved for 12 hours.',{exact:false}).isVisible(),true);
          assert.equal(await page.getByText('One free general admission per guest.',{exact:false}).isVisible(),true);
          await page.locator('.pickup-request-terms summary').click();
        }
        await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic guest hotel lobby');
        await page.getByLabel('Party size',{exact:true}).fill('2');
        await page.getByLabel('I agree to the pickup & chat terms.').check();
        const start=guestActions.length;if(mode==='ride')failNextRequest=true;
        await page.getByRole('button',{name:'Request pickup',exact:true}).click();
        if(mode==='ride') {
          await page.getByRole('alert').waitFor();
          await page.getByRole('button',{name:'Request pickup',exact:true}).click();
          assert.equal(guestActions[start].requestId,guestActions[start+1].requestId);
          assert.equal(guestActions[start].guestKey,guestActions[start+1].guestKey);
        }
        await page.waitForFunction(()=>Boolean(window.__destination));
        guestDestination=await page.evaluate(()=>window.__destination);
        assert.match(guestDestination,/^\/pickups\/[0-9a-f-]{36}#pickupKey=[a-f0-9]{64}$/);
        assert.equal(await page.evaluate(()=>localStorage.getItem('dancrAuthSessionV1')),null);
      }
      const guestUrl=new URL(guestDestination,base), guestId=guestUrl.pathname.split('/').at(-1);
      guestUrl.searchParams.set('mode','chat');guestUrl.searchParams.set('requestId',guestId);
      await page.goto(guestUrl.href);
      await page.getByLabel('Message Test Club').waitFor();
      await page.waitForFunction(()=>document.querySelector('.pickup-venue-image img')?.naturalWidth>0);
      assert.match(await page.locator('.pickup-progress [aria-current=step]').textContent(),/Requested/);
      assert.equal(await page.getByLabel('Status',{exact:true}).isVisible(),false,'customer status controls are collapsed below chat');
      assert.equal(await page.getByRole('link',{name:'View club'}).getAttribute('href'),'/?venue=test-club');
      assert.equal(await page.getByRole('button',{name:'Copy private chat link',exact:true}).count(),0);
      await page.getByLabel('Message Test Club').fill('Guest chat without an account');
      failNextSend=false;
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.getByText('Guest chat without an account',{exact:true}).waitFor();
      messages.push({id:id(900),sequence:messages.length+1,sender_type:'venue',message_text:'Guest pickup reply',created_at:new Date().toISOString()});
      await page.getByText('Guest pickup reply',{exact:true}).waitFor({timeout:10000});
      assert.equal(await page.evaluate(()=>window.__subscriptions||0),0,'guest chat polls privately without an account websocket');
      for(const width of [320,393,1280]) {
        await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} guest chat ${width} overflow`);
      }
      await page.setViewportSize({width:393,height:850});await page.screenshot({path:resolve(root,`.next-club-pickup/guest-chat-${name}.png`),fullPage:true});
      await page.reload();await page.getByText('Guest chat without an account',{exact:true}).waitFor();
      artwork='cover';await page.reload();await page.locator('.pickup-venue-image.is-cover img').waitFor();
      artwork='none';await page.reload();await page.getByLabel('Message Test Club').waitFor();
      assert.equal(await page.locator('.pickup-venue-image').textContent(),'TC','missing artwork falls back to venue initials');
      artwork='logo';
      await page.goto(base+'/?mode=inbox');await page.getByRole('heading',{name:'Pickup chats',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:/Test Club Requested .*Open chat/}).count(),3);
      for(const width of [320,393,1280]) {
        await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} saved chats ${width} overflow`);
      }
      await page.setViewportSize({width:393,height:850});await page.screenshot({path:resolve(root,`.next-club-pickup/saved-chats-${name}.png`),fullPage:true});
      // A fresh browser can open only the private fragment link, with no account or prior storage.
      await page.evaluate(()=>localStorage.removeItem('mydancrGuestPickupsV1'));
      await page.goto(guestUrl.href);await page.getByText('Guest chat without an account',{exact:true}).waitFor();
      await page.evaluate(()=>localStorage.removeItem('mydancrGuestPickupsV1'));
      guestUrl.hash='pickupKey='+'0'.repeat(64);
      await page.goto(guestUrl.href);await page.getByRole('alert').waitFor();assert.equal(await page.locator('.pickup-message').count(),0);
      messages.splice(1);failNextSend=true;
      for(const mode of ['ride','entry','ride-only']) {
        await page.goto(base+'/?mode='+mode);await page.evaluate(()=>localStorage.removeItem('mydancrPendingNfcDealV2'));
        if(mode==='entry')await page.getByLabel('Free club transport').click();
        await page.getByRole('button',{name:'Request by phone instead',exact:true}).click();
        await page.getByRole('button',{name:'Send pickup request',exact:true}).waitFor();
        assert.equal(await page.getByRole('link',{name:'Customer sign in',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Request pickup',exact:true}).count(),0);
        await page.getByLabel('Name',{exact:true}).fill('Synthetic Guest Ride');
        await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic guest hotel lobby');
        await page.getByLabel('Guests',{exact:true}).fill('2');
        await page.getByLabel('Phone',{exact:true}).fill('7025550123');
        await page.getByLabel('Email',{exact:true}).fill('guest@example.test');
        await page.locator('input[name=handoffAccepted]').check();
        for(const width of [320,393,1280]) {
          await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} guest ${mode} ${width} overflow`);
        }
        await page.setViewportSize({width:393,height:850});
        if(mode==='ride')await page.screenshot({path:resolve(root,`.next-club-pickup/guest-ride-${name}.png`),fullPage:true});
        const start=guestSubmissions.length;if(mode==='ride')failNextGuest=true;
        await page.getByRole('button',{name:'Send pickup request',exact:true}).click();
        if(mode==='ride') {
          await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mydancrPendingNfcDealV2')),null);
          await page.getByRole('button',{name:'Retry shuttle request',exact:true}).click();
        }
        await page.getByRole('heading',{name:'Pickup requested',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>localStorage.getItem('dancrAuthSessionV1')),null);
        const sent=guestSubmissions.at(-1);assert.equal(sent.body.phone,'+17025550123');assert.equal(sent.body.handoffAccepted,true);
        assert.equal(new URL(sent.url).pathname,mode==='ride-only'?`/api/venues/${id(10)}/shuttle`:`/api/deals/${id(40)}/shuttle`);
        if(mode==='ride')assert.equal(guestSubmissions[start].body.requestId,sent.body.requestId);
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mydancrPendingNfcDealV2')));
        if(mode==='ride-only')assert.equal(saved,null);
        else {assert.equal(saved.shuttleRequestId,sent.body.requestId);assert.equal(saved.attributionToken,'synthetic-attribution');assert.equal(saved.pickupRequestId,undefined);}
      }
      await page.evaluate(()=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-token',account:{id:'96000000-0000-4000-8000-000000000001',role:'customer'}})));
      await page.goto(base+'/?mode=chat');await page.getByText('Pickup requested from the venue.',{exact:true}).waitFor();
      await page.getByLabel('Message Test Club').fill('<img src=x onerror=alert(1)> Synthetic message');
      await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('alert').waitFor();
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await page.locator('.pickup-message-customer').waitFor();
      const sends=actions.filter(a=>a.action==='message');assert.equal(sends.length,2);assert.equal(sends[0].messageId,sends[1].messageId);
      assert.equal(await page.locator('.pickup-messages img').count(),0,'chat renders text, not HTML');
      messages.push({id:id(70),sequence:messages.length+1,sender_type:'venue',message_text:'We received your request.',created_at:'2026-09-14T19:02:00Z'});
      await page.evaluate(()=>window.__realtimeRefresh());await page.getByText('We received your request.',{exact:true}).waitFor();
      for(const width of [320,393,1280]) {
        await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} ${width} overflow`);
        assert.ok((await page.getByRole('button',{name:'Send message',exact:true}).boundingBox()).height>=44);
      }
      await page.setViewportSize({width:393,height:850});await page.screenshot({path:resolve(root,`.next-club-pickup/chat-${name}.png`),fullPage:true});
      for(let n=0;n<60;n++)messages.push({id:id(100+n),sequence:messages.length+1,sender_type:'venue',message_text:'Reconnect history '+n,created_at:'2026-09-14T19:03:00Z'});
      await page.evaluate(()=>window.__realtimeRefresh());await page.getByText('Reconnect history 59',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Load older messages'}).click();await page.getByText('Pickup requested from the venue.',{exact:true}).waitFor();
      assert.equal(await page.locator('.pickup-message').count(),messages.length,'long-disconnect history has no gaps');
      await page.locator('.pickup-manage summary').click();
      await page.getByLabel('Status',{exact:true}).selectOption('cancelled');await page.getByLabel('Reason',{exact:true}).fill('Plans changed');await page.getByRole('button',{name:'Confirm update'}).click();
      await page.getByText('Cancelled',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).count(),0);
      await page.getByRole('button',{name:'Report Conversation'}).click();await page.getByLabel('Details (optional)').fill('Synthetic report');await page.getByRole('button',{name:'Send report',exact:true}).click();await page.getByText('Your report was sent to MyDancr for review.').waitFor();
      role='venue';consented=false;status='requested';
      await page.evaluate(()=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-venue',account:{id:'96000000-0000-4000-8000-000000000003',role:'venue'}})));
      await page.getByRole('button',{name:'Agree & Continue',exact:true}).waitFor();assert.equal(await page.locator('.pickup-message').count(),0);
      await page.getByRole('button',{name:'Agree & Continue',exact:true}).click();await page.getByLabel('Message customer').waitFor();
      await page.getByLabel('Status',{exact:true}).selectOption('accepted');await page.getByRole('button',{name:'Confirm update'}).click();await page.getByText('Venue Accepted',{exact:true}).waitFor();
      await page.goto(base+'/?mode=inbox');await page.getByRole('heading',{name:'Pickup Requests',exact:true}).waitFor();await page.locator('.pickup-list-item').first().waitFor();
      await page.getByText('Test Club · Synthetic Guest Ride',{exact:true}).waitFor();
      phoneRequests.length=0;
      await page.getByText('Club Pickup settings',{exact:true}).click();await page.getByRole('button',{name:'Disable Club Pickup'}).click();await page.getByRole('button',{name:'Enable Club Pickup'}).waitFor();
      // Reproduce a venue with phone handoffs and no pickup chats.
      showChats=false;
      phoneRequests.push({id:id(300),venue_id:id(10),venue_name:'Test Club',name:'Synthetic Phone Guest',location:'Synthetic lobby',phone:'+17025550123',email:'guest@example.test',party_size:2,requested_at:'2026-09-15T07:46:33Z'});
      await page.getByRole('button',{name:'Refresh requests',exact:true}).click();
      await page.getByRole('heading',{name:'Phone pickup requests',exact:true}).waitFor();
      assert.equal(await page.getByText('No pickup requests in this group.',{exact:true}).count(),0);
      assert.equal(await page.getByRole('link',{name:'Call +17025550123',exact:true}).getAttribute('href'),'tel:+17025550123');
      assert.equal(await page.getByRole('link',{name:'Email guest@example.test',exact:true}).getAttribute('href'),'mailto:guest%40example.test');
      for(const width of [320,393,1280]) {
        await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} phone inbox ${width} overflow`);
      }
      await page.setViewportSize({width:393,height:850});await page.screenshot({path:resolve(root,`.next-club-pickup/phone-inbox-${name}.png`),fullPage:true});
      await page.getByRole('button',{name:'Completed',exact:true}).click();await page.getByText('No pickup requests in this group.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Call +17025550123',exact:true}).count(),0);
      await page.getByRole('button',{name:'Active',exact:true}).click();await page.getByRole('link',{name:'Call +17025550123',exact:true}).waitFor();
      await page.clock.install();
      phoneRequests.push({...phoneRequests[0],id:id(301),name:'Second Phone Guest'});
      await page.clock.fastForward(31000);await page.getByRole('button',{name:'Load more phone requests',exact:true}).waitFor();
      await page.getByRole('button',{name:'Load more phone requests',exact:true}).click();await page.getByText('Test Club · Second Phone Guest',{exact:true}).waitFor();
      assert.equal(await page.locator('article.pickup-list-item').count(),2);
      await page.evaluate(()=>localStorage.removeItem('dancrAuthSessionV1'));await page.clock.fastForward(1100);
      await page.getByText('Your chats are saved in this browser. No sign-in needed.',{exact:true}).waitFor();assert.equal(await page.locator('article.pickup-list-item').count(),0);
      await page.evaluate(()=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-venue',account:{id:'96000000-0000-4000-8000-000000000003',role:'venue'}})));
      await page.goto(base+'/?mode=dashboard');await page.getByRole('heading',{name:'Recent phone pickup requests',exact:true}).waitFor();
      assert.equal(await page.getByText('No active pickup requests.',{exact:true}).count(),0);
      await page.goto(base+'/?mode=chat');await page.locator('.pickup-messages').waitFor();
      await page.evaluate(()=>localStorage.removeItem('dancrAuthSessionV1'));await page.getByRole('link',{name:'Saved pickup chats'}).waitFor();
      assert.equal(await page.locator('.pickup-message').count(),0);await page.waitForFunction(()=>window.__subscriptions===0);
      assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:name,request:true,guestRide:true,guestRequestReachesVenueInbox:true,guestRetrySameRequestId:true,chat:true,retrySameMessageId:true,realtimeReconcile:true,consent:true,cancellation:true,report:true,venueStatus:true,settings:true,phoneInbox:true,phonePagination:true,phoneAutoRefresh:true,phoneDashboard:true,logoutClearsData:true,widths:[320,393,1280],runtimeErrors:errors}));
    }finally{await browser.close();}
  }
}finally{await new Promise(done=>server.close(done));}
