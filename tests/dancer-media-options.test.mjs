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
  vm.runInNewContext(compile(read("app/dashboard/DancerMediaPinButton.tsx")), {
    exports,
    require:() => ({ jsx:(type, props) => ({type, props}), jsxs:(type, props) => ({type, props}) }),
  });
  const tree = exports.default({ label:"photo 2", onClick:() => calls.push("pin"), ...props });
  return { tree, calls };
}

test("the pin icon is a direct accessible toggle that reflects saved state", () => {
  for (const pinned of [false, true]) {
    const m = pinFixture({pinned});
    assert.equal(m.tree.type, "button");
    assert.equal(m.tree.props.type, "button");
    assert.equal(m.tree.props["aria-label"], `${pinned ? "Unpin" : "Pin"} photo 2`);
    assert.equal(m.tree.props["aria-pressed"], pinned);
    assert.equal(m.tree.props["data-pinned"], pinned);
    assert.equal(m.tree.props.children.props.children.type, "svg");
    assert.deepEqual(m.calls, []);
    m.tree.props.onClick({stopPropagation() {}});
    assert.deepEqual(m.calls, ["pin"]);
  }
});

test("pin clicks and keyboard activation do not trigger media playback", () => {
  const m = pinFixture();
  let stopped = 0;
  m.tree.props.onClick({stopPropagation:() => stopped++});
  m.tree.props.onKeyDown({key:"Enter", stopPropagation:() => stopped++});
  assert.equal(stopped, 2);
  assert.deepEqual(m.calls, ["pin"]);
});

test("disabled, busy, and unapproved media keep their icons without submitting a pin", () => {
  for (const props of [{disabled:true}, {busy:true}, {available:false}]) {
    const m = pinFixture(props);
    m.tree.props.onClick({stopPropagation() {}});
    assert.equal(m.tree.props.disabled, true);
    assert.equal(m.tree.props["aria-busy"], !!props.busy);
    if (props.available === false) assert.match(m.tree.props.title, /available after approval/);
    assert.deepEqual(m.calls, []);
  }
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
