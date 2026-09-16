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
const Inbox=require('./app/pickups/PickupInbox.tsx').default;
const Dashboard=require('./app/dashboard/PickupDashboardPanel.tsx').default;
const {DashboardStyles}=require('./app/dashboard/DashboardStyles.tsx');
const Transportation=require('./app/deals/transportation/[dealId]/TransportationClient.tsx').default;
const mode=new URLSearchParams(location.search).get('mode');
const venue={id:'96000000-0000-4000-8000-000000000010',name:'Test Club',slug:'test-club'};
const component=mode==='inbox'?React.createElement(Inbox):mode==='dashboard'?React.createElement('section',{className:'dashboard-shell dashboard-shell-venue'},React.createElement(DashboardStyles),React.createElement('section',{className:'info-panel'},React.createElement(Dashboard))):React.createElement(Transportation,{venue,deal:mode==='ride-only'?undefined:{id:'96000000-0000-4000-8000-000000000040',venueId:venue.id},shuttleAvailable:true,initialTransportation:'club_shuttle',sourceType:'dancer_profile',dancerId:'96000000-0000-4000-8000-000000000006',attributionToken:'synthetic-attribution'});
createRoot(document.getElementById('app')).render(component);`,root);
const bundle=`var process={env:{NODE_ENV:'development'}};var modules={${Object.entries(modules).map(([id,m])=>`${JSON.stringify(id)}:[function(require,module,exports){${m.code}\n},${JSON.stringify(m.deps)}]`).join(',')}};var cache={};function run(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id][0](name=>run(modules[id][1][name]),m,m.exports);return m.exports;}run(${entry});`;
const css=['public/dancr-brand-tokens.v1.css','public/dancr-button-system.v1.css','public/dancr-aesthetic.v1.css','app/pickups/pickup.css','app/deals/transportation/[dealId]/transportation.css'].map(file=>readFileSync(resolve(root,file),'utf8')).join('\n');
const server=createServer((req,res)=>{
  res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');
  res.end(req.url==='/bundle.js'?bundle: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body class="dancr-button-system"><div class="pickup-page"><div id="app"></div></div><script src="/bundle.js"></script></body>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`, id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
