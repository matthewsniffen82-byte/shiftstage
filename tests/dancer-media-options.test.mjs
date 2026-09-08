import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const carousel = read("app/dancers/[slug]/DancerPhotoCarousel.tsx");
const orderSource = carousel.slice(carousel.indexOf("function orderPinnedMedia"), carousel.indexOf("export function DancerPhotoCarousel"));
const p1 = "11111111-1111-4111-8111-111111111111";
const p2 = "22222222-2222-4222-8222-222222222222";
const v1 = "33333333-3333-4333-8333-333333333333";
const v2 = "44444444-4444-4444-8444-444444444444";
const photos = () => [{ id:p1, kind:"photo", sortOrder:0, isPrimary:true }, { id:p2, kind:"photo", sortOrder:1 }];
const videos = () => [{ id:v1, kind:"video", publishedAt:"2026-09-07" }, { id:v2, kind:"video", publishedAt:"2026-09-01" }];

function pinFixture(props = {}) {
  const calls = [];
  const exports = {};
  let open = false, lastOpen, cleanup;
  const listeners = new Map();
  const summary = { focus: () => calls.push("focus") };
  const root = { open: false, querySelector: () => summary, contains: target => target === summary || target === root };
  const other = { open: true };
  const hooks = {
    useRef: () => ({ current: root }),
    useState: () => [open, value => { open = value; }],
    useEffect: fn => { if (open === lastOpen) return; cleanup?.(); lastOpen = open; cleanup = fn(); },
  };
  vm.runInNewContext(compile(read("app/dashboard/DancerMediaPinButton.tsx")), {
    exports,
    require: name => name === "react" ? hooks : { jsx:(type, props) => ({type, props}), jsxs:(type, props) => ({type, props}) },
    document: {
      querySelectorAll: () => [root, other],
      addEventListener: (type, handler, capture) => listeners.set(`${type}:${!!capture}`, handler),
      removeEventListener: (type, _handler, capture) => listeners.delete(`${type}:${!!capture}`),
    },
  });
  const draw = () => exports.default({ label:"photo 2", onClick:() => calls.push("pin"), ...props });
  const tree = draw();
  return { tree, calls, root, other, listeners, summary: tree.props.children[0], action: tree.props.children[1].props.children,
    toggle(value) { root.open = value; tree.props.onToggle({ currentTarget: root, stopPropagation() {} }); draw(); },
  };
}

test("three dots open options and only the pin-icon action changes the saved state", () => {
  for (const pinned of [false, true]) {
    const m = pinFixture({pinned});
    assert.equal(m.tree.type, "details");
    assert.equal(m.summary.props["aria-label"], "Options for photo 2");
    assert.equal(m.tree.props["data-pinned"], pinned);
    const dots = m.summary.props.children.props.children;
    assert.equal(dots.type, "svg");
    assert.equal(dots.props.children.length, 3);
    assert.ok(dots.props.children.every(child => child.type === "circle"));
    assert.equal(m.action.props["aria-label"], `${pinned ? "Unpin" : "Pin"} photo 2`);
    assert.equal(m.action.props.children[0].type, "svg");
    assert.equal(m.action.props.children[1].props.children, pinned ? "Unpin" : "Pin");
    m.summary.props.onClick({ preventDefault: () => assert.fail("available options should open") });
    m.toggle(true);
    assert.deepEqual(m.calls, []);
    assert.equal(m.other.open, false, "opening another menu closes the previous one");
    m.action.props.onClick();
    assert.deepEqual(m.calls, ["focus", "pin"]);
    assert.equal(m.root.open, false);
  }
});

test("pin clicks and keyboard activation do not trigger media playback", () => {
  const m = pinFixture();
  let stopped = 0;
  m.tree.props.onClick({stopPropagation:() => stopped++});
  m.tree.props.onKeyDown({key:"Enter", stopPropagation:() => stopped++});
  assert.equal(stopped, 2);
  assert.deepEqual(m.calls, []);
});

test("disabled, busy, and unapproved media cannot submit a pin", () => {
  for (const props of [{disabled:true}, {busy:true}, {available:false}]) {
    const m = pinFixture(props);
    let prevented = false;
    m.summary.props.onClick({preventDefault: () => { prevented = true; }});
    m.action.props.onClick();
    assert.equal(m.action.props.disabled, true);
    assert.equal(m.summary.props["aria-busy"], !!props.busy);
    assert.equal(prevented, props.available !== false);
    if (props.available === false) assert.match(m.action.props.title, /available after approval/);
    assert.deepEqual(m.calls, []);
  }
});

test("Escape closes only the options and returns focus before the profile editor receives it", () => {
  const m = pinFixture();
  m.toggle(true);
  let prevented = false, stopped = false;
  m.listeners.get("keydown:true")({ key: "Escape", preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(m.root.open, false);
  assert.equal(prevented && stopped, true);
  assert.deepEqual(m.calls, ["focus"]);
  m.toggle(false);
  assert.equal(m.listeners.size, 0);
});

test("outside taps and moving keyboard focus away dismiss the options without pinning", () => {
  const m = pinFixture();
  m.toggle(true);
  m.listeners.get("pointerdown:false")({ target: m.root });
  assert.equal(m.root.open, true);
  m.listeners.get("pointerdown:false")({ target: {} });
  assert.equal(m.root.open, false);
  m.toggle(true);
  m.tree.props.onBlur({ currentTarget: m.root, relatedTarget: {} });
  assert.equal(m.root.open, false);
  assert.deepEqual(m.calls, []);
});

test("public photo and video ordering still respects pins saved from the dashboard", () => {
  const context = vm.createContext({});
  vm.runInContext(compile(orderSource), context);
  for (const items of [photos(), videos()]) {
    items[1].isPinned = true;
    assert.equal(context.orderPinnedMedia(items)[0].id, items[1].id);
    items[1].isPinned = false;
    assert.equal(context.orderPinnedMedia(items)[0].id, items[0].id);
  }
});
