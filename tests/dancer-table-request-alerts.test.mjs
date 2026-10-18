import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as serverJob from '../src/lib/server-job.ts';

const compile = path => ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'), {
  compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS },
}).outputText;
function fixture({ email=true,push=true,failPush=false,receipt=true,deadline }={}) {
  const calls=[],deliveries=[],service={}; let claimed=false;
  vm.runInNewContext(compile('src/lib/dancr/dancer-table-request-alerts.ts'), {
    exports:service, performance, console:{warn(){}}, process:{env:email?{RESEND_API_KEY:'synthetic',EMAIL_FROM:'synthetic@example.invalid'}:{}},
    require:name=>({
      'server-only':{}, '../server-job':serverJob,
      './customer-notification-delivery':{notificationPushDelivery:()=>({pushAvailable:push})},
      './notification-delivery':{deliverNotificationRows:async(_client,rows,options)=>{
        deliveries.push({rows,options}); if(failPush&&options.push) throw Error('push failed');
        return {email:Number(options.email),push:Number(options.push)};
      }},
    }[name]),
  });
  const client={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='claim_dancer_table_request_alerts') {
      const jobs=claimed?[]:args.p_channels.map(channel=>({id:channel+'-job',lease_id:'lease',recipient_id:'dancer-user',channel,table_label:'Table 12',venue_name:'Echo House'}));
      claimed=true; return {data:jobs,error:null};
    }
    return {data:receipt,error:null};
  }};
  return {calls,deliveries,run:()=>service.deliverDancerTableRequestAlerts(client,'request-id',{deadline})};
}
test('email works without push and includes the requested dancer, table number and club',async()=>{
  const f=fixture({push:false}); assert.equal((await f.run()).sent,1);
  const {rows,options}=f.deliveries[0]; assert.equal(options.email,true); assert.equal(options.push,false);
  assert.equal(rows[0].recipient_id,'dancer-user'); assert.equal(rows[0].deliveryId,'email-job');
  assert.match(rows[0].body,/Table 12 at Echo House requested you/); assert.equal(rows[0].payload.kind,'dancer_table_request');
});
test('push failure retries only push and acknowledges the successful email',async()=>{
  const f=fixture({failPush:true}),counts=await f.run(); assert.equal(counts.sent,1); assert.equal(counts.retry,1);
  const receipts=f.calls.filter(call=>call.name==='finish_dancer_table_request_alert');
  assert.equal(receipts.find(call=>call.args.p_id==='email-job').args.p_outcome,'sent');
  assert.equal(receipts.find(call=>call.args.p_id==='push-job').args.p_outcome,'retry');
});
for(const options of [{email:false,push:false},{deadline:performance.now()+1000}])test('unavailable channels or short budget leave jobs unclaimed',async()=>{
  const f=fixture(options); await f.run(); assert.equal(f.calls.length,0);
});
test('receipt failure settles every claimed channel then reports failure',async()=>{
  const f=fixture({receipt:false}); await assert.rejects(f.run(),/acknowledgement/);
  assert.equal(f.calls.filter(call=>call.name==='finish_dancer_table_request_alert').length,2);
});
test('staff failure does not block dancer delivery, and the shared worker reports failure for retry',async()=>{
  const service={},calls=[];
  vm.runInNewContext(compile('src/lib/dancr/internal-request-alerts.ts'),{exports:service,require:name=>({
    'server-only':{},
    './internal-request-push':{deliverInternalRequestPush:async()=>{calls.push('staff');throw Error('staff failure');}},
    './dancer-table-request-alerts':{deliverDancerTableRequestAlerts:async()=>{await Promise.resolve();calls.push('dancer');return {configured:true,sent:1,skipped:0,retry:0};}},
  }[name])});
  await assert.rejects(service.deliverInternalRequestAlerts({}),/staff failure/);
  assert.deepEqual(calls,['staff','dancer']);
});
