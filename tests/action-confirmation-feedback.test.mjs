import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import {CUSTOMER_FOLLOW_ALERTS,customerNotificationSettings} from '../src/lib/dancr/customer-notification-preferences.ts';
const require=createRequire(import.meta.url),source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const walk=node=>Array.isArray(node)?node.flatMap(walk):React.isValidElement(node)?[node,...walk(typeof node.type==='function'?node.type(node.props):node.props.children)]:[];
const flush=()=>new Promise(done=>setImmediate(done));
function fixture(kind){
 const slots=[],effects=[],requests=[],pending=[];let cursor=0,closed=0;
 let body=source(kind==='social'?'app/dashboard/DancerDashboardPanels.tsx':'app/dashboard/CustomerDashboardPanels.tsx');
 body=kind==='social'?body.slice(body.indexOf('function socialValuesFromProfile('),body.indexOf('function checkInErrorMessage('))+'\nexports.Component=SocialLinkModal;':body.slice(body.indexOf('export function CustomerPreferencesPanel('))+'\nexports.Component=CustomerPreferencesPanel;';
 const exports={},storage=new Map(),props=kind==='social'?{platform:'instagram',profile:{id:'profile',social_links:[]},onClose:()=>closed++}:{profile:{userId:'user',notificationSettings:{},notificationDelivery:{emailAvailable:true}}};
 const request=options=>{requests.push(JSON.parse(options.body));return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
 vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require,AbortController,String,Boolean,Array,Object,JSON,Error,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),
  window:{addEventListener(){},removeEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
  readSession:()=>({accessToken:'test',account:{id:'user'}}),requestCustomerProfileJson:request,requestDancerProfileJson:request,
  customerPushDeviceEnabled:async()=>false,customerPushSupportMessage:()=>'',enableCustomerPush:async()=>{},disableCustomerPush:async()=>{},
  CUSTOMER_FOLLOW_ALERTS,customerNotificationSettings,CustomerDashboardIcon:()=>null,SocialPlatformIcon:()=>null,
  SOCIAL_PLATFORMS:[{key:'instagram',label:'Instagram',placeholder:'username'}],
 });
 function render(){cursor=0;effects.length=0;return exports.Component(props);}
 render();effects.splice(0).forEach(f=>f());
 const find=predicate=>walk(render()).find(predicate);
 return{requests,pending,find,closed:()=>closed,button:()=>find(n=>n.props.className==='dancer-social-link-save'),switch:()=>find(n=>n.props.role==='switch'&&n.props['aria-label']==='Follow alerts')};
}
test('social saves wait for confirmation, stay visible, prevent duplicates and clear on edit',async()=>{
 const f=fixture('social');f.find(n=>n.type==='input').props.onChange({target:{value:'testguest'}});
 f.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();
 assert.equal(f.button().props['aria-busy'],true);assert.equal(f.requests.length,1);
 f.pending[0].resolve({profile:{id:'profile'}});await flush();
 assert.equal(f.button().props.children,'✓ Saved');assert.equal(f.button().props.disabled,true);assert.equal(f.closed(),0);
 f.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(f.requests.length,1);
 f.find(n=>n.type==='input').props.onChange({target:{value:'changed'}});assert.equal(f.button().props.disabled,false);assert.notEqual(f.button().props.children,'✓ Saved');
 f.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});f.pending[1].reject(new Error('Try again.'));await flush();
 assert.equal(f.button().props.disabled,false);assert.ok(f.find(n=>n.props.role==='alert'));assert.notEqual(f.button().props.children,'✓ Saved');
});
test('notification switches confirm only persisted values and recover after failures',async()=>{
 const f=fixture('preferences');f.switch().props.onClick();await flush();
 assert.equal(f.switch().props['aria-busy'],true);assert.notEqual(f.switch().props['data-action-state'],'success');
 f.pending[0].resolve({profile:{notificationSettings:{followAlertsEnabled:false}}});await flush();
 assert.equal(f.switch().props['data-action-state'],'success');assert.equal(f.switch().props['aria-checked'],false);
 f.switch().props.onClick();await flush();f.pending[1].reject(new Error('Try again.'));await flush();
 assert.equal(f.switch().props['aria-checked'],false);assert.notEqual(f.switch().props['data-action-state'],'success');assert.ok(f.find(n=>n.props.role==='alert'));
});
