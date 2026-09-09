import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../../src/lib/api-error-policy.ts';

const source = readFileSync(new URL('../../src/lib/dancr/photo-publication.ts', import.meta.url), 'utf8');
export function loadGalleryGateway(dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console: { warn() {} },
    require: () => ({ PublicApiError, safeErrorMetadata: error => ({ code: error.code || 'synthetic' }), ...dependencies }),
  });
  return exports;
}
