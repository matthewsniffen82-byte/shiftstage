import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as navigation from '../app/admin/admin-section-navigation.ts';
import { adminWorkspaceCounts, adminCountLabel } from '../app/admin/admin-workspace-counts.ts';

const jsx = (type, props) => ({ type, props });
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];
const read = path => readFileSync(path,'utf8');
const source = read('app/admin/AdminClient.tsx');
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX };

// Tag hook calls by their binding so this component fixture does not depend on hook order.
const ast = ts.createSourceFile('AdminClient.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const transformed = ts.transform(ast,[context => root => {
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useState'
      && ts.isVariableDeclaration(node.parent) && ts.isArrayBindingPattern(node.parent.name)) {
      return ts.factory.updateCallExpression(node,node.expression,node.typeArguments,[...node.arguments,ts.factory.createStringLiteral(node.parent.name.elements[0].name.getText(ast))]);
    }
    return ts.visitEachChild(node,visit,context);
  };
  return ts.visitNode(root,visit);
}]);
const compiled = ts.transpileModule(ts.createPrinter().printFile(transformed.transformed[0]),{compilerOptions}).outputText;
transformed.dispose();

function shell(overrides = {}) {
  const values = {
    access: { userId:'admin',role:'owner',venues:[],staff:[] }, isLoading:false,
    loadedWorkspaces:{home:true,approvals:true,clubs:true,people:true,money:true,more:true},
    workspace:'home', ...overrides,
  };
  const exports = {}, fallback = new Proxy({}, {get: (_target,key) => key === '__esModule' ? false : String(key)});
  vm.runInNewContext(compiled,{exports,Date,window:{},require(name) {
    if(name==='react')return {
      useState(initial,key) { if(!(key in values)) values[key] = typeof initial==='function'?initial():initial;
        return [values[key],next=>{values[key]=typeof next==='function'?next(values[key]):next;}]; },
      useRef: current=>({current}),useEffect() {},
    };
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='next/dynamic')return {default:()=> 'DynamicPanel'};
    if(name==='./admin-section-navigation')return navigation;
    if(name==='./admin-workspace-counts')return {adminWorkspaceCounts,adminCountLabel};
    if(name.includes('browser-session'))return {readBrowserAuthSession:()=>null};
    if(name==='./admin-session')return {readAdminSession:()=>null};
    if(name.endsWith('/navigation'))return {homeDiscoveryHref:()=>'/'};
    return fallback;
  }});
  const render = () => exports.default();
  return { values, render, all:()=>nodes(render()) };
}

test('each approval, club and tools category exposes one panel and retains its siblings',()=>{
  for(const [workspace,key,base,items] of [
    ['approvals','reviewSection','admin-review',navigation.ADMIN_REVIEW_SECTIONS],
    ['clubs','clubSection','admin-clubs',navigation.ADMIN_CLUB_SECTIONS],
    ['more','toolSection','admin-tools',navigation.ADMIN_TOOL_SECTIONS],
  ]) {
    const ui=shell({workspace});
    for(const item of items) {
      ui.values[key]=item.id;
      const panels=ui.all().filter(n=>n.props?.role==='tabpanel' && n.props.id.startsWith(base+'-'));
      assert.equal(panels.length,items.length,'switching preserves mounted panels');
      assert.deepEqual(panels.filter(n=>!n.props.hidden).map(n=>n.props.id),[`${base}-${item.id}-panel`]);
    }
  }
});

test('club applications have one mounted home; no club request lists are visible on Home',()=>{
  const all=shell().all();
  assert.equal(all.filter(n=>n.props?.id==='admin-club-requests').length,1);
  const requestLists=all.filter(n=>n.props?.onCountChange && n.props?.onOpen);
  assert.equal(requestLists.length,2);
  assert.ok(requestLists.every(n=>n.props.visible===false),'background counts remain connected without showing lists');
});

test('global-only screens omit a misleading club filter; media, directory and billing retain it',()=>{
  for(const config of [{workspace:'home'},{workspace:'more'},{workspace:'clubs',clubSection:'requests'},{workspace:'approvals',reviewSection:'reports'}]) {
    assert.equal(shell(config).all().some(n=>n.type==='select' && n.props.value===''),false);
  }
  for(const workspace of ['approvals','clubs','money']) {
    assert.ok(shell({workspace}).all().some(n=>n.type==='select' && n.props.value===''));
  }
});

test('restricted staff still see only their dedicated workspace',()=>{
  for(const role of ['reviewer','support','billing']) {
    const all=shell({access:{userId:'staff',role,venues:[],staff:[]}}).all();
    assert.equal(all.some(n=>n.props?.['aria-label']==='Admin workspaces'),false);
    assert.equal(all.some(n=>n.props?.label==='Club management'),false);
    assert.equal(all.some(n=>n.props?.id==='admin-staff-access'),false);
  }
});

