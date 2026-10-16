import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerAvatarPanel.tsx','utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} }).outputText;
const main = {id:'main',status:'approved',isPrimary:true,storagePath:'owned/main.jpg'};
function fixture({empty=false,cancel=false,refreshFails=false,saveFails=false,prepare}={}) {
  let profile = {id:'profile',avatar_updated_at:'version-1',avatarPhotoUrl:empty?'':'avatar.jpg',photos:empty?[]:[main]}, account='owner', tree, cursor=0, dirty=true;
  const slots=[], effects=[], requests=[], exports={};
  const jsx=(type,props)=>({type,props});
  const window=new EventTarget();
  const hooks={
    useRef(initial){return slots[cursor++] ||= {current:initial};}, useContext(){return ()=>{};},
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,n)=>!Object.is(value,old.deps[n]))){effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}},
  };
  vm.runInNewContext(code,{exports,Error,AbortController,DOMException,FormData,File,atob,Uint8Array,window,
    require(name){
      if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
      if(name==='./DashboardShared')return {AvatarUploadBusyContext:{}};
      if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p.photos||[]};
      if(name==='./profile-photo-crop')return {cropProfilePhoto:async(_file,_signal,assertOwner,ratio,_preview,onCrop)=>{assert.equal(ratio,1);assertOwner();if(!cancel)onCrop({x:0,y:.125,width:1,height:.75});}};
      if(name==='./dashboard-session')return {
        DASHBOARD_SESSION_KEY:'session',readSession:()=>({account:{id:account,role:'dancer'}}),
        requestDashboardJson:async(url,options)=>{requests.push({url,options});if(url.endsWith('/preview'))return prepare?prepare():{imageDataUrl:'data:image/jpeg;base64,aW1hZ2U='};if(saveFails)throw Error('Your main photo changed. Refresh.');return {saved:true};},
        requestDancerProfileJson:async()=>{if(refreshFails)throw Error('offline');return {profile:{...profile,avatarPhotoUrl:'new-crop.jpg',avatar_updated_at:'version-2'}};},
      };
      throw Error(name);
    },
  });
  function render(){do{dirty=false;cursor=0;tree=exports.DancerAvatarPanel({profile,onProfileChange:p=>{profile=p;dirty=true;}});effects.splice(0).forEach(fn=>fn());}while(dirty);}
  const nodes=(n=tree)=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).filter(Boolean).flatMap(child=>nodes(child))];
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));render();};
  render();return {nodes,requests,settle,click(){nodes().find(n=>n.type==='button').props.onClick();render();},changeAccount(){account='other';},unmount(){slots.forEach(s=>s?.cleanup?.());},
    get image(){return nodes().find(n=>n.type==='img')?.props.src;},get status(){return nodes().find(n=>n.props?.role==='status')?.props.children;},get busy(){return tree.props['aria-busy'];}};
}
test('avatar setup has no separate file input and waits for an approved main',()=>{const ui=fixture({empty:true});assert.equal(ui.nodes().some(n=>n.type==='input'),false);assert.equal(ui.nodes().find(n=>n.type==='button').props.disabled,true);assert.equal(ui.image,undefined);});
test('adjust crop submits only source identity, version and coordinates, then displays saved avatar',async()=>{const ui=fixture();ui.click();await ui.settle();const post=ui.requests.find(r=>r.url.endsWith('/crop'));assert.deepEqual(JSON.parse(post.options.body),{photoId:'main',sourcePath:'owned/main.jpg',expectedAvatarUpdatedAt:'version-1',crop:{x:0,y:.125,width:1,height:.75}});assert.equal(ui.image,'new-crop.jpg');assert.equal(ui.busy,false);});
test('canceling the crop leaves the avatar unchanged and writes nothing',async()=>{const ui=fixture({cancel:true});ui.click();await ui.settle();assert.equal(ui.requests.length,1);assert.equal(ui.image,'avatar.jpg');assert.match(ui.status,/canceled/);});
test('acknowledged save survives refresh failure without another upload',async()=>{const ui=fixture({refreshFails:true});ui.click();await ui.settle();assert.match(ui.status,/crop saved.*Reload/);assert.equal(ui.requests.length,2);});
test('failed or stale saves keep the current avatar and explain the error',async()=>{const ui=fixture({saveFails:true});ui.click();await ui.settle();assert.equal(ui.image,'avatar.jpg');assert.match(ui.status,/changed/);assert.equal(ui.busy,false);});
for(const action of ['changeAccount','unmount'])test('duplicate clicks and '+action+' cannot submit a stale crop',async()=>{let resolve;const ui=fixture({prepare:()=>new Promise(r=>{resolve=r;})});ui.click();ui.click();assert.equal(ui.requests.length,1);ui[action]();resolve({imageDataUrl:'data:image/jpeg;base64,aW1hZ2U='});await ui.settle();assert.equal(ui.requests.length,1);});
