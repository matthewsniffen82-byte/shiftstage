import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const privateText = 'synthetic-provider-secret owner@example.invalid /srv/private/query.sql';
const sourceRoot = new URL('../src/lib/dancr/', import.meta.url);
function module(name, dependencies, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(name, sourceRoot), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
  }).outputText, {
    exports, Error, Date, URL, URLSearchParams, AbortSignal,
    require: name => {assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];},
    ...globals,
  });
  return exports;
}

function harness({agent=false, status=200, payload={result:'Successfully added manual invoice'}, contentType='application/json', networkFailure=false, bodyFailure=false, completion='success', failureWrite=false, selected=true, configured=true, loginId=123, sequence=null}={}) {
  const requests = [], calls = [];
  const nats = module('nats.ts', {'server-only':{}}, {
    process: {env: {
      NODE_ENV:'production', COMMISSION_SETTLEMENT_PROVIDER:selected?'nats':'mydancr',
      NATS_BASE_URL:'https://provider.example.invalid', NATS_AFFILIATE_PORTAL_URL:'https://portal.example.invalid',
      NATS_API_USERNAME:'synthetic-user', NATS_API_KEY:configured?'synthetic-key':'',
    }},
    fetch: async (url, options) => {
      assert.equal(String(url), 'https://provider.example.invalid/api/v1/affiliate/invoice');
      assert.equal(options.method, 'POST');
      const config = sequence?.[requests.length] || {status,payload,contentType,networkFailure,bodyFailure};
      requests.push({body:String(options.body)});
      if (config.networkFailure) throw new Error(privateText);
      const response = new Response(typeof config.payload === 'string' ? config.payload : JSON.stringify(config.payload), {
        status:config.status, headers:{'content-type':config.contentType},
      });
      if (config.bodyFailure) response.text = async () => {throw new Error(privateText);};
      return response;
    },
  });
  const worker = module('nats-commission-sync.ts', {'./nats':nats});
  const prefix = agent ? 'nats_agent_commission_export' : 'nats_commission_export';
  const client = {async rpc(name, args) {
    calls.push({name, args:structuredClone(args)});
    if (name === 'claim_' + prefix + 's') return {data:Array.from({length:sequence?.length || 1},(_,index)=>({export_id:'export-'+index,login_id:loginId,amount_cents:1234,currency:'usd'})),error:null};
    if (name === 'complete_' + prefix) {
      if (completion === 'throw') throw new Error(privateText);
      if (completion === 'error') return {data:null,error:{message:privateText,code:'08006'}};
      return {data:completion === 'success',error:null};
    }
    assert.equal(name, 'fail_' + prefix);
    return {data:null,error:failureWrite?{message:privateText,code:'08006'}:null};
  }};
  return {calls, requests, run:() => agent ? worker.syncNatsAgentCommissions(client) : worker.syncNatsCommissions(client)};
}

const cases = [
  ['provider rejection', {status:400,payload:{error:privateText}}, 'failed'],
  ['provider result rejection', {status:403,payload:{result:privateText}}, 'failed'],
  ['server failure', {status:503,payload:{message:privateText}}, 'reconciliation_required'],
  ['unexpected success body', {payload:{result:privateText}}, 'reconciliation_required'],
  ['network exception', {networkFailure:true}, 'reconciliation_required'],
  ['response body exception', {bodyFailure:true}, 'reconciliation_required'],
  ['completion query error', {completion:'error'}, 'reconciliation_required'],
  ['completion transport exception', {completion:'throw'}, 'reconciliation_required'],
  ['completion lease changed', {completion:'lost'}, 'reconciliation_required'],
  ['malformed response', {payload:'<html>'+privateText+'</html>'}, 'reconciliation_required'],
  ['untrusted content type', {status:400,payload:{error:privateText},contentType:'application/json; note='+privateText}, 'failed'],
];
for (const agent of [false, true]) {
  for (const [name, options, status] of cases) for (const failureWrite of [false, true]) {
    test((agent?'agent':'dancer')+' export diagnostics: '+name+' failure receipt '+!failureWrite, async () => {
      const h = harness({agent,...options,failureWrite}), result = await h.run();
      assert.equal(h.requests.length, 1, 'Never repeat a provider dispatch after uncertainty');
      assert.equal(h.requests[0].body, 'loginid=123&amount=12.34');
      const failures = h.calls.filter(call => call.name.startsWith('fail_'));
      assert.equal(failures.length, 1);
      assert.equal(failures[0].args.p_status, status);
      assert.equal(result.exported, 0);
      assert.equal(result.failed, status === 'failed' ? 1 : 0);
      assert.equal(result.reconciliationRequired, status === 'reconciliation_required' ? 1 : 0);
      assert.equal(result.errors.length, failureWrite ? 2 : 1);
      assert.doesNotMatch(JSON.stringify({result,calls:h.calls}), /synthetic-provider-secret|owner@example|srv\/private|query\.sql/);
    });
  }
  test((agent?'agent':'dancer')+' successful export stores a normalized receipt and bounded metadata', async () => {
    const h = harness({agent,payload:{result:'Successfully added manual invoice '+privateText},contentType:'application/json; note='+privateText});
    const result = await h.run(), completed = h.calls.find(call => call.name.startsWith('complete_'));
    assert.equal(result.exported, 1); assert.equal(result.failed, 0); assert.equal(result.reconciliationRequired, 0);
    assert.equal(h.requests.length, 1); assert.equal(h.calls.length, 2);
    assert.equal(completed.args.p_nats_result, 'Successfully added manual invoice');
    assert.deepEqual(completed.args.p_response_metadata, {http_status:200,content_type:'application/json'});
    assert.doesNotMatch(JSON.stringify({result,calls:h.calls}), /synthetic-provider-secret|owner@example|srv\/private/);
  });
  for (const options of [{selected:false},{configured:false}]) test((agent?'agent':'dancer')+' inactive export remains disabled '+JSON.stringify(options), async () => {
    const h = harness({agent,...options}), result = await h.run();
    assert.equal(result.disabled, true); assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 0);
  });
  test((agent?'agent':'dancer')+' invalid claim never dispatches', async () => {
    const h = harness({agent,loginId:privateText}), result = await h.run();
    assert.equal(h.requests.length, 0); assert.equal(result.reconciliationRequired, 1);
    assert.doesNotMatch(JSON.stringify({result,calls:h.calls}), /synthetic-provider-secret/);
  });
  for (const successFirst of [true,false]) test((agent?'agent':'dancer')+' mixed export outcomes preserve the completed invoice, success first '+successFirst, async () => {
    const success={status:200,payload:{result:'Successfully added manual invoice '+privateText},contentType:'application/json'};
    const failure={networkFailure:true};
    const h=harness({agent,sequence:successFirst?[success,failure]:[failure,success]}), result=await h.run();
    assert.equal(result.exported,1); assert.equal(result.failed,0); assert.equal(result.reconciliationRequired,1);
    assert.equal(result.errors.length,1); assert.equal(h.requests.length,2);
    const completed=h.calls.filter(call=>call.name.startsWith('complete_'));
    const failed=h.calls.filter(call=>call.name.startsWith('fail_'));
    assert.equal(completed.length,1); assert.equal(failed.length,1);
    assert.equal(completed[0].args.p_export_id,successFirst?'export-0':'export-1');
    assert.equal(failed[0].args.p_export_id,successFirst?'export-1':'export-0');
    assert.equal(failed[0].args.p_status,'reconciliation_required');
    assert.doesNotMatch(JSON.stringify({result,calls:h.calls}),/synthetic-provider-secret|owner@example|srv\/private/);
  });
}
