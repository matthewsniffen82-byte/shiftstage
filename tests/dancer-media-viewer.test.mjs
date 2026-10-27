import assert from "node:assert/strict";
import { readFileSync } from "./helpers/dashboard-test-fs.mjs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";

const source = readFileSync(new URL("../app/dashboard/DancerMediaViewer.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(props = {}) {
  const calls = [], effects = [], exports = {};
  const states = [];
  let cursor = 0;
  class Trigger { isConnected = true; focus(options) { calls.push(["focus", options.preventScroll]); } }
  vm.runInNewContext(code, {
    exports, HTMLElement: Trigger, document: { activeElement: new Trigger() },
    require: name => name === "../components/StableVideo" ? { default: "video" } : name === "react" ? {
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
      },
      useRef: () => ({ current: { showModal: () => calls.push("open"), close: () => calls.push("close") } }),
      useEffect: effect => effects.push(effect),
    } : { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  });
  return { calls, effects, render: () => {
    cursor = 0;
    return exports.default({ kind: "photo", label: "Photo 2", imageUrl: "/photo.jpg", onClose: () => calls.push("dismiss"), ...props });
  } };
}

test("one selected photo or video opens directly without another gallery or uploader", () => {
  for (const kind of ["photo", "video"]) {
    const ui = fixture({ kind, label: `${kind} 2`, videoUrl: "/video.mp4" });
    const tree = ui.render();
    assert.equal(tree.type, "dialog");
    assert.equal(tree.props["aria-label"], `${kind} 2 preview`);
    const media = kind === "photo" ? tree.props.children[1] : tree.props.children[1].props.children[0];
    assert.equal(media.type, kind === "photo" ? "img" : "video");
    assert.equal(media.props.src, kind === "photo" ? "/photo.jpg" : "/video.mp4");
    if (kind === "video") {
      assert.equal(media.props.autoPlay, true);
      assert.equal(media.props.controls, true);
      assert.equal(media.props.playsInline, true);
    }
  }
});

test("closing the preview preserves its parent editor and restores the thumbnail focus", () => {
  const ui = fixture(), tree = ui.render();
  const cleanup = ui.effects[0]();
  let stopped = 0, prevented = 0;
  tree.props.onKeyDown({ key: "Escape", stopPropagation() { stopped++; } });
  tree.props.onKeyDown({ key: "Tab", stopPropagation() { stopped++; } });
  tree.props.onCancel({ preventDefault() { prevented++; } });
  assert.equal(stopped, 2);
  assert.equal(prevented, 1);
  assert.deepEqual(ui.calls, ["open", "dismiss"]);
  cleanup();
  assert.deepEqual(ui.calls, ["open", "dismiss", "close", ["focus", true]]);
  tree.props.children[0].props.children[1].props.onClick();
  assert.equal(ui.calls.at(-1), "dismiss");
});

test("missing or failed media stays closable and never falls back to the upload box", () => {
  const missing = fixture({ imageUrl: null }).render();
  assert.equal(missing.props.children[1].props.role, "status");
  const ui = fixture({ kind: "video", videoUrl: "/video.mp4" });
  ui.render().props.children[1].props.children[0].props.onError();
  const failed = ui.render();
  assert.equal(failed.props.children[1].type, "p");
  assert.equal(failed.props.children[0].props.children[1].props["aria-label"], "Close media preview");
});

test("a video opens with its poster, native controls and a visible loading state", () => {
  for (const imageUrl of ["/poster.jpg", null]) {
    const ui = fixture({ kind: "video", videoUrl: "/video.mp4", imageUrl });
    const frame = () => ui.render().props.children[1];
    const video = () => frame().props.children[0];
    assert.equal(frame().props.className, "dancer-media-viewer-video");
    assert.equal(frame().props["aria-busy"], true);
    assert.equal(frame().props.children[1].props.role, "status");
    assert.equal(frame().props.children[1].props.children, "Loading video…");
    assert.equal(video().props.poster, imageUrl || undefined);
    assert.equal(video().props.preload, "auto");
    assert.equal(video().props.controls, true);
    video().props.onLoadedData();
    assert.equal(frame().props["aria-busy"], false);
    assert.equal(frame().props.children[1], null);
    video().props.onWaiting();
    assert.equal(frame().props["aria-busy"], true);
    video().props.onPlaying();
    assert.equal(frame().props["aria-busy"], false);
    video().props.onWaiting();
    video().props.onCanPlay();
    assert.equal(frame().props["aria-busy"], false, "ready native controls remain usable when autoplay is blocked");
  }
});

test("the video area has height before metadata arrives and loading never blocks native controls", () => {
  const tree = fixture({ kind: "video", videoUrl: "/video.mp4", imageUrl: null }).render();
  const css = postcss.parse(tree.props.children.at(-1).props.children);
  const rules = {};
  css.walkRules(rule => { rules[rule.selector] = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])); });
  const frame = rules[".dancer-media-viewer-video"];
  assert.equal(frame.height, "min(70dvh,640px)");
  assert.equal(frame["max-height"], "calc(100dvh - 116px)");
  assert.equal(rules[".dancer-media-viewer-video > video"]["object-fit"], "contain");
  assert.equal(rules[".dancer-media-viewer-video > .dancer-media-viewer-loading"]["pointer-events"], "none");
});

test("the profile editor yields its document-level keyboard handling while a media preview is open", () => {
  const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  const editor = dashboard.slice(dashboard.indexOf("function DancerProfilePreview("));
  const handler = editor.slice(editor.indexOf("    const onKeyDown ="), editor.indexOf('    document.addEventListener("keydown", onKeyDown)'));
  let closed = 0;
  for (const previewOpen of [true, false]) {
    const context = vm.createContext({
      document: { querySelector: () => null },
      overlayRef: { current: { querySelector: selector => { assert.equal(selector, "dialog.dancer-media-viewer[open]"); return previewOpen ? {} : null; } } },
      activeEditorSectionRef: { current: null }, closePreview: () => { closed++; },
    });
    vm.runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    vm.runInContext('onKeyDown({key:"Escape"})', context);
    if (previewOpen) {
      vm.runInContext('onKeyDown({key:"Tab"})', context);
      assert.equal(closed, 0);
    }
  }
  assert.equal(closed, 1);
});
