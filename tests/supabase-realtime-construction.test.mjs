import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';

function loadModule(name,dependencies){
 const source=readFileSync(new URL('../src/lib/supabase/'+name,import.meta.url),'utf8'),exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:specifier=>{if(specifier==='server-only')return {};assert.ok(specifier in dependencies,'Unexpected dependency');return dependencies[specifier];},Buffer,URL,Error});
 return exports;
}

for(const [moduleName,factory,singleton] of [
 ['client.ts','createBrowserSupabaseClient',true],
 ['server.ts','createServerSupabaseClient',false],
 ['admin.ts','createAdminSupabaseClient',false],
])test(factory+' initializes without opening realtime or making network requests',async()=>{
 const priorSocket=globalThis.WebSocket,options=[],clients=[];let sockets=0,requests=0;
 globalThis.WebSocket=class{constructor(){sockets++;throw new Error('Unexpected realtime connection');}};
 try{
  const serverConfig=loadModule('server-config.ts',{});
  const exported=loadModule(moduleName,{
   '@supabase/supabase-js':{createClient:(url,key,config)=>{options.push(config);const client=createClient(url,key,config);clients.push(client);return client;}},
   '../env':{getPublicEnv:()=>({supabaseUrl:'https://realtime-fixture.invalid',supabaseAnonKey:'synthetic-public-key'})},
   '../server-env':{getServerEnv:()=> 'sb_secret_synthetic_only'},
   './server-config':serverConfig,
   './bounded-fetch':{boundedSupabaseFetch:async()=>{requests++;throw new Error('Unexpected HTTP request during construction');}},
  });
  const first=exported[factory](),second=exported[factory]();assert.equal(first===second,singleton);assert.equal(clients.length,singleton?1:2);
  for(const config of options)assert.deepEqual(JSON.parse(JSON.stringify(config.auth)),{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
  for(const client of clients){
   const result=await client.auth.initialize();assert.equal(result.error,null);
   assert.deepEqual(client.getChannels(),[]);assert.equal(client.realtime.isConnected(),false);
  }
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sockets,0);assert.equal(requests,0);
 }finally{
  for(const client of clients){await client.auth.stopAutoRefresh();await client.removeAllChannels();}
  globalThis.WebSocket=priorSocket;
 }
});
