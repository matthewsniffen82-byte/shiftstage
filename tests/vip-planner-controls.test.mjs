import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import sharp from 'sharp';
import { dancers } from './helpers/vip-dashboard-fixture.mjs';
import * as helpers from '../src/lib/dancr/vip-dashboard.ts';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';

const styles = file => postcss.parse(readFileSync(new URL('../app/vip/' + file, import.meta.url), 'utf8'));
const polish = styles('vip-dashboard-polish.css');
const premium = styles('vip-premium.css');
const library = styles('vip-my-dancers.css');
function rule(root, selector) {
  const matches = [];
  root.walkRules(selector, node => matches.push(node));
  assert.equal(matches.length, 1, selector);
  return matches[0];
}
const declarations = node => Object.fromEntries(node.nodes.filter(child => child.type === 'decl').map(child => [child.prop, child.value]));

test('only the iPhone mobile Plan a visit button gets the darker reference purple', () => {
  const selector = 'body.dancr-button-system #vip-dashboard .vip-mobile-continue button.vip-primary';
  const face = rule(polish, selector);
  assert.equal(face.parent.name, 'supports'); assert.equal(face.parent.params, '(-webkit-touch-callout: none)');
  assert.equal(face.parent.parent.name, 'media'); assert.equal(face.parent.parent.params, '(max-width: 880px)');
  assert.deepEqual(declarations(face), {
    background: 'linear-gradient(110deg, #3000a3, #210078)', 'border-color': '#513776', color: '#fff',
    'box-shadow': 'none', 'text-shadow': 'none',
  });
  assert.ok(face.nodes.every(node => node.important));
  assert.equal(declarations(rule(polish, selector + ':enabled')).filter, 'none');
  assert.equal(declarations(rule(polish, 'body.dancr-button-system #vip-dashboard button.vip-primary')).background, 'linear-gradient(110deg, #6b29cb, #4c16a2)');
  assert.match(declarations(rule(polish, 'body.dancr-button-system #vip-dashboard :is(button, a, input, select, textarea):focus-visible')).outline, /^2px solid/);
});

