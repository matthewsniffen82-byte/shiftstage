import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as visualProvider from './media-visual-runtime.mjs';
import { withOpenAIRequestDeadline } from '../../src/lib/openai-request.ts';
import * as content from '../../src/lib/dancr/photo-content-policy-core.ts';
import * as identity from '../../src/lib/dancr/media-identity-core.ts';
import * as contentRules from '../../src/lib/dancr/media-content-rules.ts';
import * as personRules from '../../src/lib/dancr/person-count-rules.ts';

export function visualReviewRuntime({ createResponse, createClient, getServerEnv = () => 'synthetic-key' } = {}) {
  const exports = {};
  const dependencies = {
    'server-only': {},
    './media-visual-provider.ts': visualProvider,
    '../openai-client': { createOpenAIClient: createClient || (async () => ({ responses: { create: createResponse } })) },
    '../openai-request.ts': { withOpenAIRequestDeadline },
    '../server-env.ts': { getServerEnv },
    './photo-content-policy-core.ts': content,
    './media-identity-core.ts': identity,
    './media-content-rules.ts': contentRules,
    './person-count-rules.ts': personRules,
  };
  const source = readFileSync(new URL('../../src/lib/dancr/media-visual-review.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Buffer, Error, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error('Unexpected visual review dependency: ' + name);
  } });
  return exports;
}
