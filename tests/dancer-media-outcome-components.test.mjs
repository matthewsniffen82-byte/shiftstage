import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const jsx=(type,props)=>({type,props});
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join(' ');
const resultExports={};runInNewContext(compile('app/dashboard/DancerMediaReviewOutcome.tsx'),{exports:resultExports,require:name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{}});

for(const [outcome,path,section]of [['needs_main','/dashboard/dancer#dancer-main-photo','dancer-main-photo'],['needs_media','/dashboard/dancer#dancer-videos-title','dancer-profile-video-library'],['approved','/dashboard/dancer#dancer-photos-title','dancer-profile-media-library']])
 test(`dashboard ${outcome} action opens the correct editor and shows requirements only when needed`,()=>{
  let opened;const tree=resultExports.default({value:{outcome,title:'Review results',body:'Your result.',action:'Continue',emailPath:path,approvedPhotos:3,approvedVideos:0,hasApprovedMain:false},onAction:value=>opened=value});
  nodes(tree).find(n=>n.type==='button').props.onClick();assert.equal(opened,section);
  assert.equal(nodes(tree).some(n=>n.type==='ul'),outcome!=='approved');
  if(outcome!=='approved')assert.match(text(tree),/Main photo:\s+Needed.*Photos:\s+3.*Video:\s+0/s);
 });
test('missing results stay hidden and media-ready results return to remaining setup',()=>{
 assert.equal(resultExports.default({value:null}),null);
 const tree=resultExports.default({value:{outcome:'media_ready',title:'Ready',body:'Continue setup.',action:'Continue setup'}});
 assert.equal(nodes(tree).find(n=>n.type==='a').props.href,'/dashboard/dancer');
});

function chooser({fail=false,status='approved'}={}){
 const exports={},slots=[],requests=[],updates=[];let cursor=0,tree;
 runInNewContext(compile('app/dashboard/DancerChooseMainPhoto.tsx'),{exports,AbortController,Error,require:name=>{
  if(name==='react')return {useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=v];},useRef(initial){return slots[cursor++]||={current:initial};},useEffect(){}};
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  return {readSession:()=>({account:{id:'owner'}}),requestDashboardJson:async(path,init)=>{requests.push({path,body:JSON.parse(init.body)});if(fail)throw Error('Refresh before choosing another.');},requestDancerProfileJson:async()=>({profile:{id:'profile',main:'chosen'}})};
 }});
 function render(){cursor=0;tree=exports.default({photo:{id:'chosen',status},mainPhotoId:'old-main',onProfileChange:p=>updates.push(p)});return tree;}
 return {render,requests,updates,click:()=>nodes(render()).find(n=>n.type==='button').props.onClick()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('choosing approved media sends its identity without opening a crop or uploading bytes',async()=>{
 const ui=chooser();ui.click();await tick();
 assert.deepEqual(ui.requests,[{path:'/api/dancer/photos/main',body:{photoId:'chosen',mainPhotoId:'old-main'}}]);
 assert.equal(ui.updates.length,1);assert.match(text(ui.render()),/Main photo updated/);
});
test('failed main selection keeps the profile unchanged; unapproved media cannot be selected',async()=>{
 const ui=chooser({fail:true});ui.click();await tick();assert.equal(ui.updates.length,0);assert.match(text(ui.render()),/Refresh before choosing another/);
 const pending=chooser({status:'pending'});assert.equal(nodes(pending.render()).find(n=>n.type==='button').props.disabled,true);
 pending.click();await tick();assert.equal(pending.requests.length,0);
});

const photo='99000000-0000-4000-8000-000000000010';
function routeFixture({denied=false}={}){
 const exports={},calls=[];
 runInNewContext(compile('app/api/dancer/photos/main/route.ts'),{exports,console,require:name=>{
  if(name==='next/server')return{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}};
  if(name.endsWith('/request'))return{createRequestSupabaseContext:async()=>{if(denied)throw Error('Sign in');return{user:{id:'authenticated-user'},session:{}};}};
  if(name.endsWith('/bounded-json-body'))return{readBoundedJsonObject:async request=>request.body};
  if(name.endsWith('/admin'))return{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:photo,error:null};}})};
  if(name.endsWith('/nfc'))return{finalizePendingDancerNfcEnrollment:async(_,input)=>calls.push(input)};
  if(name.endsWith('/api'))return{apiError:()=>({status:401})};return{};
 }});
 return{run:body=>exports.PATCH({body}),calls};
}
test('main selection API uses authenticated ownership and invokes existing check-in validation',async()=>{
 const f=routeFixture(),response=await f.run({photoId:photo,mainPhotoId:null,userId:'someone-else'});
 assert.equal(response.status,200);assert.equal(f.calls[0].args.p_user,'authenticated-user');assert.equal(f.calls[1].dancerUserId,'authenticated-user');
});
test('main selection API rejects malformed and unauthenticated requests without a database mutation',async()=>{
 for(const [options,body,status]of [[{}, {photoId:'invalid',mainPhotoId:null},400],[{denied:true},{photoId:photo,mainPhotoId:null},401]]){
  const f=routeFixture(options);assert.equal((await f.run(body)).status,status);assert.equal(f.calls.length,0);
 }
});
