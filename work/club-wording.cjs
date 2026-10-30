const fs = require('node:fs');
const cp = require('node:child_process');
const ts = require('typescript');
const files = cp.execFileSync('rg', ['--files', 'app', 'src', 'public'], {encoding:'utf8'}).trim().split(/\r?\n/).map(f=>f.replace(/\\/g,'/')).filter(f=>/\.(tsx?|[cm]?js|html|json)$/.test(f) && !/(?:^|\/)(generated|outputs)\//.test(f));
const rows=[];
for(const file of files) {
  const source=fs.readFileSync(file,'utf8');
  if(!/\bvenues?\b/i.test(source)) continue;
  if(/\.(html|json)$/.test(file)) continue;
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  function visit(node) {
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)||ts.isJsxText(node)) {
      const text=node.text;
      const matches=[...text.matchAll(/(?<![\w./#_:-])venues?(?![\w/_.-])/gi)];
      if(matches.length) rows.push({file,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,start:node.getStart(ast),end:node.end,kind:ts.SyntaxKind[node.kind],parent:ts.SyntaxKind[node.parent.kind],attribute:ts.isJsxAttribute(node.parent)?node.parent.name.getText(ast):null,property:ts.isPropertyAssignment(node.parent)?node.parent.name.getText(ast):null,text,context:source.slice(Math.max(0,node.getStart(ast)-65),Math.min(source.length,node.end+35)).replace(/\s+/g,' ')});
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
}
fs.writeFileSync('work/club-wording-candidates.json',JSON.stringify(rows,null,2));
console.log('Candidates:',rows.length,'Files:',new Set(rows.map(r=>r.file)).size);
for(const [i,r] of rows.entries()) if(!/^(venues?|[Vv]enue:)$/.test(r.text.trim())) console.log(i+' '+r.file+':'+r.line+' '+JSON.stringify(r.text.length>240?r.text.slice(0,240)+'…':r.text));
