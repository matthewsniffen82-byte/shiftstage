import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import postcss from 'postcss';

const require=createRequire(import.meta.url);
const source=readFileSync('app/admin/AdminMediaWorkbench.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[];
const item=(id,kind='photo')=>({id,queue_key:kind+':'+id,kind,stage:'staff',updated_at:'2026-10-23T00:00:00Z',dancer_name:'Test dancer',previewUrl:'/media/'+id,upload_context:'profile_main'});

function fixture(initial,write=async(_path,body)=>body.decision==='approved'?{record:{id:body.recordId,decision:'approved'},video:{id:body.videoId,status:'approved',published_at:'2026-10-23'}}:{record:{id:body.recordId,decision:'rejected'},video:{id:body.videoId,status:'rejected'}}) {
  let rows=initial.slice(),cursor=0,dirty=true,tree;
  const slots=[],effects=[],calls=[],saved=[],intervals=[];
  const hooks={
    useState(initial){const i=cursor++,slot=slots[i]||={value:typeof initial==='function'?initial():initial};return [slot.value,next=>{slot.value=typeof next==='function'?next(slot.value):next;dirty=true;}];},
    useRef(initial){return slots[cursor++]||={current:initial};},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
    useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n]))slots[i]={deps,fn};return slots[i].fn;},
  };
  const exports={};
  vm.runInNewContext(code,{exports,AbortController,URLSearchParams,Date,Error,
    setTimeout(){return 1;},clearTimeout(){},setInterval(fn){intervals.push(fn);return intervals.length;},clearInterval(){},
    document:{visibilityState:'visible'},window:{confirm:()=>true,addEventListener(){},removeEventListener(){}},
    require(name){
      if(name==='react')return hooks;
      if(name==='react/jsx-runtime')return require(name);
      if(name==='./admin-session')return {requestAdminJson:async(path,options={})=>{
        calls.push([path,options]);
        if(options.method==='POST'){
          const body=JSON.parse(options.body),result=await write(path,body);
          if((result.record?.decision||result.video?.status)===body.decision)rows=rows.filter(row=>row.id!==body.recordId);
          return result;
        }
        const params=new URL(path,'https://test.invalid').searchParams,counts={staff:rows.length,club:0,processing:0};
        if(params.get('view')==='dancers')return {dancers:rows.length?[{id:'dancer:test',stageName:'Test dancer',count:rows.length,photoCount:rows.filter(r=>r.kind==='photo').length,videoCount:rows.filter(r=>r.kind==='video').length,previewKind:'photo',previewUrl:'/main.jpg'}]:[],dancerCount:rows.length?1:0,total:rows.length,counts};
        return {items:rows,total:rows.length,nextCursor:null,counts};
      }};
      return {default:name};
    },
  });
  function render(){for(let n=0;dirty&&n<20;n++){dirty=false;cursor=0;tree=exports.default({userId:'reviewer',active:true,onSaved:message=>saved.push(message)});effects.splice(0).forEach(fn=>fn());}assert.equal(dirty,false);return walk(tree);}
  render();
  return {calls,saved,intervals,nodes:render,
    get cards(){return render().filter(n=>n.type==='article');},
    button(label){return render().find(n=>n.type==='button'&&n.props.children===label);},
    async settle(){await new Promise(resolve=>setImmediate(resolve));render();},
    async open(){await this.settle();render().find(n=>n.props.className==='admin-media-dancer-card').props.onClick();render();await this.settle();},
    unmount(){slots.forEach(slot=>slot?.cleanup?.());},
  };
}

test('dancer cards open a media grid with controls under each photo/video and retain the dancer until their final decision',async()=>{
  const f=fixture([item('photo'),item('video','video')]);
  try{
    await f.open();assert.equal(f.cards.length,2);
    const video=f.nodes().find(n=>n.type==='video');assert.equal(video.props.controls,true);assert.equal(video.props.playsInline,true);
    for(const card of f.cards){const nodes=walk(card);assert.ok(nodes.findIndex(n=>n.props.className==='admin-media-preview')<nodes.findIndex(n=>n.props.children==='Approve'));}
    const approve=f.button('Approve');const pending=approve.props.onClick();approve.props.onClick();await pending;await f.settle();
    assert.equal(f.calls.filter(([,o])=>o.method==='POST').length,1,'duplicate taps cannot submit twice');
    assert.equal(f.cards.length,1);assert.ok(f.button('← All dancers'));
    await f.button('Approve').props.onClick();await f.settle();await f.settle();
    assert.equal(f.cards.length,0);assert.equal(f.button('← All dancers'),undefined);assert.equal(f.saved.length,2);
    const writes=f.calls.filter(([,o])=>o.method==='POST');
    assert.equal(writes[0][0],'/api/admin/image-moderation');assert.equal(writes[1][0],'/api/admin/tv/videos');
    assert.equal(JSON.parse(writes[0][1].body).version,'2026-10-23T00:00:00Z');
  }finally{f.unmount();}
});

