import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source = ts.transpileModule(readFileSync(new URL('../app/api/dancer/internal-main-photo/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ signedIn = true, error = null, result = id(21), selected = true } = {}) {
  const calls = [], exports = {};
  const admin = {
    from(table) { return { select() { return this; }, eq(column, value) { calls.push({ table, column, value }); return this; }, async maybeSingle() { return { data: { id: id(11) }, error: null }; } }; },
    async rpc(name, args) { calls.push({ name, args }); return { data: result, error }; },
  };
  vm.runInNewContext(source, { exports, Response, require(name) {
    if(name === 'next/server') return { NextResponse: { json: Response.json } };
    if(name.endsWith('api-error-policy')) return { PublicApiError, resolveApiError };
    if(name.endsWith('bounded-json-body')) return { readBoundedJsonObject };
    if(name.endsWith('supabase/admin')) return { createAdminSupabaseClient: () => admin };
    if(name.endsWith('supabase/request')) return { createRequestSupabaseContext: async (_request, options) => {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { role: 'dancer', allowProfileSetup: true });
      if(!signedIn) throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401);
      return { user: { id: id(1) }, session: { accessToken: 'refreshed-test-session' } };
    } };
    if(name.endsWith('internal-main-photo')) return { internalMainPhotos: async (_client, dancers) => {
      assert.deepEqual(Array.from(dancers), [id(11)]);
      return new Map([[id(11), { id: id(21), storage_path: 'PRIVATE', explicitlySelected: selected }]]);
    } };
    throw Error(name);
  } });
  return { calls, get: () => exports.GET(new Request('https://test.invalid/api/dancer/internal-main-photo?dancerId='+id(999))),
    patch: body => exports.PATCH(new Request('https://test.invalid/api/dancer/internal-main-photo', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) };
}
test('GET reads only the signed-in dancer and returns IDs without storage paths', async () => {
  const f=fixture(), response=await f.get(), body=await response.json();
  assert.equal(response.status,200); assert.equal(body.photoId,id(21));
  assert.deepEqual(f.calls[0], { table:'dancer_profiles',column:'user_id',value:id(1) });
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path/); assert.match(response.headers.get('cache-control'),/no-store/);
});
test('GET distinguishes an automatic fallback from the dancer choice',async()=>{
  const body=await (await fixture({selected:false}).get()).json();
  assert.equal(body.photoId,null); assert.equal(body.displayedPhotoId,id(21));
});
test('PATCH uses server actor and returns only confirmed selection',async()=>{
  const f=fixture(), response=await f.patch({photoId:id(21),actor:id(999),dancerId:id(888)});
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{name:'set_dancer_internal_main_photo',args:{p_actor_user_id:id(1),p_photo_id:id(21)}});
  const body=await response.json(); assert.equal(body.photoId,id(21)); assert.equal(body.session.accessToken,'refreshed-test-session');
});
test('both endpoints require authentication',async()=>{
  const f=fixture({signedIn:false}); assert.equal((await f.get()).status,401);
  assert.equal((await f.patch({photoId:id(21)})).status,401); assert.equal(f.calls.length,0);
});
test('invalid and oversized choices fail before RPC',async()=>{
  for(const body of [{photoId:'x'}, {}, {photoId:id(21),extra:'x'.repeat(2100)}]){
    const f=fixture(); assert.ok([400,413].includes((await f.patch(body)).status)); assert.equal(f.calls.length,0);
  }
});
for(const [code,status] of [['42501',403],['P0002',404],['08006',503]]) {
  test('RPC error '+code+' fails safely',async()=>{
    const response=await fixture({error:{code,message:'PRIVATE database details'}}).patch({photoId:id(21)});
    assert.equal(response.status,status); assert.doesNotMatch(await response.text(),/PRIVATE/);
  });
}
test('lost or mismatched confirmation does not claim a successful save',async()=>{
  assert.equal((await fixture({result:null}).patch({photoId:id(21)})).status,503);
  assert.equal((await fixture({result:id(22)}).patch({photoId:id(21)})).status,503);
});
