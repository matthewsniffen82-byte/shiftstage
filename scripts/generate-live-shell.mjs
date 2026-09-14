import { readFile, writeFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import postcss from 'postcss';
import { assembleLiveShell } from './lib/live-shell-source.mjs';

const { html, includes } = await assembleLiveShell(new URL('../src/live-shell/', import.meta.url));
// Check complete classic-script scopes, including references across fragments.
// Existing browser globals and intentionally shared handlers are not unused code.
const linter = new ESLint({ overrideConfigFile: true, overrideConfig: [{
  languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: globals.browser },
  rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }], 'no-control-regex': 'off' }
}] });
const diagnostics = [];
for (const name of ['device-bootstrap', 'application']) diagnostics.push(...await linter.lintText(includes[name], { filePath: name + '.js' }));
for (const name of ['base-styles', 'directory-styles', 'override-styles']) postcss.parse(includes[name], { from: name + '.css' });
const formatter = await linter.loadFormatter('stylish');
if (diagnostics.some(result => result.errorCount || result.warningCount)) {
  console.error(formatter.format(diagnostics));
  process.exitCode = 1;
} else {
  const target = new URL('../outputs/index.html', import.meta.url);
  const current = (await readFile(target, 'utf8')).replace(/\r\n?/g, '\n');
  if (process.argv.includes('--check')) {
    if (current !== html) throw new Error('Homepage artifact is stale. Run npm run generate:live-shell and commit the source and generated output together.');
  } else if (current !== html) await writeFile(target, html);
  console.log('Homepage source assembled; JavaScript and CSS checks passed.');
}
