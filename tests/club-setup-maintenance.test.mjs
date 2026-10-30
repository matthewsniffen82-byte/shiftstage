import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const copy = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(copy).join(' ') : node && typeof node === 'object' ? copy(node.props?.children) : '';
function panel(profile, deals = [], role = "owner", hash = "#venue-publication") {
  const exports = {};
  const deps = {
    './VenueContactsSection': { default: 'VenueContactsSection' },
    './useVenueOperations': { useVenueOperations: () => ({ operations: {}, error: null }) },
    './useVenueApprovalCompletion': { useVenueApprovalCompletion() {} },
    '@/src/lib/dancr/venue-dashboard-demo': { isVenueDashboardDemo: () => false },
    '@/src/lib/dancr/club-deal-presets': { CLUB_DEAL_OFFER_PRESETS: [{ key:'free_admission',title:'Free admission' }] },
    './DashboardShared': { formatVenueReviewHours: () => '24 hours', DashboardSection: 'section' },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/VenueDashboardPanels.tsx','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, window:{location:{hash}}, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {}, useRef: value => ({ current:value }) };
    if (name === 'next/dynamic') return { default: loader => loader.toString().match(/\.\/(\w+)/)[1] };
    return deps[name] || new Proxy({}, { get: () => 'Stub' });
  }});
  const tree = exports.VenuePanel({ profile, venueDeals: deals, dealRequests: [], initialAffiliations: [], workingNow: [],
    venueAccess: { role, permissions: ['view_team','view_roster','request_nfc_support'] }, supportThreads: [],
    analyticsPeriod:'tonight', isRefreshing:false, refreshedAt:'2026-10-30' });
  return { tree, nodes:nodes(tree), text:copy(tree) };
}
const club = { id:'club', name:'Test Club', slug:'test-club', city:'Las Vegas', isActive:false, pageReviewStatus:'admin_draft' };
test('a new club sees preparation status without tasks owned by MyDancr or an optional completion count', () => {
  const p=panel(club);
  assert.match(p.text, /MyDancr is preparing your venue page/);
  assert.doesNotMatch(p.text, /Activate a Club Deal|Club setup|Add your team|\d\/\d ready/);
  assert.equal(p.nodes.some(n=>n.props?.['aria-label']==='Club maintenance'),false);
});
test('a review-ready club gets one approval package with correction controls collapsed', () => {
  const p=panel({...club,pageReviewStatus:'venue_review'});
  assert.match(p.text,/Review your club page & deal/);
  assert.equal(p.nodes.filter(n=>n.type==='button' && copy(n)==='Approve & make live').length,1);
  const packageNode=p.nodes.find(n=>n.props?.className==='venue-review-package');
  assert.equal(packageNode.type,'details'); assert.equal(packageNode.props.open,true);
  const changes=p.nodes.find(n=>n.props?.className==='venue-review-request');
  assert.equal(changes.type,'details'); assert.equal(changes.props.open,undefined);
});
for (const active of [true,false]) test(`${active?'live':'hidden'} approved club gets maintenance without repeating onboarding`, () => {
  // Open Club for this component render, without a browser journey.
  const p=panel({...club,isActive:active,pageReviewStatus:'published',publishedAt:'2026-10-26'},[{isActive:true,dealTitle:'Free admission'}]);
  assert.match(p.text, active ? /LIVE/ : /HIDDEN/);
  assert.doesNotMatch(p.text,/PRIVATE DRAFT|Activate a Club Deal|Club setup/);
  assert.equal(p.nodes.some(n=>n.props?.['aria-label']==='Club maintenance'),false);
  assert.ok(p.nodes.some(n=>n.props?.id==='venue-tools' && n.type==='details'));
  assert.ok(p.nodes.some(n=>n.props?.href==='#venue-support'));
  if (active) assert.match(p.text,/View club page/);
  assert.equal(p.nodes.find(n=>n.props?.className==='venue-review-package').props.open,undefined);
  if (!active) assert.match(p.text,/approval is saved/);
});

