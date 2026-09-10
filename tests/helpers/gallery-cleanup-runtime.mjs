import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root=fileURLToPath(new URL('../../',import.meta.url)),nativeRequire=createRequire(import.meta.url);
// Execute the actual retirement gateway, responsive-path parser, original-path
// mapper and safe diagnostics. Only external transports are provided by tests.
export function loadGalleryCleanupRuntime({warn=()=>{}}={}){
 const cache=new Map();
 function load(relative){
  let absolute=path.resolve(root,relative);if(!existsSync(absolute))absolute+='.ts';
  if(cache.has(absolute))return cache.get(absolute).exports;
  const testModule={exports:{}};cache.set(absolute,testModule);
  const compiled=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(compiled,{exports:testModule.exports,module:testModule,Buffer,Headers,URL,Error,process,setTimeout,clearTimeout,console:{warn},
   require:name=>name==='server-only'?{}:name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(absolute),name))):nativeRequire(name)});
  return testModule.exports;
 }
 return {cleanup:load('src/lib/dancr/gallery-storage-retirement.ts'),retry:load('src/lib/dancr/gallery-storage-retry.ts'),apiPolicy:load('src/lib/api-error-policy.ts'),publication:load('src/lib/dancr/photo-publication.ts'),
  responsive:load('src/lib/dancr/responsive-image.ts'),watermark:load('src/lib/dancr/media-watermark.ts')};
}
