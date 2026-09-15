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
const Transportation=require('./app/deals/transportation/[dealId]/TransportationClient.tsx').default;
const mode=new URLSearchParams(location.search).get('mode');
const venue={id:'96000000-0000-4000-8000-000000000010',name:'Test Club',slug:'test-club',club_pickup_enabled:true};
const component=['ride','entry','ride-only','phone'].includes(mode)?React.createElement(Transportation,{venue,deal:mode==='ride-only'?undefined:{id:'96000000-0000-4000-8000-000000000040',venueId:venue.id},shuttleAvailable:true,pickupAvailable:mode!=='phone',initialTransportation:mode==='entry'?'':'club_shuttle',sourceType:'dancer_profile',dancerId:'96000000-0000-4000-8000-000000000006',attributionToken:'synthetic-attribution'}):mode==='request'?React.createElement(Form,{venue}):mode==='inbox'?React.createElement(Inbox):React.createElement(Chat,{requestId:'96000000-0000-4000-8000-000000000020'});
createRoot(document.getElementById('app')).render(component);`,root);
const bundle=`var process={env:{NODE_ENV:'development'}};var modules={${Object.entries(modules).map(([id,m])=>`${JSON.stringify(id)}:[function(require,module,exports){${m.code}\n},${JSON.stringify(m.deps)}]`).join(',')}};var cache={};function run(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id][0](name=>run(modules[id][1][name]),m,m.exports);return m.exports;}run(${entry});`;
const css=['public/dancr-brand-tokens.v1.css','public/dancr-button-system.v1.css','public/dancr-aesthetic.v1.css','app/pickups/pickup.css','app/deals/transportation/[dealId]/transportation.css'].map(file=>readFileSync(resolve(root,file),'utf8')).join('\n');
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body class="dancr-button-system"><main class="pickup-page"><div id="app"></div></main><script src="/bundle.js"></script></body>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`, id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
mkdirSync(resolve(root,'.next-club-pickup'),{recursive:true});
try {
  for(const [name,engine,device] of [['android',chromium,'Pixel 5'],['iphone',webkit,'iPhone 13']]) {
    const browser=await engine.launch({headless:true,...(name==='android'?{channel:'msedge'}:{})});
    try {
      const context=await browser.newContext({...devices[device]});
      await context.addInitScript(()=>{if(!localStorage.getItem('dancrAuthSessionV1'))localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-token',account:{id:'96000000-0000-4000-8000-000000000001',role:'customer'}}));});
      const page=await context.newPage(), errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error('Synthetic UI runtime error:',e.message);});
      let role='customer',consented=true,status='requested',failNextSend=true,failNextRequest=false;const actions=[],messages=[{id:id(30),sequence:1,sender_type:'system',message_text:'Pickup requested from the venue.',created_at:'2026-09-14T19:00:00Z'}];
      const request=()=>({id:id(20),customer_user_id:id(1),venue_id:id(10),status,party_size:2,pickup_location_text:'Synthetic hotel lobby',pickup_location_details:'North entrance',customer_notes:'Blue jacket',requested_at:'2026-09-14T19:00:00Z',expires_at:'2099-09-14T19:00:00Z',referral_source:'mydancr',referral_outcome:'pending',venue:{name:'Test Club',slug:'test-club'}});
      await page.route('**/api/pickups**',async route=>{
        const req=route.request(), url=new URL(req.url());
        if(req.method()==='POST') {
          const body=req.postDataJSON();actions.push(body);
          if(!body.action && url.pathname==='/api/pickups' && failNextRequest){failNextRequest=false;await route.fulfill({status:503,json:{ok:false,error:'Synthetic request failure'}});return;}
          if(body.action==='message') {
            if(failNextSend){failNextSend=false;await route.fulfill({status:503,json:{ok:false,error:'Synthetic temporary failure'}});return;}
            if(!messages.some(m=>m.id===body.messageId))messages.push({id:body.messageId,sequence:messages.length+1,sender_type:role,message_text:body.text,created_at:'2026-09-14T19:01:00Z'});
          }
          if(body.action==='status')status=body.status;
          if(body.action==='consent')consented=true;
          await route.fulfill({json:{ok:true,id:id(20)}});return;
        }
        if(url.pathname==='/api/pickups/settings'){await route.fulfill({json:{ok:true,venues:[{id:id(10),name:'Test Club',slug:'test-club',club_pickup_enabled:true,eligible:true}]}});return;}
        if(url.pathname==='/api/pickups'){await route.fulfill({json:{ok:true,role,requests:[{...request(),unread_count:1}],hasMore:false}});return;}
        const history=messages.filter(m=>!url.searchParams.has('before')||m.sequence<Number(url.searchParams.get('before')));
        await route.fulfill({json:{ok:true,request:request(),role,consented,messages:consented?history.slice(-50):[],hasOlderMessages:history.length>50,events:[],hasMoreEvents:false,reports:[],evidence:[]}});
      });
      await page.goto(base+'/?mode=request');
      await page.getByRole('heading',{name:'Request Club Pickup'}).waitFor();
      await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic hotel lobby');
      await page.getByLabel('Party size',{exact:true}).fill('2');
      await page.getByLabel('Agree & Continue').check();
      await page.getByRole('button',{name:'Request Pickup From Venue'}).click();
      await page.waitForFunction(()=>Boolean(window.__destination));
      assert.equal(actions[0].consentVersion,'pickup-chat-v1');assert.equal(actions[0].location,'Synthetic hotel lobby');assert.equal(actions[0].partySize,2);
      for(const mode of ['ride','entry','ride-only']) {
        await page.goto(base+'/?mode='+mode);
        await page.evaluate(()=>localStorage.removeItem('mydancrPendingNfcDealV2'));
        if(mode==='entry')await page.getByLabel('Free club transport').click();
        await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).waitFor();
        assert.equal(await page.locator('input[name=phone]').count(),0);
        for(const width of [320,393,1280]) {
          await page.setViewportSize({width,height:850});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} ${mode} ${width} overflow`);
        }
        await page.setViewportSize({width:393,height:850});
        if(mode==='ride')await page.screenshot({path:resolve(root,`.next-club-pickup/ride-${name}.png`),fullPage:true});
        await page.getByLabel('Pickup location',{exact:true}).fill('Synthetic hotel lobby');
        await page.getByLabel('Party size',{exact:true}).fill('2');
        await page.getByLabel('Agree & Continue').check();
        const start=actions.length;
        if(mode==='ride')failNextRequest=true;
        await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).click();
        if(mode==='ride') {
          await page.getByRole('alert').waitFor();
          assert.equal(await page.evaluate(()=>localStorage.getItem('mydancrPendingNfcDealV2')),null);
          await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).click();
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
      await page.getByLabel('Agree & Continue').check();
      await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='mydancrPendingNfcDealV2')throw new Error('Synthetic storage failure');window.__originalSetItem.call(this,key,value)};});
      await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).click();
      await page.getByRole('button',{name:'Save free entry and open chat',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Message Test Club',exact:true}).getAttribute('href'),'/pickups/'+id(20));
      assert.equal(await page.evaluate(()=>window.__destination),undefined);
      const sentBeforeRecovery=actions.length;
      await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;});
      await page.getByRole('button',{name:'Save free entry and open chat',exact:true}).click();
      await page.waitForFunction(()=>Boolean(window.__destination));assert.equal(actions.length,sentBeforeRecovery);
      await page.goto(base+'/?mode=phone');await page.getByText('This club coordinates pickup by phone. Pickup chat is not enabled.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).count(),0);
      // Signing in from the free-entry chooser returns directly to the attributed ride.
      await page.goto(base+'/?mode=entry');await page.getByLabel('Free club transport').click();
      await page.evaluate(()=>localStorage.removeItem('dancrAuthSessionV1'));
      const login=page.getByRole('link',{name:'Customer sign in',exact:true});await login.waitFor();
      const continuation=new URL(new URL(await login.getAttribute('href'),base).searchParams.get('return_to'),base);
      assert.equal(continuation.pathname,'/rides/'+id(10));assert.equal(continuation.searchParams.get('dealId'),id(40));
      assert.equal(continuation.searchParams.get('attributionToken'),'synthetic-attribution');
      assert.equal(await page.getByRole('button',{name:'Request pickup & open chat',exact:true}).count(),0);
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
      await page.getByLabel('Status',{exact:true}).selectOption('cancelled');await page.getByLabel('Reason',{exact:true}).fill('Plans changed');await page.getByRole('button',{name:'Confirm update'}).click();
      await page.getByText('Cancelled',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).count(),0);
      await page.getByRole('button',{name:'Report Conversation'}).click();await page.getByLabel('Details (optional)').fill('Synthetic report');await page.getByRole('button',{name:'Send report',exact:true}).click();await page.getByText('Your report was sent to MyDancr for review.').waitFor();
      role='venue';consented=false;status='requested';
      await page.evaluate(()=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-venue',account:{id:'96000000-0000-4000-8000-000000000003',role:'venue'}})));
      await page.getByRole('button',{name:'Agree & Continue',exact:true}).waitFor();assert.equal(await page.locator('.pickup-message').count(),0);
      await page.getByRole('button',{name:'Agree & Continue',exact:true}).click();await page.getByLabel('Message customer').waitFor();
      await page.getByLabel('Status',{exact:true}).selectOption('accepted');await page.getByRole('button',{name:'Confirm update'}).click();await page.getByText('Venue Accepted',{exact:true}).waitFor();
      await page.goto(base+'/?mode=inbox');await page.getByRole('heading',{name:'Pickup Requests'}).waitFor();await page.locator('.pickup-list-item').waitFor();
      await page.getByText('Club Pickup settings',{exact:true}).click();await page.getByRole('button',{name:'Disable Club Pickup'}).click();await page.getByRole('button',{name:'Enable Club Pickup'}).waitFor();
      await page.goto(base+'/?mode=chat');await page.locator('.pickup-messages').waitFor();
      await page.evaluate(()=>localStorage.removeItem('dancrAuthSessionV1'));await page.getByRole('link',{name:'Customer sign in'}).waitFor();
      assert.equal(await page.locator('.pickup-message').count(),0);await page.waitForFunction(()=>window.__subscriptions===0);
      assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:name,request:true,chat:true,retrySameMessageId:true,realtimeReconcile:true,consent:true,cancellation:true,report:true,venueStatus:true,settings:true,logoutClearsData:true,widths:[320,393,1280],runtimeErrors:errors}));
    }finally{await browser.close();}
  }
}finally{await new Promise(done=>server.close(done));}