mkdirSync(resolve(root,'.next-club-pickup'),{recursive:true});
try {
  for(const [name,engine,device] of [['android',chromium,'Pixel 5'],['iphone',webkit,'iPhone 13']]) {
    const browser=await engine.launch({headless:true,...(name==='android'?{channel:'msedge'}:{})});
    try {
      const context=await browser.newContext({...devices[device]});
      const page=await context.newPage(), errors=[], requests=[];
      page.on('pageerror',e=>errors.push(e.message));
      let failOnce=true;
      await page.route('**/api/**/shuttle',async route=>{
        requests.push({url:route.request().url(),body:route.request().postDataJSON()});
        const fail=failOnce;failOnce=false;
        await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{ok:false,error:'Please retry the same request.'}:{ok:true,requestId:requests.at(-1).body.requestId,message:'Your request has been sent to the club manager.'})});
      });
      for(const mode of ['ride','ride-only']){
        await page.goto(base+'/?mode='+mode);
        await page.getByText('No sign-in needed.',{exact:true}).waitFor();
        assert.doesNotMatch(await page.locator('body').innerText(),/chat|Enable notifications|Sign in to/i);
        for(const width of [320,393,1280]){
          await page.setViewportSize({width,height:850});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'form overflow '+width);
        }
        await page.setViewportSize({width:393,height:850});
        await page.getByLabel('Name',{exact:true}).fill('Test Guest');
        await page.getByLabel('Pickup location',{exact:true}).fill('Test Hotel, north entrance');
        await page.getByLabel('Guests',{exact:true}).fill('3');
        await page.getByLabel('Phone',{exact:true}).fill('7025550123');
        await page.getByLabel('Email',{exact:true}).fill('guest@example.test');
        await page.getByRole('checkbox').check();
        await page.screenshot({path:resolve(root,`.next-club-pickup/${name}-${mode}-contact-form.png`),fullPage:true});
        await page.getByRole('button',{name:'Send pickup request',exact:true}).click();
        if(mode==='ride'){
          await page.getByRole('alert').waitFor();
          await page.getByRole('button',{name:'Retry shuttle request',exact:true}).click();
          await page.getByRole('heading',{name:'Pickup requested',exact:true}).waitFor();
          assert.deepEqual(requests[0].body,requests[1].body,'network retries retain the request ID and details');
          const selection=await page.evaluate(()=>JSON.parse(localStorage.getItem('mydancrPendingNfcDealV2')));
          assert.equal(selection.shuttleRequestId,requests[1].body.requestId);assert.equal(selection.attributionToken,'synthetic-attribution');assert.equal(selection.pickupRequestId,undefined);
        }else await page.getByRole('heading',{name:'Pickup requested',exact:true}).waitFor();
        assert.equal(requests.at(-1).body.phone,'+17025550123');assert.equal(requests.at(-1).body.partySize,3);assert.equal(requests.at(-1).body.handoffAccepted,true);
        assert.match(requests.at(-1).url,mode==='ride'?/api\/deals\//:/api\/venues\//);
        assert.match(await page.locator('body').innerText(),/Awaiting club confirmation/);
      }
      await page.goto(base+'/?mode=inbox');
      await page.getByRole('link',{name:'Browse clubs',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:/Call /}).count(),0);
      await page.evaluate(()=>localStorage.setItem('dancrAuthSessionV1',JSON.stringify({accessToken:'synthetic-token',account:{id:'96000000-0000-4000-8000-000000000003',role:'venue'}})));
      const receipt=n=>({id:id(n+20),venue_id:id(10),venue_name:'Test Club',requested_at:'2026-09-15T10:00:00Z',name:'Test Guest '+n,location:'Test Hotel, north entrance',party_size:3,phone:'+17025550123',email:'guest@example.test'});
      let failInbox=false;
      await page.route('**/api/pickups**',async route=>{
        const url=new URL(route.request().url());
        if(failInbox){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Unable to load pickup requests.'})});return;}
        const result=url.pathname.endsWith('/settings')?{venues:[{id:id(10),name:'Test Club'}]}:{role:'venue',phoneRequests:url.searchParams.has('phoneOffset')?[receipt(30)]:Array.from({length:30},(_,n)=>receipt(n)),hasMorePhoneRequests:!url.searchParams.has('phoneOffset')};
        await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,...result})});
      });
      await page.reload();
      await page.getByRole('link',{name:'Call +17025550123',exact:true}).first().waitFor();
      assert.equal(await page.getByRole('link',{name:'Call +17025550123',exact:true}).count(),30);
      assert.equal(await page.getByRole('link',{name:'Call +17025550123',exact:true}).first().getAttribute('href'),'tel:+17025550123');
      assert.equal(await page.getByRole('link',{name:'Email guest@example.test',exact:true}).first().getAttribute('href'),'mailto:guest%40example.test');
      assert.doesNotMatch(await page.locator('body').innerText(),/chat|accept pickup|enable notifications/i);
      await page.getByRole('button',{name:'Load more requests',exact:true}).click();
      await page.getByText('Test Club · Test Guest 30',{exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Call +17025550123',exact:true}).count(),31);
      await page.screenshot({path:resolve(root,`.next-club-pickup/${name}-contact-inbox.png`),fullPage:true});
      failInbox=true;await page.getByRole('button',{name:'Refresh requests',exact:true}).click();await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('link',{name:/Call /}).count(),0,'stale contacts clear after access/read failure');
      failInbox=false;await page.getByRole('button',{name:'Refresh requests',exact:true}).click();await page.getByText('Test Club · Test Guest 0',{exact:true}).waitFor();
      await page.goto(base+'/?mode=dashboard');
      await page.getByText('Test Club · Test Guest 0',{exact:true}).waitFor();
      assert.equal(await page.locator('.notification-row').count(),6);
      assert.doesNotMatch(await page.locator('body').innerText(),/chat|unread|Enable pickup notifications/i);
      await page.goto(base+'/?mode=inbox');await page.getByText('Test Club · Test Guest 0',{exact:true}).waitFor();
      await page.evaluate(()=>{localStorage.removeItem('dancrAuthSessionV1');window.dispatchEvent(new Event('focus'));});
      await page.getByRole('link',{name:'Browse clubs',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:/Call /}).count(),0,'logout clears manager contacts');
      assert.deepEqual(errors,[]);
      console.log(name+': contact form, retry, free-entry selection, manager contacts, pagination and logout passed');
      await context.close();
    }finally{await browser.close();}
  }
}finally{await new Promise(done=>server.close(done));}
