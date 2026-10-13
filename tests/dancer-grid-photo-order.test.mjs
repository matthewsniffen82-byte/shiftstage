import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync('src/live-shell/app/19-reset-home-discovery-feed-qr-prompt.js','utf8');
const ast=ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='spreadDancerGridPhotos');
const context={};vm.runInNewContext(fn.getText(ast),context);
test('the photo rendering helper preserves the chosen profile order even with repeated photos',()=>{
 const profiles=[{id:'a',photo:'same'},{id:'b',photo:'same'},{id:'c',photo:'other'},{id:'70e50bad-b7be-45ad-bc7a-64f1cba6b5e2',photo:'same'}];
 for(const rows of [[],profiles.slice(0,1),profiles,profiles.map((r,i)=>({...r,discovery:{position:i}}))])
  assert.deepEqual(context.spreadDancerGridPhotos(rows),rows);
});
