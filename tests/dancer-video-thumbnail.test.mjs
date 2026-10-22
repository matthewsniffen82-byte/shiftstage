import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const requireTest = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerVideoThumbnail.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(initial) {
  const slots = [], effects = [], primed = [];
  let cursor = 0, dirty = true, tree, props = initial, onIntersection;
  const hooks = { ...React,
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = next; dirty = true; }]; },
    useRef() { const index = cursor++; return slots[index] ||= { current: {} }; },
    useEffect(effect, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) { effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: effect() }; }); } },
  };
  class Observer { constructor(callback) { onIntersection = callback; } observe() {} disconnect() {} }
  const exports = {};
  vm.runInNewContext(code, { exports, URL, IntersectionObserver: Observer, require: name => name === "react" ? hooks : name === "./dancer-profile-media-sync" ? { primeVideoPreviewFrame: video => primed.push(video) } : requireTest(name) });
  function render() { let count = 0; while (dirty) { if (++count > 10) throw Error("Unexpected render loop"); dirty = false; cursor = 0; tree = exports.default(props); effects.splice(0).forEach(effect => effect()); } }
  render();
  return {
    primed,
    get media() { return React.Children.toArray(tree.props.children).find(child => child.type === "video" || child.type === "img"); },
    visible() { onIntersection?.([{ isIntersecting: true }]); render(); },
    update(next) { props = next; dirty = true; render(); },
    flush: render,
  };
}

test("missing video posters load a silent first frame only when the preview is visible", () => {
  const ui = harness({ videoUrl: "/private-video.mp4?token=first" });
  assert.equal(ui.media, undefined);
  ui.visible();
  assert.equal(ui.media.type, "video");
  assert.equal(ui.media.props.preload, "metadata");
  assert.equal(ui.media.props.muted, true);
  assert.equal(ui.media.props.autoPlay, undefined);
  const video = {};
  ui.media.props.onLoadedMetadata({ currentTarget: video });
  assert.deepEqual(ui.primed, [video]);
  ui.update({ videoUrl: "/private-video.mp4?token=renewed" });
  assert.equal(ui.media.props.src, "/private-video.mp4?token=first", "polling must not restart the preview");
  ui.update({ videoUrl: "/private-video.mp4?token=renewed", posterUrl: "/approved.webp" });
  assert.equal(ui.media.type, "img");
  assert.equal(ui.media.props.src, "/approved.webp");
});

test("a broken poster uses the video frame and a replacement poster is accepted", () => {
  const ui = harness({ videoUrl: "/video.mp4", posterUrl: "/missing.webp" });
  assert.equal(ui.media.type, "img");
  ui.media.props.onError(); ui.flush(); ui.visible();
  assert.equal(ui.media.type, "video");
  ui.update({ videoUrl: "/video.mp4", posterUrl: "/replacement.webp" });
  assert.equal(ui.media.type, "img");
  assert.equal(ui.media.props.src, "/replacement.webp");
});

test("status polling keeps a loaded poster stable and renews it only after a load failure", () => {
  const ui=harness({videoUrl:'/video.mp4',posterUrl:'/poster.webp?preview=first'});
  ui.update({videoUrl:'/video.mp4',posterUrl:'/poster.webp?preview=renewed'});
  assert.equal(ui.media.props.src,'/poster.webp?preview=first');
  ui.media.props.onError();ui.flush();
  assert.equal(ui.media.props.src,'/poster.webp?preview=renewed');
  ui.update({videoUrl:'/different.mp4',posterUrl:'/different.webp?preview=new'});
  assert.equal(ui.media.props.src,'/different.webp?preview=new');
});

test("a failed video frame retries with a renewed URL without restarting other previews", () => {
  const ui=harness({videoUrl:'/video.mp4?preview=first'});ui.visible();
  ui.update({videoUrl:'/video.mp4?preview=renewed'});
  assert.equal(ui.media.props.src,'/video.mp4?preview=first');
  ui.media.props.onError();ui.flush();
  assert.equal(ui.media.props.src,'/video.mp4?preview=renewed');
});
