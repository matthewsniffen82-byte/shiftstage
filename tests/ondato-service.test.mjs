import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import * as policy from '../src/lib/dancr/ondato-policy.ts';
import * as urls from '../src/lib/dancr/ondato-url.ts';
import { ids, identity, identification, identificationSetup } from './helpers/ondato-fixture.mjs';
const code = ts.transpileModule(readFileSync(new URL('../src/lib/dancr/ondato.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sessionId=ids.sessionId;
const hosted='https://idv.ondato.com/?id='+sessionId;
const attempt={user_id:'owner',attempt_id:ids.attemptId,provider:'ondato',provider_integration_id:ids.setupId,session_id:sessionId,status:'creating',reserved:true};
function fixture({ reservation = attempt, current = attempt, idv = identity(), kyc = identification(), setup = identificationSetup(), setupError = false, created = { id: ids.sessionId }, saveError = null, env = {}, configured = true, providerError = false, token = { access_token: "server-only-access-token", token_type: "Bearer" }, reservationError = null } = {}) {
  const calls = [], writes = [];
  const admin = {
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: reservation, error: reservationError }; },
    from(table) {
      const filters = []; let mutation;
      const query = { select() { return this; }, eq(column, value) { filters.push([column, value]); return this; }, or(value) { filters.push(['or', value]); return this; },
        update(value) { mutation = value; return this; },
        async single() { return { data: { enabled: true }, error: null }; },
        async maybeSingle() {
          if (mutation) { writes.push({ table, mutation, filters }); return { data: saveError ? null : { session_id: sessionId }, error: saveError }; }
          calls.push({ read: table, filters }); return { data: current, error: null };
        },
        then(resolve) { writes.push({ table, mutation, filters }); return Promise.resolve({ error: saveError }).then(resolve); },
      };
      return query;
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, URL, URLSearchParams, Date, AbortSignal, Response,
    process: { env: configured ? { ONDATO_CLIENT_ID: 'test-client', ONDATO_CLIENT_SECRET: 'test-secret', ONDATO_WEBHOOK_SECRET: 'test-webhook-secret',
      ONDATO_SETUP_ID: ids.setupId, ONDATO_APPLICATION_ID: ids.applicationId, ONDATO_ENVIRONMENT: 'live', NEXT_PUBLIC_SITE_URL: 'https://www.mydancr.test', ...env } : {} },
    async fetch(url, options) {
      calls.push({ url, options });
      if (providerError) throw new Error('provider error containing sensitive information');
      if (setupError && url.endsWith('/setup')) return new Response('unavailable', { status: 503 });
      const payload = url.endsWith('/connect/token') ? token : options.method === 'POST' ? created
        : url.includes('/setup-localisations') ? null : url.endsWith('/setup') ? setup : url.includes('kycid.') ? kyc : idv;
      return new Response(payload === null ? null : JSON.stringify(payload), { status: payload === null ? 204 : 200 });
    },
    require(name) {
      if (name === 'server-only') return {};
      if (name === '../api-error-policy') return { PublicApiError };
      if (name === './ondato-policy') return policy;
      if (name === './ondato-url') return urls;
      throw new Error(name);
    },
  });
  return { calls, writes, start: () => exports.startDancerAgeVerification(admin, 'owner'),
    reconcile: () => exports.reconcileOndatoSession(admin, sessionId), get: () => exports.getDancerAgeVerification(admin, 'owner'), config: exports.ondatoConfig };
}

test('OAuth session creation sends only the opaque attempt and setup; all browser returns use the fixed callback',async()=>{
  const f=fixture();const result=await f.start();assert.equal(result.url,hosted);
  const requests=f.calls.filter(x=>x.url);assert.equal(requests.length,3);
  assert.equal(requests[0].url,'https://id.ondato.com/connect/token');
  assert.equal(requests[0].options.body.get('grant_type'),'client_credentials');
  assert.equal(requests[0].options.body.get('client_secret'),'test-secret');
  assert.deepEqual(JSON.parse(requests[1].options.body),{setupId:ids.setupId,externalReferenceId:ids.attemptId});
  const settings=JSON.parse(requests[2].options.body).localisationSettings[0];
  for(const key of ['successRedirectUrl','failureRedirectUrl','consentDeclinedRedirectUrl']) assert.equal(settings[key],'https://www.mydancr.test/dashboard/dancer?age-verification=returned');
  for(const request of requests) assert.equal(request.options.redirect,'error');
  assert.equal(requests[1].options.headers.authorization,'Bearer server-only-access-token');
  assert.equal(requests[1].options.signal,requests[2].options.signal);
  for(const [key,value] of [['user_id','owner'],['attempt_id',ids.attemptId],['provider','ondato'],['provider_integration_id',ids.setupId]]) assert.ok(f.writes[0].filters.some(([k,v])=>k===key&&v===value));
});
test('existing pending, reviewed and verified sessions do not create another paid check',async()=>{
  for(const status of ['pending','in_review','verified']){
    const f=fixture({reservation:{...attempt,status,reserved:false,verification_url:hosted}});
    assert.equal((await f.start()).url,status==='pending'?hosted:null);assert.equal(f.calls.filter(x=>x.url).length,0);
  }
  await assert.rejects(fixture({reservation:{...attempt,reserved:false,verification_url:hosted.replace(ids.sessionId,ids.kycId)}}).start(),e=>e.status===409);
});
test('test projects, missing config, previous providers, wrong setups, malformed responses and outages fail closed',async()=>{
  for(const options of [{configured:false},{env:{ONDATO_ENVIRONMENT:'test'}},{env:{ONDATO_APPLICATION_ID:'bad'}},{env:{ONDATO_WEBHOOK_SECRET:''}},
    {env:{NEXT_PUBLIC_SITE_URL:'http://localhost'}},{reservation:{...attempt,provider:'veriff'}},{reservation:{...attempt,provider_integration_id:ids.kycId}},
    {created:{id:'invalid'}},{token:{access_token:''}},{providerError:true},{saveError:{code:'save-failed'}}]){
    await assert.rejects(fixture(options).start(),e=>e.status===503&&!e.message.includes('sensitive'));
  }
  await assert.rejects(fixture({reservationError:{message:'AGE_PROFILE_SETUP_REQUIRED'}}).start(),e=>e.status===409);
  await assert.rejects(fixture({reservationError:{message:'AGE_VERIFICATION_RETRY_LIMIT'}}).start(),e=>e.status===429);
});
test('authoritative IDV, KYC and identification setup retrieval saves only a conditional minimal status',async()=>{
  const f=fixture();await f.reconcile();
  const requests=f.calls.filter(x=>x.url);
  assert.deepEqual(requests.map(x=>x.url),['https://id.ondato.com/connect/token',`https://idvapi.ondato.com/v1/identity-verifications/${ids.sessionId}`,`https://kycid.ondato.com/v1/identifications/${ids.kycId}`,`https://kycid.ondato.com/v1/identifications/${ids.kycId}/setup`]);
  assert.equal(requests[3].options.headers.authorization,'Bearer server-only-access-token');
  assert.equal(requests[3].options.signal,requests[1].options.signal);
  assert.equal(requests[3].options.cache,'no-store');
  assert.equal(f.writes[0].mutation.status,'verified');
  assert.deepEqual(Object.keys(f.writes[0].mutation).sort(),['checked_at','status','verification_url','verified_at']);
  for(const [key,value] of [['session_id',ids.sessionId],['provider','ondato'],['attempt_id',ids.attemptId]]) assert.ok(f.writes[0].filters.some(([k,v])=>k===key&&v===value));
  assert.ok(f.writes[0].filters.some(([k,v])=>k==='or'&&v.startsWith('checked_at.is.null,checked_at.lt.')));
});
test('duplicate approvals preserve the first verification timestamp so saved physical taps stay valid',async()=>{
  const verified_at='2026-01-01T00:00:00Z';const f=fixture({current:{...attempt,status:'verified',verified_at}});await f.reconcile();
  assert.equal(f.writes[0].mutation.verified_at,verified_at);
});
test('unknown sessions, mismatched results and unavailable provider responses never overwrite saved approvals',async()=>{
  const absent=fixture({current:null});await absent.reconcile();assert.equal(absent.calls.filter(x=>x.url).length,0);assert.equal(absent.writes.length,0);
  for(const options of [{idv:{...identity(),externalReferenceId:ids.kycId}},{kyc:{...identification(),applicationId:ids.kycId}},
    {current:{...attempt,provider_integration_id:ids.kycId}},{providerError:true},{setupError:true},
    {setup:{...identificationSetup(),versionId:ids.setupId}},{setup:{...identificationSetup(),applicationId:ids.sessionId}}]){
    const f=fixture(options);await assert.rejects(f.reconcile(),e=>e.status===503);assert.equal(f.writes.length,0);
  }
});

test('missing or passive-only setups cannot approve; unfinished and rejected checks do not need setup retrieval',async()=>{
  for(const setup of [null,{}, {...identificationSetup(),face:{enabled:true,activeLivenessEnabled:false,passiveLivenessEnabled:true}}]){
    const f=fixture({setup});await f.reconcile();assert.equal(f.writes[0].mutation.status,'in_review');assert.equal(f.writes[0].mutation.verified_at,null);
  }
  for(const [patch,expected] of [[{kyc:{...identification(),status:'Rejected'}},'declined'],
    [{idv:{...identity(),status:'Expired'}},'expired'],[{idv:{...identity(),status:'InProgress'}},'in_review'],
    [{idv:{...identity(),step:{kycIdentification:{id:ids.kycId,isSuccess:null}}}},'in_review']]){
    const f=fixture({...patch,setupError:true});await f.reconcile();assert.equal(f.writes[0].mutation.status,expected);
    assert.equal(f.calls.filter(x=>x.url?.endsWith('/setup')).length,0);
  }
});
test('a current rejection revokes approval; ordinary access uses the saved result without provider calls',async()=>{
  const f=fixture({kyc:{...identification(),status:'Rejected'}});await f.reconcile();assert.equal(f.writes[0].mutation.status,'declined');assert.equal(f.writes[0].mutation.verified_at,null);
  const saved=fixture({current:{...attempt,status:'verified',verified_at:'2026-01-01'},providerError:true});
  assert.equal((await saved.get()).status,'verified');assert.equal(saved.calls.filter(x=>x.url).length,0);
});