test('a video-only queue displays the main photo on its clickable dancer card and videos inside',async()=>{
  const f=fixture([item('video','video')]);
  try{
    await f.settle();
    const card=f.nodes().find(node=>node.props.className==='admin-media-dancer-card');
    const photo=walk(card).find(node=>node.type==='img');
    assert.equal(photo.props.src,'/main.jpg');assert.equal(card.type,'button');
    assert.equal(card.props['aria-label'],'Review 1 uploads from Test dancer');
    assert.equal(f.cards.length,0);
    await f.open();
    assert.equal(f.cards.length,1);assert.equal(f.nodes().find(node=>node.type==='video').props.src,'/media/video');
    assert.match(f.calls.at(-1)[0],/group=dancer%3Atest/);
  }finally{f.unmount();}
});

test('failed or unconfirmed publication keeps the upload available and never claims success',async()=>{
  for(const write of [async()=>{throw new Error('Another reviewer claimed this upload.');},async()=>({video:{id:'v',status:'approved'}})]){
    const f=fixture([item('v','video')],write);
    try{await f.open();await f.button('Approve').props.onClick();await f.settle();assert.equal(f.cards.length,1);assert.equal(f.saved.length,0);assert.ok(f.nodes().find(n=>n.props.role==='alert'));}finally{f.unmount();}
  }
});

test('rejection requires a reason, sends it with the upload version, and removes only the reviewed upload',async()=>{
  const f=fixture([item('a'),item('b')]);
  try{
    await f.open();f.button('Reject').props.onClick();f.nodes();
    let form=f.nodes().find(n=>n.type==='form');await form.props.onSubmit({preventDefault(){}});await f.settle();
    assert.equal(f.calls.filter(([,o])=>o.method==='POST').length,0);
    f.nodes().find(n=>n.type==='input'&&n.props.placeholder==='e.g. Logo visible').props.onChange({target:{value:'Logo visible'}});
    form=f.nodes().find(n=>n.type==='form');await form.props.onSubmit({preventDefault(){}});await f.settle();
    assert.equal(f.cards.length,1);const body=JSON.parse(f.calls.find(([,o])=>o.method==='POST')[1].body);
    assert.equal(body.decision,'rejected');assert.equal(body.notes,'Logo visible');assert.match(f.saved[0],/rejected/);
  }finally{f.unmount();}
});

test('count polling preserves the current media sources and review notes',async()=>{
  const f=fixture([item('v','video')]);
  try{await f.open();f.button('Reject').props.onClick();f.nodes().find(n=>n.type==='input'&&n.props.placeholder).props.onChange({target:{value:'Audio concern'}});f.nodes();
    f.intervals.at(-1)();await f.settle();
    assert.equal(f.nodes().find(n=>n.type==='video').props.src,'/media/v');
    assert.equal(f.nodes().find(n=>n.type==='input'&&n.props.placeholder).props.value,'Audio concern');
    assert.ok(f.calls.at(-1)[0].includes('countsOnly=1'));
  }finally{f.unmount();}
});

test('filter controls and the back/count toolbar retain their navigation and review behavior', async () => {
  const f = fixture([item('a'), item('b')]);
  try {
    await f.open();
    const toolbar = f.nodes().find(node => node.props.className === 'admin-media-toolbar');
    assert.ok(walk(toolbar).some(node => node.props.className === 'admin-media-back'));
    assert.ok(walk(toolbar).some(node => node.props.role === 'status' && node.props.children === '2 uploads · 2 loaded'));
    assert.equal(f.nodes().filter(node => node.props.className === 'admin-media-search').length, 1);
    f.button('← All dancers').props.onClick(); await f.settle();
    assert.equal(f.cards.length, 0);
    assert.ok(f.nodes().some(node => node.props.className === 'admin-media-dancer-card'));
    await f.open();
    f.nodes().find(node => node.type === 'select' && node.props.value === 'all').props.onChange({ target: { value: 'video' } });
    await f.settle();
    assert.equal(f.button('← All dancers'), undefined);
    assert.ok(f.calls.at(-1)[0].includes('kind=video'));
  } finally { f.unmount(); }
});

