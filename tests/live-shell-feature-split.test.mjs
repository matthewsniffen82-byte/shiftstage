import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { extractLiveShellAppScript } from "../src/lib/dancr/live-shell-script.mjs";
import { splitLiveShellScript, LIVE_SHELL_FEATURE_FUNCTIONS, LIVE_SHELL_ASYNC_FEATURES } from "../scripts/lib/split-live-shell-script.mjs";
import { publicVideoLoaders } from "./helpers/public-video-loaders.mjs";

const source = extractLiveShellAppScript(readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8"));
const split = splitLiveShellScript(source);

test("TV constructors move intact into a side-effect-free classic script", () => {
  const feature = ts.createSourceFile("tv.js", split.features.tv, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(feature.statements.length, LIVE_SHELL_FEATURE_FUNCTIONS.tv.length);
  assert.ok(feature.statements.every(ts.isFunctionDeclaration));
  for (const name of LIVE_SHELL_FEATURE_FUNCTIONS.tv) {
    assert.ok(!split.main.includes(`function ${name}(`));
    assert.ok(split.features.tv.includes(`function ${name}(`));
  }
  assert.doesNotThrow(() => new vm.Script(split.main));
  assert.doesNotThrow(() => new vm.Script(split.features.tv));
});

test("a new ungated caller fails generation instead of publishing a broken initial shell", () => {
  assert.throws(() => splitLiveShellScript(source + "\ncreateHomeTvFeedCopy({});"), /outside its boundary/);
});

test("async actions preserve arguments, receiver and return values after lazy loading, and recover after failure", async () => {
  const file = ts.createSourceFile('main.js', split.main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const [feature,names] of Object.entries(LIVE_SHELL_ASYNC_FEATURES)) {
    const declarations = ts.createSourceFile('feature.js',split.features[feature],99,true,1).statements;
    assert.equal(declarations.length,names.length);assert.ok(declarations.every(ts.isFunctionDeclaration));
    let attempts=0;const notices=[];
    const name=names[0],node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===name);
    const context=vm.createContext({showToast:m=>notices.push(m),loadLiveShellFeature:async key=>{
      assert.equal(key,feature);if(++attempts===1)throw Error('offline');
      vm.runInContext(`async function ${name}(...args) { return [this.marker,...args]; }`,context);
    }});
    vm.runInContext(split.main.slice(node.pos,node.end),context);
    const original=context[name];await assert.rejects(original.call({marker:1},'a'),/offline/);
    assert.deepEqual(notices,['offline']);
    assert.deepEqual(Array.from(await original.call({marker:2},'a',3)),[2,'a',3]);
  }
});

function loaderFixture() {
  const scripts = [];
  const loader = source.slice(source.indexOf("    const LIVE_SHELL_FEATURE_URLS"), source.indexOf("    async function loadHomeTvFeed("))
    .replace("Object.freeze({})", 'Object.freeze({tv:"/live-shell-feature.js?feature=tv&v=fixture"})');
  const context = vm.createContext({ document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild: script => scripts.push(script) },
  } });
  vm.runInContext(loader, context);
  return { scripts, load: () => context.loadLiveShellFeature("tv") };
}

test("TV code loads only on demand, deduplicates concurrent visits, and stays loaded", async () => {
  const f = loaderFixture();
  assert.equal(f.scripts.length, 0);
  const first = f.load();
  assert.equal(f.load(), first);
  assert.equal(f.scripts.length, 1);
  f.scripts[0].onload();
  await first;
  assert.equal(f.load(), first);
  assert.equal(f.scripts.length, 1);
});

test("a failed or obsolete feature chunk can recover without a rejected promise being cached", async () => {
  const f = loaderFixture();
  const failed = f.load();
  const rejected = assert.rejects(failed, error => error.code === "SHELL_FEATURE_UNAVAILABLE");
  f.scripts[0].onerror();
  await rejected;
  assert.equal(f.scripts[0].removed, true);
  const retry = f.load();
  assert.notEqual(retry, failed);
  f.scripts[1].onload();
  await retry;
});

test("feed data and TV code load concurrently, and rendering waits for both", async () => {
  const { context, requests, renders } = publicVideoLoaders();
  let resolveFeature;
  context.loadLiveShellFeature = () => new Promise(resolve => { resolveFeature = resolve; });
  const pending = context.loadHomeTvFeed("Vegas", "", "");
  assert.equal(requests.length, 1);
  assert.equal(typeof resolveFeature, "function");
  requests[0].resolve([{ id: "clip", videoUrl: "/clip", dancer: { stageName: "Dancer" } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.homeTvFeedStatus, "loading");
  assert.equal(renders.length, 0);
  resolveFeature();
  await pending;
  assert.equal(context.homeTvFeedStatus, "ready");
  assert.deepEqual(renders, ["Vegas"]);
});

test("late feature loading never restores a feed after navigation away", async () => {
  const { context, requests, renders } = publicVideoLoaders();
  let resolveFeature;
  context.loadLiveShellFeature = () => new Promise(resolve => { resolveFeature = resolve; });
  const pending = context.loadHomeTvFeed("Vegas", "", "");
  requests[0].resolve([]);
  context.activeTab = "dancers";
  context.homeTvFeedRequest++;
  resolveFeature();
  await pending;
  assert.deepEqual(renders, []);
});
