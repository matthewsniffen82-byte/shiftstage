import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import {createPayoutDispatchDatabase,seedPayoutDispatchDatabase,payoutSnapshot,payoutId} from './helpers/payout-dispatch-database.mjs';
let pg;
before(async()=>{pg=await createPayoutDispatchDatabase();});
beforeEach(async()=>seedPayoutDispatchDatabase(pg));
after(async()=>pg?.close());
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
function module(path,dependencies){const exports={};vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Date,console:{warn(){},error(){}},require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected dependency '+name);}});return exports;}
function harness(options={}){
 const calls=[],transfers=[];let releasePending=0,accounts=0;
 const client={
  from(table){assert.equal(table,'dancer_payout_batches');const filters=[];let limit=250;
   const q={select(){return q;},eq(k,v){filters.push([k,[v]]);return q;},in(k,v){filters.push([k,Array.from(v)]);return q;},order(){return q;},limit(n){limit=n;return q;},
    async then(resolve,reject){try{calls.push({kind:'read',filters});if(options.readError)return resolve({data:null,error:{code:'08006'}});if(Object.hasOwn(options,'readData'))return resolve({data:options.readData,error:null});
     const rows=(await pg.query('select * from public.dancer_payout_batches order by requested_at,id')).rows.filter(r=>filters.every(([k,v])=>v.includes(r[k]))).slice(0,limit);return resolve({data:rows,error:null});}catch(e){return reject(e);}}
   };return q;
  },
  async rpc(name,args){calls.push({kind:'rpc',name,args});
   const phase=name==='claim_dancer_payout_dispatch'?'claim':name==='mark_dancer_payout_processing'?(String(args.p_provider_reference_id).startsWith('mydancr-payout-')?'claim':'confirm'):name==='flag_dancer_payout_dispatch_review'?'review':'release';
   if(options[phase+'Throw'])throw new Error('Synthetic '+phase+' transport failure');
   if(options[phase+'Error'])return {data:null,error:{code:'08006',message:'Synthetic '+phase+' failure'}};
   if(Object.hasOwn(options,phase+'Data'))return {data:options[phase+'Data'],error:null};
   try{
    let result;
    if(name==='claim_dancer_payout_dispatch')result=await pg.query('select public.claim_dancer_payout_dispatch($1) receipt',[args.p_payout_id]);
    else if(name==='mark_dancer_payout_processing')result=await pg.query('select public.mark_dancer_payout_processing($1,$2) receipt',[args.p_payout_id,args.p_provider_reference_id]);
    else if(name==='flag_dancer_payout_dispatch_review')result=await pg.query('select public.flag_dancer_payout_dispatch_review($1,$2) receipt',[args.p_payout_id,args.p_failure_message]);
    else if(name==='release_dancer_payout_batch')result=await pg.query('select public.release_dancer_payout_batch($1,$2,$3) receipt',[args.p_batch_id,args.p_status,args.p_failure_message]);
    else assert.fail('Unexpected payout RPC '+name);
    if(options[phase+'Lost'])return {data:null,error:{code:'08006'}};
    return {data:options[phase+'Transform']?options[phase+'Transform'](result.rows[0].receipt):result.rows[0].receipt,error:null};
   }catch(error){return {data:null,error};}
  }
 };
 const service=module('../src/lib/dancr/finance-payout-processing.ts',{
  './finance-earning-lifecycle':{releasePendingDancerEarnings:async()=>{releasePending++;}},
  './payout-account-store':{getEffectivePayoutSettings:async()=>({payoutsEnabled:options.enabled!==false,payoutMode:'manual',paymentProvider:'stripe'}),getDancerPayoutAccount:async(_client,dancer,provider)=>{accounts++;assert.equal(dancer,payoutId(1));assert.equal(provider,'stripe');await options.accountWait?.();if(options.accountError)throw new Error('Synthetic account lookup failure');return Object.hasOwn(options,'account')?options.account:{payout_eligibility:'eligible',verification_status:'verified',provider_account_id:'acct_synthetic'};}},
  './payout-provider':{getPayoutProvider:provider=>{assert.equal(provider,'stripe');return {initiatePayout:async input=>{transfers.push({...input});await options.transferWait?.();if(options.transferError)throw new Error('Synthetic provider response lost');return Object.hasOwn(options,'transferData')?options.transferData:{providerReferenceId:'tr_synthetic'};}};}},
  './nats':{getNatsRuntimeConfig:()=>({selected:options.nats===true})}
 });
 return {run:()=>service.processDancerPayouts(client),calls,transfers,counts:()=>({releasePending,accounts})};
}
const rpcNames=h=>h.calls.filter(c=>c.kind==='rpc').map(c=>c.name);
const assertReserved=async()=>{const state=await payoutSnapshot(pg);assert.equal(state.commission_events[0].status,'payout_processing');assert.equal(state.commission_events[0].payout_batch_id,payoutId(10));return state;};

test('fresh payout uses a checked atomic claim, one provider request and a confirmed receipt',async()=>{
 const h=harness(),result=await h.run();assert.equal(result.created,1);assert.equal(result.failed,0);
 assert.deepEqual(rpcNames(h),['claim_dancer_payout_dispatch','mark_dancer_payout_processing']);
 assert.deepEqual(h.transfers,[{payoutId:payoutId(10),dancerId:payoutId(1),providerAccountId:'acct_synthetic',amountCents:5000,currency:'usd',idempotencyKey:'mydancr-payout-'+payoutId(10)}]);
 const state=await assertReserved();assert.equal(state.dancer_payout_batches[0].provider_reference_id,'tr_synthetic');
});
for(const options of [{nats:true},{enabled:false}])test('existing payout gate '+JSON.stringify(options)+' prevents dispatch',async()=>{
 const h=harness(options),result=await h.run();assert.equal(result.disabled,true);assert.deepEqual(h.calls,[]);assert.deepEqual(h.transfers,[]);
});
for(const [status,reference]of [['processing','mydancr-payout-'+payoutId(10)],['processing','tr_synthetic'],['paid','tr_synthetic'],['failed',null],['canceled',null]])test(status+' '+reference+' is never automatically sent again',async()=>{
 await pg.query('update public.dancer_payout_batches set status=$1,provider_reference_id=$2',[status,reference]);const before=await payoutSnapshot(pg),h=harness();
 assert.equal((await h.run()).created,0);assert.deepEqual(h.transfers,[]);assert.deepEqual(rpcNames(h),[]);assert.deepEqual(await payoutSnapshot(pg),before);
});
for(const account of [null,{payout_eligibility:'ineligible',verification_status:'verified',provider_account_id:'acct_synthetic'},{payout_eligibility:'eligible',verification_status:'pending',provider_account_id:'acct_synthetic'},{payout_eligibility:'eligible',verification_status:'verified',provider_account_id:''}])test('failed eligibility preserves the pending reservation: '+JSON.stringify(account),async()=>{
 const before=await payoutSnapshot(pg),h=harness({account});assert.equal((await h.run()).failed,1);assert.deepEqual(h.transfers,[]);assert.deepEqual(rpcNames(h),[]);assert.deepEqual(await payoutSnapshot(pg),before);
});
test('a temporary account-read failure can retry the same still-requested payout safely',async()=>{
 const bad=harness({accountError:true});assert.equal((await bad.run()).failed,1);assert.deepEqual(rpcNames(bad),[]);await assertReserved();
 const retry=harness();assert.equal((await retry.run()).created,1);assert.equal(retry.transfers.length,1);
});
test('a failing worker cannot release another worker’s active reservation',async()=>{
 const h=harness({accountWait:async()=>{await pg.query('select public.mark_dancer_payout_processing($1,$2)',[payoutId(10),'tr_other_worker']);},accountError:true});
 assert.equal((await h.run()).failed,1);assert.deepEqual(rpcNames(h),[]);const state=await assertReserved();assert.equal(state.dancer_payout_batches[0].provider_reference_id,'tr_other_worker');
});
for(const key of ['claimError','claimThrow','claimLost'])test(key+' prevents provider dispatch and never releases the reservation',async()=>{
 const h=harness({[key]:true});assert.equal((await h.run()).failed,1);assert.deepEqual(h.transfers,[]);assert.ok(!rpcNames(h).includes('release_dancer_payout_batch'));await assertReserved();
 if(key==='claimLost'){const state=await payoutSnapshot(pg);assert.equal(state.dancer_payout_batches[0].metadata.dispatch_review_required,true);const retry=harness();await retry.run();assert.deepEqual(retry.transfers,[]);}
});
for(const claimData of [undefined,null,{},true,{id:payoutId(10),status:'requested',claimed:false}])test('unconfirmed claim '+JSON.stringify(claimData)+' prevents provider dispatch',async()=>{
 const h=harness({claimData});assert.equal((await h.run()).failed,1);assert.deepEqual(h.transfers,[]);await assertReserved();
});
for(const [field,value]of [['id',payoutId(99)],['dancerId',payoutId(99)],['amountCents',5001],['amountCents','5000'],['currency','eur'],['paymentProvider','other'],['dispatchKey','wrong-key'],['claimed','true'],['status','paid']])test('wrong claim '+field+' cannot authorize a transfer',async()=>{
 const h=harness({claimTransform:r=>({...r,[field]:value})});assert.equal((await h.run()).failed,1);assert.deepEqual(h.transfers,[]);await assertReserved();
});
test('two workers with the same queued request obtain only one permission to send',async()=>{
 let release;let waiting=0;const gate=new Promise(r=>{release=r;}),accountWait=async()=>{waiting++;if(waiting===2)release();await gate;};
 const a=harness({accountWait}),b=harness({accountWait});const results=await Promise.all([a.run(),b.run()]);
 assert.equal(results.reduce((n,r)=>n+r.created,0),1);assert.equal(a.transfers.length+b.transfers.length,1);await assertReserved();
});
for(const key of ['transferError','confirmError','confirmThrow','confirmLost'])test(key+' preserves the claimed reservation for reconciliation',async()=>{
 const h=harness({[key]:true}),result=await h.run();assert.equal(result.created,0);assert.equal(result.failed,1);assert.equal(h.transfers.length,1);
 assert.ok(!rpcNames(h).includes('release_dancer_payout_batch'));const state=await assertReserved();assert.equal(state.dancer_payout_batches[0].metadata.dispatch_review_required,true);
 const retry=harness();await retry.run();assert.deepEqual(retry.transfers,[]);
});
for(const transferData of [null,{}, {providerReferenceId:''},{providerReferenceId:42}])test('unconfirmed provider reference '+JSON.stringify(transferData)+' is held for reconciliation',async()=>{
 const h=harness({transferData}),result=await h.run();assert.equal(result.created,0);assert.equal(result.failed,1);await assertReserved();
});
for(const confirmData of [undefined,null,{}, {id:payoutId(99),status:'processing'},{id:payoutId(10),status:'requested'}])test('unconfirmed completion '+JSON.stringify(confirmData)+' cannot report a created payout',async()=>{
 const h=harness({confirmData}),result=await h.run();assert.equal(result.created,0);assert.equal(result.failed,1);await assertReserved();
});
test('a signed provider completion arriving before the marker is acknowledged remains paid',async()=>{
 const h=harness({transferWait:()=>pg.query('select public.complete_dancer_payout_batch($1,$2,$3)',[payoutId(10),'tr_synthetic','2026-01-01T00:00:00Z'])});
 assert.equal((await h.run()).created,1);const state=await payoutSnapshot(pg);assert.equal(state.dancer_payout_batches[0].status,'paid');assert.equal(state.commission_events[0].status,'paid');
});
for(const key of ['reviewError','reviewThrow'])test(key+' is reported without undoing or repeating a transfer',async()=>{
 const h=harness({transferError:true,[key]:true}),result=await h.run();assert.equal(result.failed,1);assert.equal(result.errors.length,2);assert.equal(h.transfers.length,1);await assertReserved();
});
for(const reviewData of [null,{}, {id:payoutId(99),status:'processing',review_required:true}])test('missing review acknowledgment '+JSON.stringify(reviewData)+' remains visible as a failure',async()=>{
 const h=harness({transferError:true,reviewData}),result=await h.run();assert.equal(result.errors.length,2);await assertReserved();
});
for(const readData of [null,{},undefined])test('unconfirmed payout selection '+JSON.stringify(readData)+' is not an empty successful run',async()=>{
 const h=harness({readData});await assert.rejects(h.run());assert.deepEqual(h.transfers,[]);
});
test('payout selection failure prevents dispatch',async()=>{const h=harness({readError:true});await assert.rejects(h.run());assert.deepEqual(h.transfers,[]);});
