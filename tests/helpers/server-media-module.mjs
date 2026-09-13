import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Next resolves this build-time guard to its empty server implementation. Native
// Node tests use the same implementation, only for the reviewed media signer.
// All production modules and their actual implementations still execute.
const serverMarker = pathToFileURL(createRequire(import.meta.url).resolve('next/dist/compiled/server-only/empty.js')).href;
const signer = new URL('../../src/lib/dancr/media-delivery-url.ts', import.meta.url).href;
export async function importMediaModule(name) {
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' && context.parentURL === signer) {
      return nextResolve(serverMarker, context);
    }
    return nextResolve(specifier, context);
  } });
  try { return await import(new URL('../../src/lib/dancr/' + name, import.meta.url)); }
  finally { hook.deregister(); }
}
