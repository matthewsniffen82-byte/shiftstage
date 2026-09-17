import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { withOpenAIRequestDeadline } from '../../src/lib/openai-request.ts';
import * as core from '../../src/lib/dancr/media-identity-core.ts';

export function mediaIdentityRuntime({ createResponse, createClient, getServerEnv = () => 'synthetic-key' } = {}) {
  const exports = {};
  const dependencies = {
    'server-only': {},
    '../openai-client': { createOpenAIClient: createClient || (async () => ({ responses: { create: createResponse } })) },
    '../openai-request.ts': { withOpenAIRequestDeadline },
    '../server-env.ts': { getServerEnv, getOptionalServerEnv: () => null },
    './media-identity-core.ts': core,
  };
  const source = readFileSync(new URL('../../src/lib/dancr/media-identity.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Buffer, Error, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Unexpected media identity dependency: ' + name);
  } });
  return exports;
}
