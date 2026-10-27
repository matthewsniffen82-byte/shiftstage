import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function loadNfcModule(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Buffer, URL, Request, Response, Date, ...globals, require(name) {
    if (name in imports) return imports[name];
    if (name === 'server-only') return {};
    if (name.endsWith('server-env')) return { getServerEnv: () => 'synthetic-test-secret-never-used-in-production' };
    if (name.startsWith('node:') || name === 'react/jsx-runtime') return require(name);
    throw Error(`Unexpected import: ${name}`);
  }});
  return exports;
}
export const sessions = loadNfcModule('src/lib/dancr/internal-tap-session.ts');
export const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const grantInput = { link: id(1), token: id(3), tag: id(40), generation: id(41), actor: null };
export function grantCookie(input = grantInput, now = Date.now()) {
  return `${sessions.internalCookieName(input.token)}=${sessions.createInternalGrant(input, now).value}`;
}