function visibilityAction(confirm, receipt) {
  const source=readFileSync('app/admin/AdminClient.tsx','utf8');
  const ast=ts.createSourceFile('AdminClient.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let fn; const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='changeVenueVisibility')fn=n; ts.forEachChild(n,visit);}; visit(ast);
  const calls=[],states=[],exports={};
  vm.runInNewContext(ts.transpileModule(fn.getText(ast)+'\nexport {changeVenueVisibility};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,window:{confirm:()=>confirm},asText:String,Error,beginVenueAction:()=>{calls.push('begin');return {controller:new AbortController()};},
    setBusyVenueId(){},setVenueStatus:(id,message)=>states.push(message),finishVenueAction(){},isCurrentVenueAction:()=>true,
    requestAdminJson:async(path,options)=>{calls.push(JSON.parse(options.body));return {venue:receipt};},
    venues:[{id:'club'}],onVenuesChange:rows=>calls.push(rows),
  });
  return {run:visible=>exports.changeVenueVisibility({id:'club',name:'Test Club'},visible),calls,states};
}
test('canceling Hide club leaves the listing untouched', async () => {
  const f=visibilityAction(false); await f.run(false); assert.deepEqual(f.calls,[]);
});
for(const visible of [true,false]) test(`confirmed ${visible?'restore':'hide'} verifies its matching receipt`, async () => {
  const good=visibilityAction(true,{id:'club',is_active:visible,page_review_status:'published'}); await good.run(visible);
  assert.equal(good.calls[1].action,visible?'restore':'hide');assert.equal(good.calls.length,3);
  const bad=visibilityAction(true,{id:'other',is_active:visible,page_review_status:'published'}); await bad.run(visible);
  assert.equal(bad.calls.length,2);assert.match(bad.states.at(-1),/Could not confirm/);
});

test('Club contains contacts and one deal review inside the publication package', () => {
  const p=panel({...club,pageReviewStatus:'venue_review'});
  const publication=p.nodes.find(n=>n.props?.id==='venue-publication');
  assert.equal(nodes(publication).filter(n=>n.props?.id==='venue-club-deals').length,1);
  assert.equal(p.nodes.filter(n=>n.props?.id==='venue-club-deals').length,1);
  assert.equal(p.nodes.find(n=>n.props?.id==='venue-club-deals').props.open,true);
  const contacts=p.nodes.find(n=>n.type==='VenueContactsSection'); assert.equal(contacts.props.active,true);
  assert.equal(panel(club,[],'staff').nodes.some(n=>n.type==='VenueContactsSection'),false);
  const linked=panel(club,[],'owner','#venue-customers');
  assert.equal(linked.nodes.find(n=>n.type==='VenueContactsSection').props.active,true);
  assert.equal(linked.nodes.find(n=>n.props?.id==='venue-workspace-tonight').props.hidden,true);
});

test('review opens the private preview before club information and keeps approval after the package', () => {
 const p=panel({...club,pageReviewStatus:'venue_review'},[{id:'deal',isActive:true,dealTitle:'Free admission',dealTerms:'Adults only'}]);
 const publication=p.nodes.find(n=>n.props?.id==='venue-publication'), order=nodes(publication);
 const preview=order.find(n=>n.type==='a' && copy(n).includes('Preview customer experience'));
 assert.equal(preview.props.href,'/?city=Las%20Vegas&venue=test-club&venue_preview=1');
 assert.equal(preview.props.target,'_blank');
 assert.equal(order.filter(n=>n===preview).length,1);
 const information=order.find(n=>n.props?.className==='venue-review-package');
 const completion=order.find(n=>n.props?.className==='venue-review-completion');
 assert.ok(order.indexOf(preview)<order.indexOf(information));
 assert.ok(order.indexOf(completion)>order.indexOf(information));
 const deals=order.find(n=>typeof n.type==='function' && n.type.name==='VenueDealReadOnlyPanel');
 const dealTree=deals.type(deals.props), dealNodes=nodes(dealTree);
 assert.equal(dealNodes.find(n=>n.props?.className==='venue-contract-deal-terms').props.open,true);
 assert.equal(copy(dealNodes.find(n=>n.props?.className==='venue-contract-deal-state')),'Included');
 assert.equal(dealNodes.find(n=>n.props?.className==='venue-deal-request-center').props.hidden,true);
 assert.doesNotMatch(copy(dealTree),/live preview becomes available after/);
 assert.equal(order.find(n=>n.props?.className==='venue-review-request').props.open,undefined);
});

test('published club maintenance keeps live guest offers and normal deal management', () => {
 const p=panel({...club,isActive:true,pageReviewStatus:'published',publishedAt:'2026-10-26'},[{id:'deal',isActive:true,dealTitle:'Free admission'}]);
 const deals=p.nodes.find(n=>typeof n.type==='function' && n.type.name==='VenueDealReadOnlyPanel');
 const tree=deals.type(deals.props), all=nodes(tree);
 assert.equal(all.find(n=>n.props?.className==='venue-deal-request-center').props.hidden,false);
 assert.equal(copy(all.find(n=>n.props?.className==='venue-contract-deal-state')),'Live');
 assert.equal(all.find(n=>n.props?.className==='venue-contract-deal-terms').props.open,undefined);
 assert.match(copy(tree),/View guest offer/);
});
