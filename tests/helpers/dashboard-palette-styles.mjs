import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

export function dashboardStyleFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? dashboardStyleFiles(path) : /\.(css|tsx)$/.test(path) ? [path] : [];
  });
}

// Read component-owned CSS, including style constants assembled from string arrays.
export function dashboardStyleBlocks(file, text = readFileSync(file, 'utf8')) {
  if (file.endsWith('.css')) return [{ text, start: 0, end: text.length }];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const blocks = [];
  function visit(node) {
    if ((ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) &&
      /^\s*(?:\.|#|body|html|@media|dialog|:root)/.test(node.text) && /\{[^}]*\b(?:background|border|color):/.test(node.text)) {
      blocks.push({ text: node.text, start: node.getStart(source) + 1, end: node.end - 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return blocks;
}
