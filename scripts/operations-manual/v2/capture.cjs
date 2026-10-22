/* Documentation artwork only: isolated server-rendered application components.
 * No app server, login, browser journey, API call, event handler or E2E test.
 * Network is blocked. Each screenshot records source hashes and button bounds.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const repoRequire = createRequire(path.join(root, 'package.json'));
const ts = repoRequire('typescript');
const React = repoRequire('react');
const { renderToStaticMarkup } = repoRequire('react-dom/server');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const out = path.join(__dirname, 'screenshots');
fs.mkdirSync(out, { recursive: true });
const noop = () => {};
const now = '2026-10-22T03:00:00.000Z';
const club = { id: 'training-club', name: 'Training Club', slug: 'training-club', city: 'Las Vegas', state: 'NV', isActive: true };
const person = { id: 'training-dancer', stageName: 'Sample Dancer', slug: 'sample-dancer', city: 'Las Vegas' };
const guest = { id: 'training-guest', name: 'Sample Guest', phone: '+12025550100', email: 'guest@example.com', status: 'generated', arrivalMethod: 'self', createdAt: now, expiresAt: '2026-10-23T10:00:00Z' };
const access = { role: 'owner', permissions: ['view_dashboard','view_analytics','view_nfc','view_roster','view_deals','view_finance','view_team','manage_profile','manage_roster','manage_team','request_deals','request_nfc_support'] };
const preview = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#273044"/><text x="300" y="185" text-anchor="middle" fill="white" font-family="sans-serif" font-size="32">Training upload</text><text x="300" y="228" text-anchor="middle" fill="#cbd5e1" font-family="sans-serif" font-size="18">Sample media for the operations manual</text></svg>').toString('base64');
let fixtures = {}, moduleCache, indices, sources, extraExports;
function load(file) {
  file = path.resolve(file);
  if (!fs.existsSync(file)) file = ['.tsx','.ts','.js','.mjs'].map(ext => file+ext).find(fs.existsSync) || file;
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  if (file.endsWith('.css')) return {};
  const rel = path.relative(root, file).replaceAll('\\','/');
  const source = fs.readFileSync(file, 'utf8');
  sources[rel] = crypto.createHash('sha256').update(source).digest('hex');
  const module = { exports: {} }; moduleCache.set(file, module);
  const react = { ...React,
    useState(initial) { const i = indices[rel] || 0; indices[rel] = i + 1; return [fixtures[rel] && Object.hasOwn(fixtures[rel], i) ? fixtures[rel][i] : typeof initial === 'function' ? initial() : initial, noop]; },
    useEffect: noop, useLayoutEffect: noop, useRef: value => ({ current:value }), useCallback: fn=>fn, useMemo: fn=>fn(),
  };
  function requireLocal(name) {
    if (name === 'react') return react;
    if (name.startsWith('react')) return repoRequire(name);
    if (name === 'next/link') return { __esModule:true, default: ({children,prefetch,...props})=>React.createElement('a',props,children) };
    if (name === 'next/image') return { __esModule:true, default: ({fill,priority,unoptimized,...props})=>React.createElement('img',props) };
    if (name === 'next/dynamic') return { __esModule:true, default: fn => { const match = fn.toString().match(/(?:require|import)\(["']([^"']+)/); return match ? requireLocal(match[1]).default : ()=>null; } };
    if (name === 'next/navigation') return {useRouter:()=>({push:noop,replace:noop}),usePathname:()=>'/dashboard',useSearchParams:()=>new URLSearchParams()};
    if (/dashboard-session|admin-session|pickup-session/.test(name)) return new Proxy({ DashboardDataRequestError: Error, readSession:()=>({account:{id:'training-account',role:'venue'}}) },{get:(o,k)=>o[k] || (()=>{throw Error('Network/action forbidden in documentation capture: '+String(k));})});
    if (name === 'server-only') return {};
    if (name.endsWith('.css')) return {};
    if (name.startsWith('@/')) return load(path.join(root,name.slice(2)));
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file),name));
    return repoRequire(name);
  }
  const exposed = extraExports?.[rel] || [];
  const code = ts.transpileModule(source + exposed.map(n=>`\nexport { ${n} };`).join(''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:requireLocal,console,URL,URLSearchParams,AbortController,DOMException,TextEncoder,TextDecoder,Buffer,process:{env:{}},setTimeout:()=>0,clearTimeout:noop,fetch:()=>{throw Error('Network forbidden');}}, {filename:file});
  return module.exports;
}
const D='app/dashboard/', A='app/admin/';
const shots = [];
function add(id, file, exp, props, states, targets, options={}) {shots.push({id,file,exp,props,states,targets,...options});}
add('team', D+'VenueTeamPanel.tsx','default',{initialAccess:access}, {1:[{id:'member',role:'manager',status:'active',displayName:'Sample Manager',email:'manager@example.com'}],6:'',7:false}, ['text=Invite team member','select[aria-label="Access level for Sample Manager"]','text=Remove']);
add('website',D+'VenueWebsiteGrid.tsx','default',{slug:club.slug},{},['text=Preview website grid','text=Copy preview link','text=Copy embed code']);
add('guest-list',D+'VenueGuestListPanel.tsx','default',{active:true,timezone:'America/Los_Angeles'},{0:[guest],3:true,5:{all:1,generated:1,redeemed:0},6:now},['select[aria-label="Guest-list date"]','input[type="search"]','button:has-text("Search")','button:has-text("Awaiting admission")']);
add('contacts',D+'VenueCustomersPanel.tsx','default',{active:true,refreshKey:now},{3:[{...guest,is_guest:true,is_follower:false}],5:true},['button:has-text("Email updates")','button:has-text("Text updates")','summary']);
add('rides',D+'PickupDashboardPanel.tsx','default',{venueId:club.id,active:true},{0:[{...guest,venue_id:club.id,staff_status:'received',requested_at:now,created_at:now,passenger_count:2,pickup_location:'Sample hotel lobby'}],2:true},['select','text=Call guest','select[aria-label="Ride status for Sample Guest"]']);
const vipState={requests:[],members:[],invitations:[],requestCount:0,memberCount:0};
add('vip-invite',D+'VenueVipPanel.tsx','default',{active:true},{0:vipState,1:'invitations',2:true},['input[type="email"]','button:has-text("Send invitation")','button:has-text("VIP guests")']);
add('vip-requests',D+'VenueVipPanel.tsx','default',{active:true},{0:{...vipState,requests:[{id:'request',status:'pending',created_at:now,updated_at:now,starts_at:now,timezone:'America/Los_Angeles',party_size:2,guest_name:'Sample Guest',dancers:[],notes:'Sample visit request'}],requestCount:1}},['summary','button:has-text("Confirm request")','button:has-text("Decline")']);
add('media-approval',D+'VenueMediaReviewPanel.tsx','default',{venueId:club.id,active:true,onCountChange:noop},{0:[{id:'upload',kind:'photo',stageName:'Sample Dancer',version:'training',previewUrl:preview,label:'Main photo',processing:false,canApprove:true,aiSummary:'Ready for club review',reasons:['manual_review_requested']}],1:1},['summary','textarea','button:has-text("Approve")','button:has-text("Reject")'],{width:760});
add('club-removal',D+'VenueParticipationPanel.tsx','default',{venueId:club.id,venueName:club.name,onEnded:noop},{1:true,4:true},['button:has-text("Keep club on MyDancr")','button:has-text("Confirm club removal")']);
add('table-qr',A+'AdminTableQrCodes.tsx','default',{venueId:club.id,name:club.name},{0:true,2:[{id:'table',label:'Table 1',active:true,url:'https://www.mydancr.com/internal/sign/training-example',createdAt:now}],5:'Table 2'},['button:has-text("Number range")','button:has-text("Create QR code")','button:has-text("Print QR sign")','button:has-text("Disable")'],{admin:true,openDetails:true});
add('main-photo',D+'DancerMainPhotoPanel.tsx','DancerMainPhotoPanel',{profile:person,onProfileChange:noop},{},['button[aria-label="Add main photo"]'],{dancer:true});
add('photo-upload',D+'DancerPhotoPanel.tsx','DancerPhotoPanel',{profile:person,onProfileChange:noop,uploadOnly:true},{},['button'],{dancer:true});
add('agreement',D+'DancerProfileAgreementReview.tsx','default',{profileId:person.id,busy:false,onSubmit:noop,submitLabel:'Submit profile'},{0:{accepted:false,version:'training'},1:true},['input[type="checkbox"]','a','button'],{dancer:true});
add('verify-age',D+'DancerAgeVerificationGate.tsx','default',{profileSubmitted:true},{0:{required:true,configured:true,status:'not_started'},2:true},['input[type="checkbox"]','button:has-text("Verify age")','button:has-text("Check verification status")'],{dancer:true});
add('nfc-activation',D+'DancerNfcPanel.tsx','default',{onboarding:true,initialNfcState:{enrollment:{status:'pending',venue:club},profileAuthorization:{authorized:false}}},{},['button','summary'],{dancer:true});
add('venue-access',D+'DancerNfcPanel.tsx','default',{compactAuthorized:true,initialAffiliations:[{id:'affiliation',status:'active',venue:club}],initialNfcState:{profileAuthorization:{authorized:true,isPublic:true,visibility:'both'}}},{},['button:has-text("Remove")','button[aria-label="Refresh check-in access"]'],{dancer:true,openDetails:true});
add('working-now',D+'DancerShiftManager.tsx','default',{}, {0:[{id:'shift',status:'checked_in',location_status:'club_confirmed',checked_in_at:'2026-10-22T02:00:00Z',location_verification_expires_at:'2026-10-22T08:00:00Z',visibility_mode:'both',venues:club}],1:true,8:Date.parse(now)},['button:has-text("End Working Now")'],{dancer:true,openDetails:true});
add('tv-launch',D+'VenueTvPanel.tsx','default',{city:club.city,venueId:club.id},{0:[{id:'video'}],2:false},['a']);
add('subscriptions',A+'AdminVenueSubscriptions.tsx','default',{venues:[{...club,subscription_status:'active',subscriptionStatus:'active'}]},{},['input'],{admin:true});
add('tonight',D+'VenueTonightOverview.tsx','default',{operations:{vipPending:1,tablePending:2,guestExpected:1,admitted:4,ridesOpen:1},error:'',working:3,manager:true,published:true,reviewReady:false,onOpen:noop},{},['a[href="#venue-working-now"]','a[href="#table-requests"]','a[href="#venue-guest-list"]','a[href="#venue-vip"]','a[href="#venue-pickups"]']);
add('deals',D+'VenueDashboardPanels.tsx','VenueDealReadOnlyPanel',{deals:[{id:'deal',dealTitle:'Sample admission offer',dealDescription:'Training offer only',dealTerms:'Review current club terms before admitting a guest.',isActive:true}],dealRequests:[],isVenuePublished:true,venueCity:club.city,venueSlug:club.slug,canRequestDeals:true,onDealRequestsChange:noop},{},['button:has-text("Request a new deal")','button:has-text("Request deal removal")','summary:has-text("Guest terms")'],{extraExports:{[D+'VenueDashboardPanels.tsx']:['VenueDealReadOnlyPanel']}});
add('deal-request',D+'VenueDashboardPanels.tsx','VenueDealReadOnlyPanel',{deals:[],dealRequests:[],isVenuePublished:true,venueCity:club.city,venueSlug:club.slug,canRequestDeals:true,onDealRequestsChange:noop},{0:true},['select','textarea','button:has-text("Send request to MyDancr")'],{extraExports:{[D+'VenueDashboardPanels.tsx']:['VenueDealReadOnlyPanel']}});
add('identity',D+'DancerDashboardPanels.tsx','DancerSetupPanel',{profile:person,onProfileChange:noop},{0:person.stageName,1:club.city,2:[{value:club.city,label:club.city}],3:'ready'},['input','select','button[type="submit"]'],{dancer:true,extraExports:{[D+'DancerDashboardPanels.tsx']:['DancerSetupPanel']}});
add('visibility',D+'DancerDashboardPanels.tsx','DancerVisibilityPanel',{profile:{...person,isPublic:true,is_public:true,status:'approved'},onProfileChange:noop},{0:true},['button'],{dancer:true,extraExports:{[D+'DancerDashboardPanels.tsx']:['DancerVisibilityPanel']}});
add('share',D+'DancerDashboardPanels.tsx','DancerSharePanel',{profile:{...person,isPublic:true,status:'approved'}},{0:'https://www.mydancr.com/dancers/sample-dancer'},['button'],{dancer:true,extraExports:{[D+'DancerDashboardPanels.tsx']:['DancerSharePanel']}});
add('video-upload',D+'DancerTvStudio.tsx','default',{embedded:true,uploadOnly:true},{0:{profile:person,profileEligible:true,profileVisible:true,maxVideos:50,remainingVideoSlots:50,videos:[]},6:false},['input[type="checkbox"]','button[aria-label="Choose profile videos from your library"]','button[aria-label="Record a new profile video"]'],{dancer:true,openDetails:true});
add('dancer-notifications',D+'DancerNotificationSettings.tsx','default',{}, {0:{activityAlertsEnabled:true,followers:true,profileLikes:true,photoLikes:true,videoLikes:true,shares:true}},['button[role="switch"]'],{dancer:true});
add('club-notifications',D+'VenueNotificationSettings.tsx','default',{}, {0:{alertsEnabled:true,vipRequests:true,tableRequests:true,dancerActivity:true,rosterChanges:true,clubDeals:true,pickupRequests:true,teamAccess:true,pageAndMedia:true,supportReplies:true,performance:true,emailEnabled:true,pushEnabled:true}},['button[role="switch"]']);
add('support',D+'DashboardShared.tsx','SupportInboxPanel',{initialThreads:[]},{},['input','textarea','button[type="submit"]']);
add('account',D+'DashboardShared.tsx','AccountControlsPanel',{accountRole:'dancer',accountState:'active'},{},['button'],{dancer:true});
add('table-requests','app/internal/InternalRoster.tsx','InternalRoster',{operationsOnly:true},{0:{venueName:club.name,role:'owner',dancers:[],links:[{id:'table',label:'Table 1'}],requests:[{id:'request',link_id:'table',dancer_id:person.id,dancerName:person.stageName,status:'pending',created_at:now}]}},['button:has-text("Mark seen")','button:has-text("Dismiss")'],{openDetails:true,capture:'.venue-card-popover'});
add('results',D+'VenueValueAnalytics.tsx','default',{report:{interactions:[],trackingStartedAt:'2026-10-01T00:00:00Z',automatic:{current:{admissions:4,claims:8,vipRequests:1,tableRequests:2,dancersCheckedIn:3},previous:{}}},period:'tonight',periodStart:now,periodEnd:'2026-10-22T09:00:00Z',timezone:'America/Los_Angeles',totalFollowers:12,conversion:50},{},['summary:has-text("Roster activity")','summary:has-text("Guest list")','summary:has-text("Dancer contribution")']);
const venueProps={account:{id:'training-account',role:'venue'},profile:{...club,isActive:false,pageReviewStatus:'venue_review',phone:'202-555-0100',website:'https://example.com',address:'Training address',opensAt:'18:00',closesAt:'04:00'},venueDeals:[{id:'deal',dealTitle:'Sample admission offer',isActive:true}],dealRequests:[],workingNow:[],initialAffiliations:[],venueAccess:access,refreshedAt:now,supportThreads:[],analyticsPeriod:'tonight',isRefreshing:false,refreshStatus:'',onAnalyticsPeriodChange:noop,onRefresh:noop,onAccessRemoved:noop,onProfileChange:noop,onPublicationChange:noop,onDealRequestsChange:noop};
add('club-navigation',D+'VenueDashboardPanels.tsx','VenuePanel',venueProps,{},['#venue-workspace-tonight-tab','#venue-workspace-roster-tab','#venue-workspace-business-tab','#venue-workspace-venue-tab'],{capture:'.venue-workspace-toolbar'});
add('publication',D+'VenueDashboardPanels.tsx','VenuePanel',venueProps,{},['textarea','button:has-text("Request changes")','a:has-text("Preview customer experience")','button:has-text("Approve & make live")'],{capture:'#venue-publication'});
add('roster',D+'VenueNfcTagPanel.tsx','default',{initialAffiliations:[{id:'affiliation',status:'active',dancerId:person.id,dancer:person}],workingNow:[],timeZone:'America/Los_Angeles',workingOnly:false,onWorkingOnlyChange:noop,canManageRoster:true,canRequestSupport:true},{3:false},['input[type="search"]','button:has-text("Working now")','button:has-text("External")'],{openDetails:true,capture:'.venue-nfc-roster'});
add('stickers',D+'VenueNfcTagPanel.tsx','default',{timeZone:'America/Los_Angeles',workingOnly:false,onWorkingOnlyChange:noop,canManageRoster:true,canRequestSupport:true},{0:[{id:'tag',label:'Dressing room',status:'active',type:'dressing_room',tapCount:5,scanCount:0,createdAt:now}],3:false},['button:has-text("Test")','button:has-text("Support")'],{openDetails:true,capture:'.venue-roster-stickers'});
// Focused crops retain the application's exact controls at a printable size.
shots.find(s=>s.id==='publication').cropFrom=['.venue-review-request','.venue-review-completion'];
shots.find(s=>s.id==='publication').pdfCrop=true;
shots.find(s=>s.id==='roster').cropFrom=['.venue-roster-search','.venue-roster-sort','.venue-roster-filters'];
shots.find(s=>s.id==='media-approval').cropFrom=['.venue-media-review-grid h3','.venue-media-review-grid strong','.venue-media-review-grid details','.venue-media-review-grid label','.venue-media-review-actions'];
shots.find(s=>s.id==='video-upload').cropFrom=['.tv-upload-permissions','.tv-check','.tv-video-source-grid'];
shots.find(s=>s.id==='club-notifications').capture='.venue-preference-row';
shots.find(s=>s.id==='club-notifications').captureNth=0;
shots.find(s=>s.id==='results').props.report.videos=[];
Object.assign(shots.find(s=>s.id==='results').props.report.automatic.current,{dancerCheckoutDays:2,checkoutEligibleDays:2,cohortAdmissions:4});
Object.assign(shots.find(s=>s.id==='results').props.report.automatic,{liveRoster:{total:3,internal:1,external:1,both:1,unknown:0},liveAsOf:now});
shots.find(s=>s.id==='results').capture='.venue-auto-categories';
const team=shots.find(s=>s.id==='team');
add('team-invite',team.file,team.exp,team.props,team.states,['input[type="email"]','form select','button:has-text("Invite team member")'],{capture:'.venue-team-invite-form'});
team.cropFrom=['.venue-team-heading','.venue-team-list[aria-label="Active venue team"]'];
team.targets=['select[aria-label="Access level for Sample Manager"]','button:has-text("Remove")'];
team.capture='.venue-team-list[aria-label="Active venue team"]';delete team.cropFrom;
add('dancer-results',D+'DancerAnalyticsPanel.tsx','DancerAnalyticsPanel',{}, {},['button:has-text("Tonight")','button:has-text("7 days")','select'],{dancer:true,capture:'.dancer-analytics-toolbar'});
shots.find(s=>s.id==='rides').cropFrom=['.venue-ride-filter','.venue-ride-actions'];
shots.find(s=>s.id==='vip-invite').cropFrom=['.venue-vip-tabs','.vip-invite-form'];
shots.find(s=>s.id==='vip-requests').capture='.vip-review';
shots.find(s=>s.id==='verify-age').cropFrom=['.dancer-age-consent','.dancer-age-actions'];
shots.find(s=>s.id==='dancer-notifications').capture='.dancer-preference-master';
shots.find(s=>s.id==='support').capture='.support-panel form';
shots.find(s=>s.id==='subscriptions').capture='.subscription-roster';
shots.find(s=>s.id==='club-notifications').wrapper='<div id="venue-workspace-venue"><div id="venue-account">';
shots.find(s=>s.id==='dancer-notifications').wrapper='<div id="dancer-destination-account"><div id="dancer-account">';
for (const id of ['team','team-invite']) shots.find(s=>s.id===id).wrapper='<div id="venue-workspace-venue"><div id="venue-team">';
const photoReview=shots.find(s=>s.id==='media-approval');
shots.push({...photoReview,id:'video-approval',states:{...photoReview.states,0:[{...photoReview.states[0][0],kind:'video',label:'Profile video'}]}});

async function main() {
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const result=[];
 try {
  for (const shot of shots) {
   if (process.argv[2] && !process.argv.slice(2).includes(shot.id)) continue;
   moduleCache=new Map();indices={};sources={};extraExports=shot.extraExports;
   fixtures={ [shot.file]:shot.states,...shot.fixtures };
   try {
    const component=load(path.join(root,shot.file))[shot.exp];
    const styleComponent=load(path.join(root,D+'DashboardStyles.tsx')).DashboardStyles;
    let markup=renderToStaticMarkup(React.createElement(component,shot.props));
    if (shot.wrapper) markup=shot.wrapper+markup+'</div></div>';
    const styles=renderToStaticMarkup(React.createElement(styleComponent));
    if(shot.openDetails) markup=markup.replace(/<details(?![^>]*\bopen(?:[\s=>]))/g,'<details open');
    const cssFiles = [...fs.readdirSync(path.join(root,D)).filter(f=>f.endsWith('.css') && f !== 'saved-venue-cards.generated.css').map(f=>D+f), 'app/vip/vip.css',...fs.readdirSync(path.join(root,A)).filter(f=>f.endsWith('.css')).map(f=>A+f),...fs.readdirSync(path.join(root,'public')).filter(f=>/^(dancr-design|profile|dancer-profile)/.test(f)&&f.endsWith('.css')).map(f=>'public/'+f)];
    function readCss(file) { const value=fs.readFileSync(path.join(root,file),'utf8'); sources[file]=crypto.createHash('sha256').update(value).digest('hex'); return value; }
    let css=cssFiles.map(readCss).join('\n');
    const globalCss=[...fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8').matchAll(/import "(\.\.\/public\/[^\"]+\.css)"/g)].map(m=>readCss(path.relative(root,path.resolve(root,'app',m[1])).replaceAll('\\','/'))).join('\n');
    const page=await browser.newPage({viewport:{width:shot.width||1040,height:850},deviceScaleFactor:1.5});
    page.setDefaultTimeout(5000);
    await page.route('**/*',route=>route.abort());
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${globalCss}</style>${styles}<style>${css}</style><style>*{box-sizing:border-box}#capture{width:100%;max-width:920px;margin:0}#capture>main{padding:24px;min-height:0;height:auto;margin:0}.training-label{color:#b9aadd;font:12px system-ui;margin:0 0 16px;letter-spacing:.08em}</style></head><body class="dancr-button-system"><div id="capture"><main id="${shot.admin?'admin-dashboard':shot.dancer?'dancer-dashboard':'venue-dashboard'}" class="dashboard-shell dashboard-shell-${shot.dancer?'dancer':'venue'} ${shot.admin?'admin-shell':''}"><div class="training-label">MYDANCR · CURRENT APP COMPONENT · TRAINING DATA</div><div class="dashboard-grid ${shot.dancer?'dancer-dashboard-grid':'venue-dashboard-grid'}">${markup}</div></main></div></body></html>`,{waitUntil:'load'});
    const capture=page.locator(shot.capture||'#capture').nth(shot.captureNth||0);
    let box=await capture.boundingBox();
    const originalBox={...box};
    if(shot.cropFrom){
      const boxes=await page.locator(shot.cropFrom.join(',')).evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
      const x=Math.min(...boxes.map(b=>b.x))-8,y=Math.min(...boxes.map(b=>b.y))-8;
      box={x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x+8,height:Math.max(...boxes.map(b=>b.y+b.height))-y+8};
    }
    const targets=[];
    for(const [i,selector] of shot.targets.entries()){
      const loc=page.locator(selector).filter({visible:true});
      const count=await loc.count();
      if(!count) throw Error('Missing arrow target '+selector);
      const b=await loc.first().boundingBox();
      const isSummary=await loc.first().evaluate(el=>el.tagName==='SUMMARY');
      const targetX=b.x+(isSummary?Math.min(100,b.width/3):b.width/2);
      targets.push({n:i+1,selector,label:await loc.first().innerText().catch(()=>''),x:(targetX-box.x)/box.width,y:(b.y+b.height/2-box.y)/box.height});
    }
    if(shot.pdfCrop) await capture.screenshot({path:path.join(out,shot.id+'.png')});
    else if(shot.cropFrom) await page.screenshot({path:path.join(out,shot.id+'.png'),clip:box,captureBeyondViewport:true});
    else await capture.screenshot({path:path.join(out,shot.id+'.png')});
    result.push({id:shot.id,file:shot.file,export:shot.exp,width:box.width,height:box.height,pdfCrop:shot.pdfCrop?{x:(box.x-originalBox.x)/originalBox.width,y:(box.y-originalBox.y)/originalBox.height,width:box.width/originalBox.width,height:box.height/originalBox.height}:null,targets,sources,provenance:'Current source components rendered in isolation with fictional training data. No live session, API calls, or browser journeys.',captured:'2026-10-21'});
    console.log(shot.id,Math.round(box.width),Math.round(box.height));
    await page.close();
   }catch(e){console.error('FAILED',shot.id,e.stack);process.exitCode=1;}
  }
 }finally{await browser.close();}
 const manifest=path.join(out,'manifest.json');
 const previous=process.argv[2]&&fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest)):[];
 fs.writeFileSync(manifest,JSON.stringify([...previous.filter(v=>!result.some(r=>r.id===v.id)),...result],null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