test('VIP selection PNGs retain distinct neutral plus/check pixels and preserve checkbox states', async () => {
  const icon = declarations(rule(premium, '.vip-dashboard-shell .vip-selection-icon'));
  assert.equal(icon.width, '21px'); assert.equal(icon.height, '21px');
  assert.equal(declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input:disabled + .vip-selection-icon')).opacity, '.5');
  assert.match(declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input:focus-visible + .vip-selection-icon')).outline, /^2px solid/);
  assert.equal(declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input')).appearance, 'none');
  assert.equal(declarations(rule(library, 'body.dancr-button-system #vip-dashboard .vip-library-request svg')).fill, '#17111f');
  const ui=plannerHarness();
  const selection=ui.nodes().find(node=>node.props?.className==='vip-dancer-select');
  const input=ui.nodes(selection).find(node=>node.type==='input');
  assert.equal(input.props.type,'checkbox');
  const artwork=()=>ui.nodes().find(node=>node.props?.className==='vip-selection-icon');
  assert.equal(artwork().type,'img'); assert.equal(artwork().props.alt,'');
  assert.equal(artwork().props['aria-hidden'],'true');
  const plus=artwork().props.src;
  ui.select(dancers[0].id);assert.deepEqual(Array.from(ui.props.draft.selected),[dancers[0].id]);
  const check=artwork().props.src;
  assert.notEqual(plus,check);
  const pixel=(image,x,y)=>Array.from(image.data.subarray((Math.floor(y*3.5)*84+Math.floor(x*3.5))*4,(Math.floor(y*3.5)*84+Math.floor(x*3.5))*4+4));
  const decoded=[];
  for(const image of [plus,check]) {
    assert.match(image,/^data:image\/png;base64,/,'use raster artwork so SVG fills cannot be recolored separately');
    const raster=await sharp(Buffer.from(image.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(raster.info.width,84); assert.equal(raster.info.height,84);
    assert.deepEqual(pixel(raster,6,6),[23,23,23,255],'opaque dark face');
    for(let i=0;i<raster.data.length;i+=4) {
      assert.equal(raster.data[i],raster.data[i+1],'neutral pixels, never pink');
      assert.equal(raster.data[i],raster.data[i+2]);
    }
    decoded.push(raster);
  }
  assert.ok(pixel(decoded[0],12,8)[0]>240,'white vertical plus arm');
  assert.ok(pixel(decoded[1],12,8)[0]<30,'check is distinct from plus');
  assert.ok(pixel(decoded[1],16,9)[0]>240,'white check stroke');
  assert.ok(pixel(decoded[0],16,9)[0]<30,'plus is distinct from check');
  ui.select(dancers[0].id,false);assert.equal(ui.props.draft.selected.length,0);
  assert.equal(artwork().props.src,plus);
});

test('VIP filter faces retain dark artwork and Android gets compact spacing with usable touch targets', () => {
  const faces=[];
  polish.walkRules('body.dancr-button-system #vip-dashboard .vip-roster-filters button', node=>{
    if(declarations(node).background)faces.push(declarations(node));
  });
  assert.match(faces[0].background,/linear-gradient\(#1a171e, #1a171e\)/);
  const selected=declarations(rule(polish,'body.dancr-button-system #vip-dashboard .vip-roster-filters button[aria-pressed=true]'));
  assert.match(selected.background,/linear-gradient\(#30243e, #30243e\)/);
  assert.match(declarations(rule(polish,'body.dancr-button-system #vip-dashboard .vip-filter-count')).background,/linear-gradient/);
  const selector='html:is(.is-android, .android-rendering, .is-samsung-browser, .samsung-rendering) body.dancr-button-system #vip-dashboard .vip-roster-filters';
  const compact=rule(polish,selector+' button');
  assert.equal(compact.parent.params,'(max-width: 600px)');
  assert.equal(declarations(compact)['min-height'],'70px');
  assert.equal(declarations(compact).padding,'6px');
  assert.equal(declarations(rule(polish,selector)).gap,'6px');
});

test('Plan a visit shows its count and opens the details step with keyboard focus', () => {
  const ui=plannerHarness({draft:{...helpers.emptyVipDraft(),selected:[dancers[0].id]}});
  const dock=()=>ui.nodes().find(node=>node.props?.className==='vip-mobile-continue');
  assert.equal(ui.nodes(dock()).find(node=>node.type==='strong').props.children,1);
  assert.equal(ui.nodes(dock()).find(node=>node.type==='button').props.disabled,false);
  ui.props.busy=true;ui.render();assert.equal(ui.nodes(dock()).find(node=>node.type==='button').props.disabled,true);
  ui.props.busy=false;ui.render();ui.details();
  assert.equal(ui.focused.at(-1),'vip-visit-details');assert.equal(dock(),undefined);
  ui.back();assert.equal(ui.focused.at(-1),'vip-choose-dancers');assert.ok(dock());
  ui.props.draft=helpers.emptyVipDraft();ui.render();assert.equal(dock(),undefined);
});

test('every dancer filter counts its matching results and updates with search, eligibility, favorites and selection', () => {
  const roster=[
    {id:'aria',stage_name:'Aria',canRequest:true,working_now:true,favorite:true,following:true,previouslyRequested:true},
    {id:'nova',stage_name:'Nova',canRequest:true,working_now:false,following:true},
    {id:'past',stage_name:'Past dancer',canRequest:false,working_now:false,favorite:true,previouslyRequested:true},
    {id:'elsewhere',stage_name:'Elsewhere',canRequest:false,working_now:false,favorite:true,following:true},
  ];
  const labels=['This club','Favorites','Requested before','Working now','Selected'];
  const ui=plannerHarness({dancers:roster});
  const counts=()=>labels.map(label=>ui.nodes(ui.button(label)).find(node=>node.props?.className==='vip-filter-count').props.children);
  assert.deepEqual(counts(),[3,3,2,1,0]);
  for(const label of labels){
    const count=ui.nodes(ui.button(label)).find(node=>node.props?.className==='vip-filter-count').props.children;
    assert.equal(ui.button(label).props['aria-label'],`${label}, ${count} ${count===1?'dancer':'dancers'}`);
    ui.filter(label);assert.equal(ui.nodes().filter(node=>node.type==='article').length,count);
  }
  ui.filter('This club');ui.select('aria');assert.deepEqual(counts(),[3,3,2,1,1]);
  ui.search(' aria ');assert.deepEqual(counts(),[1,1,1,1,1]);
  ui.search('');ui.nodes().find(node=>node.props?.type==='checkbox').props.onChange({target:{checked:true}});ui.render();
  assert.deepEqual(counts(),[2,1,1,1,1]);
  ui.props.dancers=roster.map(dancer=>({...dancer,favorite:false}));ui.render();
  assert.deepEqual(counts(),[2,0,1,1,1]);
  ui.props.dancers=roster.map(dancer=>({...dancer,favorite:false,following:false}));ui.render();
  assert.deepEqual(counts(),[2,0,1,1,1]);
  assert.equal(ui.button('Favorites').props.disabled,false,'empty collections remain available');
  ui.props.busy=true;ui.render();assert.ok(labels.every(label=>ui.button(label).props.disabled));
});
