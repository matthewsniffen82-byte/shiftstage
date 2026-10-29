import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaBatchSubmission.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./dashboard-session'?{}:require(n)});
test('off-shift updates explain automatic submission without offering a send button',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:false}));
 assert.match(html,/Saved for check-in/);assert.match(html,/automatically when you tap in/);assert.equal(html.includes('>Submit media updates</button>'),false);
});
test('checked-in editing still offers the explicit batch Submit button',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:true}));
 assert.ok(html.includes('>Submit media updates</button>'));assert.doesNotMatch(html,/Saved for check-in/);
});