test('admin review grids retain three portrait columns without escaping the clipped panel',()=>{
  const rules=[];postcss.parse(readFileSync('app/admin/admin-media-grid.css','utf8')).walkRules(rule=>rules.push(rule));
  const values=selector=>Object.fromEntries(rules.find(r=>r.selector===selector).nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]));
  const selector='.admin-media-grid-workbench :is(.admin-media-dancer-grid, .admin-media-review-grid)';
  const grid=values(selector);
  assert.equal(grid['grid-template-columns'],'repeat(3, minmax(0, 1fr))');assert.equal(grid.gap,'var(--dancr-media-grid-gap, 3px)');
  assert.equal(grid.width,'100%');assert.equal(grid['max-width'],'100%');assert.equal(grid['box-sizing'],'border-box');
  assert.equal(grid['margin-inline'],'0');assert.equal(grid['padding-inline'],'0');
  for (const rule of rules.filter(rule => rule.selector === selector)) {
    rule.walkDecls(decl => assert.doesNotMatch(decl.value, /vw/, 'mobile rules must not expand beyond the admin panel'));
  }
  const preview=values('.admin-media-grid-workbench .admin-media-preview');assert.equal(preview['aspect-ratio'],'9 / 16');assert.equal(preview['border-radius'],'8px');
  assert.equal(preview.overflow,'hidden');
  const media=values('.admin-media-grid-workbench .admin-media-preview :is(img,video)');
  assert.equal(media.position,'absolute');assert.equal(media.inset,'0');assert.equal(media.height,'100%');
});

test('admin filters are compact, wrap on narrow screens, and leave space before the review grid', () => {
  const rules=[];postcss.parse(readFileSync('app/admin/admin-media-grid.css','utf8')).walkRules(rule=>rules.push(rule));
  const values=(selector,media)=>Object.fromEntries(rules.find(rule=>rule.selector===selector && (rule.parent.type==='atrule'?rule.parent.params:undefined)===media).nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
  const prefix='body .admin-shell .admin-media-grid-workbench';
  const controls=values(prefix+' .admin-media-filters :is(input, select)');
  assert.equal(controls.height,'44px');assert.equal(controls['min-height'],'44px');assert.equal(controls['font-size'],'16px');
  assert.equal(controls['min-width'],'0');assert.equal(controls['max-width'],'100%');assert.equal(controls['box-sizing'],'border-box');
  assert.equal(values(prefix+' label')['letter-spacing'],'0');
  assert.equal(values(prefix+' .admin-media-filters','(max-width: 760px)')['grid-template-columns'],'minmax(0, 1.25fr) minmax(0, 1fr)');
  assert.equal(values(prefix+' .admin-media-search','(max-width: 760px)')['grid-column'],'1 / -1');
  assert.equal(values(prefix+' .admin-media-filters','(max-width: 359px)')['grid-template-columns'],'minmax(0, 1fr)');
  const toolbar=values(prefix+' .admin-media-toolbar');
  assert.equal(toolbar['flex-wrap'],'wrap');assert.equal(toolbar.gap,'8px');assert.equal(toolbar['margin-block'],'12px');
  const back=values(prefix+' .admin-media-back');
  assert.equal(back['min-height'],'44px');assert.equal(back['font-size'],'13px');assert.equal(back.margin,'0');
  const actions=values('.admin-media-grid-workbench :is(.admin-media-card-actions,.admin-media-rejection) button');
  assert.equal(actions['min-height'],'44px');assert.equal(actions['max-width'],'100%');assert.equal(actions['white-space'],'normal');
  const history=values('.admin-media-grid-workbench .admin-media-review-grid :is(details, summary)');
  assert.equal(history['font-size'],'12px');assert.equal(history['overflow-wrap'],'anywhere');
});
