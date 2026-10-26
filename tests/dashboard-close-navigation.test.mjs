import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as navigation from '../src/lib/dancr/navigation.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const origin = 'https://www.mydancr.com';
function compile(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, URL, ...globals, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
function fixture({ stored = null, referrer = '', blocked = false } = {}) {
  return compile('src/lib/dancr/home-return.ts', { './navigation': navigation }, {
    window: { location: { origin }, sessionStorage: { getItem() { if (blocked) throw new Error('Storage blocked'); return stored; } } },
    document: { referrer },
  });
}
for (const view of ['dancers','tv','venues']) test(`every dashboard returns directly to the remembered ${view} homepage tab`, () => {
  for (const referrer of ['/account?auth=login','/admin','/dashboard/venue','/?venue=rhino&venue_preview=1&preview_source=venue','/deals/transportation/offer?venue_preview=1','https://mail.example.test/message']) {
    const f=fixture({stored:`/?city=Miami&view=${view}`,referrer:new URL(referrer,origin).href});
    assert.equal(f.dashboardHomeReturnHref('/?view=tonight'),`/?city=Miami&view=${view}`);
  }
});
test('home returns retain the dancer filter but never reopen a profile, login overlay or preview', () => {
  const f=fixture();
  assert.equal(f.canonicalHomeReturnHref('/?city=Las%20Vegas&view=dancers&dancer_filter=not_now&profile=private&return_to=/admin#account',origin),'/?city=Las%20Vegas&view=dancers&dancer_filter=not_now');
  assert.equal(f.canonicalHomeReturnHref('/?view=trending&dancer_filter=invalid',origin),'/?city=Las%20Vegas&view=dancers');
  for(const value of ['/?auth=login','/?venue_preview=1','/?dancr_dashboard=venue','/dashboard/venue','/nfc/private','https://outside.test/?view=tv','//outside.test','javascript:alert(1)']) assert.equal(f.canonicalHomeReturnHref(value,origin),'',value);
});
test('blocked storage uses a referring homepage and direct entries still go home', () => {
  assert.equal(fixture({blocked:true,referrer:origin+'/?city=Miami&view=tv&tv_video=old-video'}).dashboardHomeReturnHref(),'/?city=Miami&view=tv');
  for(const referrer of ['',origin+'/account',origin+'/?venue_preview=1','https://outside.test/']) {
    assert.equal(fixture({referrer,stored:'https://outside.test'}).dashboardHomeReturnHref('/?view=venues'),'/?city=Las%20Vegas&view=venues');
  }
  assert.equal(fixture().dashboardHomeReturnHref('/admin'),'/');
});
test('the shared return control is a normal homepage anchor, independent of browser history', () => {
  let state,initialized=false;
  const Component=compile('app/components/DashboardCloseButton.tsx',{
    react:{useState(initial){if(!initialized){state=initial;initialized=true;}return [state,value=>state=value];},useEffect:effect=>effect()},
    '@/src/lib/dancr/home-return':fixture({stored:'/?view=tv',referrer:origin+'/account'}),
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  }).DashboardCloseButton;
  Component({fallbackHref:'/?view=dancers'});
  const anchor=Component({fallbackHref:'/?view=dancers'});
  assert.equal(anchor.type,'a');assert.equal(anchor.props.href,'/?city=Las%20Vegas&view=tv');
  assert.equal(anchor.props['aria-label'],'Back to MyDancr');assert.equal(anchor.props.onClick,undefined);
});

function shell({ search='', stored='/?city=Miami&view=tv', frame=false, blocked=false }={}) {
  const memory=new Map([['mydancr:home-return:v1',stored]]),navigations=[];
  const state={URL,URLSearchParams,internalProfileFrameId:frame?'internal-frame':'',homeDestinationOrder:['dancers','tv','venues'],citySelect:{value:'Las Vegas'},dancerDirectoryFilter:'not_now',selectedVenueName:'Rhino',
    window:{location:{search,assign:href=>navigations.push(href)},sessionStorage:{setItem(key,value){if(blocked)throw new Error('Storage blocked');memory.set(key,value);}}}};
  vm.createContext(state);
  for(const [file,name] of [['src/live-shell/app/25-events.js','rememberHomeDiscoveryDestination'],['src/live-shell/app/22-create-home-tv-landing-preloader.js','closeVenueProfile']]) {
    const source=read(file).match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n    }`))[0];
    vm.runInContext(source,state);
  }
  return {state,memory,navigations};
}
test('homepage selections remember only tab, city and dancer filter within their own browser tab', () => {
  const first=shell(),second=shell();first.state.rememberHomeDiscoveryDestination('dancers');
  assert.equal(first.memory.get('mydancr:home-return:v1'),'/?city=Las+Vegas&view=dancers&dancer_filter=not_now');
  assert.equal(second.memory.get('mydancr:home-return:v1'),'/?city=Miami&view=tv');
  first.state.rememberHomeDiscoveryDestination('venues');assert.equal(first.memory.get('mydancr:home-return:v1'),'/?city=Las+Vegas&view=venues');
  assert.doesNotThrow(()=>shell({blocked:true}).state.rememberHomeDiscoveryDestination('tv'));
});
test('customer previews return to the originating dashboard without replacing the homepage tab', () => {
  for(const source of ['venue','admin']) {
    const f=shell({search:`?venue=rhino&venue_preview=1&preview_source=${source}`});
    f.state.rememberHomeDiscoveryDestination('venues');assert.equal(f.memory.get('mydancr:home-return:v1'),'/?city=Miami&view=tv');
    assert.equal(f.state.closeVenueProfile(),true);assert.deepEqual(f.navigations,[source==='admin'?'/admin':'/dashboard/venue']);
  }
  for(const options of [{search:'?auth=login'},{search:'?dancr_dashboard=venue'},{frame:true}]) {
    const f=shell(options);f.state.rememberHomeDiscoveryDestination('dancers');assert.equal(f.memory.get('mydancr:home-return:v1'),'/?city=Miami&view=tv');
  }
});
test('customer, dancer, club, staff, admin and VIP headers use the shared return control', () => {
  for(const file of ['app/dashboard/DashboardClient.tsx','app/admin/AdminClient.tsx','app/vip/VipDashboard.tsx','app/vip/VipClient.tsx','app/account/AccountClient.tsx']) assert.match(read(file),/<DashboardCloseButton\b/,file);
});
