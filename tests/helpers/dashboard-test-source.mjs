import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Existing behavior tests extract functions from a single source string. Build
// that view from the real modules, never from a frozen copy of the old component.
// Module loading itself is exercised separately by dashboard-module-boundaries.
let cached;
export function readDashboardTestSource() {
  if (cached) return cached;
  const order = JSON.parse(readFileSync(new URL('./dashboard-declaration-order.json', import.meta.url), 'utf8'));
  const sources = new Map();
  const imports = new Map();
  for (const file of new Set(order.map(entry => entry.file))) {
    const text = readFileSync(new URL('../../app/dashboard/' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    sources.set(file, ast);
    for (const node of ast.statements.filter(ts.isImportDeclaration)) {
      const path = node.moduleSpecifier.text;
      if (order.some(entry => path === './' + entry.file.replace(/\.tsx?$/, ''))) continue;
      const clause = node.importClause;
      if (!clause) { imports.set('side:' + path, node.getText(ast)); continue; }
      if (clause.name) imports.set(clause.name.text, 'import ' + (clause.isTypeOnly ? 'type ' : '') + clause.name.text + ' from ' + JSON.stringify(path) + ';');
      for (const specifier of clause.namedBindings?.elements || []) imports.set(specifier.name.text, 'import ' + (clause.isTypeOnly ? 'type ' : '') + '{ ' + specifier.getText(ast) + ' } from ' + JSON.stringify(path) + ';');
    }
  }
  const name = node => node.name?.text || (ts.isVariableStatement(node) ? node.declarationList.declarations.map(item => item.name.text).join(',') : '');
  const declarations = order.map(entry => {
    const ast = sources.get(entry.file);
    const node = ast.statements.find(item => name(item) === entry.name);
    assert.ok(node, 'Missing real dashboard declaration: ' + entry.name);
    return node.getFullText(ast).replace(/\bexport (?!default\b)/, '');
  });
  cached = '"use client";\n' + [...imports.values()].join('\n') + '\n' + declarations.join('\n') + '\n';
  return cached;
}
export const isDashboardSource = path => String(path).replaceAll('\\', '/').endsWith('/app/dashboard/DashboardClient.tsx') || String(path) === 'app/dashboard/DashboardClient.tsx';
