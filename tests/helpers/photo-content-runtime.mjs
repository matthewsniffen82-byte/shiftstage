import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { withOpenAIRequestDeadline } from '../../src/lib/openai-request.ts';
import * as policy from '../../src/lib/dancr/photo-content-policy-core.ts';

export function photoContentRuntime({ createResponse, createClient, getServerEnv = () => 'synthetic-key' } = {}) {
  const exports = {};
  const dependencies = {
    'server-only': {},
    '../openai-client': { createOpenAIClient: createClient || (async () => ({ responses: { create: createResponse } })) },
    '../openai-request.ts': { withOpenAIRequestDeadline },
    '../server-env.ts': { getServerEnv },
    './photo-content-policy-core.ts': policy,
  };
  const source = readFileSync(new URL('../../src/lib/dancr/photo-content-policy.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Buffer, Error, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Unexpected photo content dependency: ' + name);
  } });
  return exports;
}
