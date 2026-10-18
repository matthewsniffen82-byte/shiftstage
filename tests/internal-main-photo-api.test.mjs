import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source = ts.transpileModule(readFileSync(new URL('../app/api/dancer/internal-main-photo/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ signedIn = true, error = null, hasPhoto = true, hasProfile = true } = {}) {
  const calls = [], exports = {};
  const admin = {
    from(table) { return { select() { return this; }, eq(column, value) { calls.push({ table, column, value }); return this; }, async maybeSingle() { return { data: hasProfile ? { id: id(11) } : null, error }; } }; },
    async rpc(name, args) { calls.push({ name, args }); throw new Error("Legacy photo choices must never be written"); },
  };
  vm.runInNewContext(source, { exports, Response, require(name) {
    if(name === 'next/server') return { NextResponse: { json: Response.json } };
    if(name.endsWith('api-error-policy')) return { PublicApiError, resolveApiError };
    if(name.endsWith('supabase/admin')) return { createAdminSupabaseClient: () => admin };
    if(name.endsWith('supabase/request')) return { createRequestSupabaseContext: async (_request, options) => {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { role: 'dancer', allowProfileSetup: true });
      if(!signedIn) throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401);
      return { user: { id: id(1) }, session: { accessToken: 'refreshed-test-session' } };
    } };
    if(name.endsWith('internal-main-photo')) return { internalMainPhotos: async (_client, dancers) => {
      assert.deepEqual(Array.from(dancers), [id(11)]);
      return new Map(hasPhoto ? [[id(11), { id: id(21), storage_path: 'PRIVATE' }]] : []);
    } };
    throw Error(name);
  } });
  return { calls, get: () => exports.GET(new Request('https://test.invalid/api/dancer/internal-main-photo?dancerId='+id(999))),
    patch: body => exports.PATCH(new Request('https://test.invalid/api/dancer/internal-main-photo', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) };
}
test('GET reads only the signed-in dancer and returns the shared main photo without storage paths', async () => {
  const f=fixture(), response=await f.get(), body=await response.json();
  assert.equal(response.status,200); assert.equal(body.photoId,null); assert.equal(body.displayedPhotoId,id(21));
  assert.equal(body.session.accessToken,'refreshed-test-session');
  assert.deepEqual(f.calls[0], { table:'dancer_profiles',column:'user_id',value:id(1) });
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE|storage_path/); assert.match(response.headers.get('cache-control'),/no-store/);
});

for(const options of [{hasPhoto:false}, {hasProfile:false}]) test('GET handles a missing approved main photo or profile',async()=>{
  const response=await fixture(options).get(), body=await response.json();
  assert.equal(response.status,200); assert.equal(body.photoId,null); assert.equal(body.displayedPhotoId,null);
});

test('old dashboards receive a clear retired response and cannot write separate roster choices',async()=>{
  for(const input of [{photoId:id(21),actor:id(999),dancerId:id(888)}, {}, {photoId:'bad'}, {extra:'x'.repeat(2100)}]) {
    const f=fixture(), response=await f.patch(input), body=await response.json();
    assert.equal(response.status,410); assert.equal(body.ok,false);
    assert.match(body.error,/main photo.*club roster/i); assert.match(body.error,/Refresh/);
    assert.equal(body.session.accessToken,'refreshed-test-session');
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.deepEqual(f.calls,[]);
  }
});

test('both endpoints still require an authenticated dancer',async()=>{
  const f=fixture({signedIn:false}); assert.equal((await f.get()).status,401);
  assert.equal((await f.patch({photoId:id(21)})).status,401); assert.equal(f.calls.length,0);
});

test('profile lookup failures remain private and do not claim an empty successful result',async()=>{
  const response=await fixture({error:{code:'08006',message:'PRIVATE database details'}}).get();
  assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/PRIVATE/);
});
