import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync('app/components/SamsungBrandFill.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(userAgent, canvasAvailable = true) {
  let effect, painted = false;
  const paint = { fillStyle: '', fillRect(...args) { this.rect = args; } };
  const canvas = { parentElement: {}, getContext: () => canvasAvailable ? paint : null };
  const exports = {};
  vm.runInNewContext(source, { exports, navigator: { userAgent },
    getComputedStyle: () => ({ getPropertyValue: () => '#6d28ff' }),
    require: name => name === 'react' ? {
      useRef: () => ({ current: canvas }), useEffect: fn => { effect = fn; },
      useState: () => [painted, value => { painted = value; }],
    } : require(name),
  });
  return { draw: () => exports.default(), mount: () => effect(), paint };
}

test('Samsung badge fills paint the exact Free Entry token after mounting', () => {
  const f = fixture('Android SamsungBrowser/30.0');
  assert.equal(f.draw().props.style.display, 'none', 'hydration starts with the normal CSS fill');
  f.mount();
  const canvas = f.draw();
  assert.equal(canvas.props.style.display, 'block');
  assert.equal(canvas.props.style.pointerEvents, 'none');
  assert.equal(canvas.props['aria-hidden'], 'true');
  assert.equal(f.paint.fillStyle, '#6d28ff');
  assert.deepEqual(f.paint.rect, [0, 0, 1, 1]);
});

test('Safari, Chrome and unavailable canvas keep the existing badge appearance', () => {
  for (const [agent, available] of [['iPhone Safari/604.1', true], ['Android Chrome/143.0', true], ['Android SamsungBrowser/30.0', false]]) {
    const f = fixture(agent, available);
    f.draw(); f.mount();
    assert.equal(f.draw().props.style.display, 'none');
    assert.equal(f.paint.rect, undefined);
  }
});
