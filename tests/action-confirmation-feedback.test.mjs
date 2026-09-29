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
function fixture(){
 const slots=[],effects=[],requests=[],pending=[];let cursor=0;
 let body=source('app/dashboard/CustomerDashboardPanels.tsx');
 body=body.slice(body.indexOf('export function CustomerPreferencesPanel('))+'\nexports.Component=CustomerPreferencesPanel;';
 const exports={},storage=new Map(),props={profile:{userId:'user',notificationSettings:{},notificationDelivery:{emailAvailable:true}}};
 const request=options=>{requests.push(JSON.parse(options.body));return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
 vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require,AbortController,String,Boolean,Array,Object,JSON,Error,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),
  window:{addEventListener(){},removeEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
  readSession:()=>({accessToken:'test',account:{id:'user'}}),requestCustomerProfileJson:request,
  customerPushDeviceEnabled:async()=>false,customerPushSupportMessage:()=>'',enableCustomerPush:async()=>{},disableCustomerPush:async()=>{},
  CUSTOMER_FOLLOW_ALERTS,customerNotificationSettings,CustomerDashboardIcon:()=>null,
 });
 function render(){cursor=0;effects.length=0;return exports.Component(props);}
 render();effects.splice(0).forEach(f=>f());
 const find=predicate=>walk(render()).find(predicate);
 return{requests,pending,find,switch:()=>find(n=>n.props.role==='switch'&&n.props['aria-label']==='Follow alerts')};
}
test('notification switches confirm only persisted values and recover after failures',async()=>{
 const f=fixture();f.switch().props.onClick();await flush();
 assert.equal(f.switch().props['aria-busy'],true);assert.notEqual(f.switch().props['data-action-state'],'success');
 f.pending[0].resolve({profile:{notificationSettings:{followAlertsEnabled:false}}});await flush();
 assert.equal(f.switch().props['data-action-state'],'success');assert.equal(f.switch().props['aria-checked'],false);
 f.switch().props.onClick();await flush();f.pending[1].reject(new Error('Try again.'));await flush();
 assert.equal(f.switch().props['aria-checked'],false);assert.notEqual(f.switch().props['data-action-state'],'success');assert.ok(f.find(n=>n.props.role==='alert'));
});
