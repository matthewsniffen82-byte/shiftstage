import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("../src/lib/dancr/video-moderation.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("video-moderation.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "moderateFrames");
assert.ok(fn);
function load(moderateFrame) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fn.getText(ast) + "\nexport { moderateFrames };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Promise, Error, FRAME_MODERATION_CONCURRENCY: 3, moderateFrame });
  return exports.moderateFrames;
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test("a failed frame waits for active workers and stops assigning remaining frames", async () => {
  const failure = new Error("Synthetic terminal frame failure"), releases = [];
  let calls = 0, active = 0, settled = false;
  const moderateFrames = load(async (_client, _frame, index) => {
    calls++;
    if (index === 0) throw failure;
    if (index >= 3) return { index };
    active++;
    await new Promise(resolve => releases.push(resolve));
    active--;
    return { index };
  });
  const result = moderateFrames({}, Array.from({ length: 10 }, (_, index) => index))
    .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    await turn();
    assert.equal(calls, 3);
    assert.equal(active, 2);
    assert.equal(settled, false, "The caller must retain ownership until its workers finish.");
    releases.forEach(release => release());
    assert.equal((await result).error, failure);
    assert.equal(active, 0);
    assert.equal(calls, 3, "Remaining frames must not start after a terminal failure.");
  } finally { releases.forEach(release => release()); await result; await turn(); }
});

test("successful out-of-order workers preserve frame order and concurrency limit", async () => {
  const releases = new Map();
  let active = 0, peak = 0;
  const moderateFrames = load(async (_client, _frame, index) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.set(index, resolve));
    active--;
    return { index };
  });
  const pending = moderateFrames({}, [0, 1, 2, 3, 4]);
  await turn();
  releases.get(2)(); await turn();
  releases.get(1)(); await turn();
  releases.get(4)(); releases.get(3)(); releases.get(0)();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), [0, 1, 2, 3, 4].map(index => ({ index })));
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("empty frame work starts no provider requests", async () => {
  let calls = 0;
  const moderateFrames = load(async () => { calls++; return {}; });
  assert.deepEqual(Array.from(await moderateFrames({}, [])), []);
  assert.equal(calls, 0);
});