test('existing queue links select their destination category, including legacy club links',()=>{
  let fn;const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='openWorkspace')fn=n;ts.forEachChild(n,visit);};visit(ast);
  const state={},exports={};
  vm.runInNewContext(ts.transpileModule(fn.getText(ast)+'\nexport {openWorkspace};',{compilerOptions}).outputText,{
    exports,adminSectionForPanel:navigation.adminSectionForPanel,workspace:'home',access:{userId:'admin'},scrollPositions:{current:{}},
    setReviewSection:v=>state.review=v,setClubSection:v=>state.club=v,setToolSection:v=>state.tool=v,setRequestedReviewFilter:v=>state.filter=v,
    setRequestedPanel:v=>state.panel=v,setWorkspace:v=>state.workspace=v,loadWorkspaceData:async v=>{state.loaded=v;},
    sessionStorage:{setItem(){}},window:{scrollY:0,requestAnimationFrame(){}},
  });
  for(const [workspace,panel,section] of [
    ['approvals','admin-photo-review','media'],['approvals','admin-dancer-approvals','profiles'],['approvals','admin-reports','reports'],
    ['clubs','admin-club-requests','requests'],['clubs','admin-club-synthetic-id','directory'],['clubs','admin-deal-requests','requests'],
    ['clubs','admin-guest-operations','guests'],['clubs','admin-tap-stickers','tools'],['more','admin-dmca','platform'],['more','admin-support','support'],
  ]) {
    exports.openWorkspace(workspace,panel);
    assert.equal(state.workspace,workspace);assert.equal(state.loaded,workspace);
    assert.equal(state[workspace==='approvals'?'review':workspace==='clubs'?'club':'tool'],section);
  }
  exports.openWorkspace('approvals','admin-club-requests');assert.equal(state.workspace,'clubs');assert.equal(state.club,'requests');
  for (const panel of ['admin-photo-review','admin-tv-review']) {
    exports.openWorkspace('approvals',panel);
    assert.equal(state.filter,'all','opening media must not leave a media-only filter on applications');
  }
});

test('category controls preserve accessible selection and support wrapping keyboard navigation',()=>{
  const exports={},focused=[],selected=[];
  vm.runInNewContext(ts.transpileModule(read('app/admin/AdminSectionNav.tsx'),{compilerOptions}).outputText,{
    exports,document:{getElementById:id=>({focus:()=>focused.push(id)})},require:()=>({jsx,jsxs:jsx}),
  });
  const tree=exports.default({id:'test',label:'Queues',items:navigation.ADMIN_REVIEW_SECTIONS,selected:'media',onSelect:id=>selected.push(id)});
  const buttons=nodes(tree).filter(n=>n.type==='button');
  assert.equal(buttons.filter(n=>n.props.tabIndex===0).length,1);
  assert.equal(buttons[0].props['aria-selected'],true);
  assert.equal(buttons[1].props['aria-controls'],'test-profiles-panel');
  buttons[0].props.onKeyDown({key:'ArrowLeft',preventDefault(){}});assert.equal(selected.at(-1),'reports');
  assert.equal(focused.at(-1),'test-reports-tab');
  buttons[2].props.onKeyDown({key:'Home',preventDefault(){}});assert.equal(selected.at(-1),'media');
  buttons[1].props.onClick();assert.equal(selected.at(-1),'profiles');
});

test('Home hides confirmed empty media delays but keeps loading, failures and actionable delays visible',()=>{
  const exports={},values=[];
  vm.runInNewContext(ts.transpileModule(read('app/admin/AdminWorkspaceTools.tsx'),{compilerOptions}).outputText,{
    exports,require(name) {
      if(name==='react')return {useState:()=>[values.shift(),()=>{}],useEffect(){}};
      if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
      return {};
    },
  });
  const opened=[],render=(data,error='')=>{
    values.push(data,error);
    return exports.AdminUrgentWork({onOpen:(...args)=>opened.push(args)});
  };
  const empty={ready:6,setups:4,overdue:0,stalled:0};
  assert.equal(render(empty),null,'normal media and club queues are already shown in Needs attention');
  assert.equal(nodes(render(null)).filter(n=>n.props?.role==='status').length,1);
  assert.equal(nodes(render(empty,'Could not refresh')).filter(n=>n.props?.role==='status').length,1);
  const buttons=nodes(render({...empty,stalled:2})).filter(n=>n.type==='button');
  assert.equal(buttons.length,1);
  assert.equal(nodes(buttons[0]).find(n=>n.type==='strong').props.children,2);
  buttons[0].props.onClick();assert.deepEqual(opened,[['approvals','admin-media-workbench']]);
});
