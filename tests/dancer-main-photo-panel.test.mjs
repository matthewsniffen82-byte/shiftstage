import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mapping = {};
runInNewContext(compile("app/dashboard/DancerPhotoPanel.tsx"), { exports: mapping, require: () => ({}) });
const code = compile("app/dashboard/DancerMainPhotoPanel.tsx");
const main = { id: "main", imageUrl: "/main.jpg", is_primary: true, review_status: "approved" };
const pending = { id: "review", previewUrl: "/private-review.jpg", is_primary: true, status: "pending_review" };

function fixture(profile = {}, result) {
  const slots = [], exports = {}, uploads = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = next; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect() {},
  };
  runInNewContext(code, {
    exports, AbortController, Error, crypto: globalThis.crypto,
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "./DancerPhotoPanel") return mapping;
      if (name === "./DancerSavedPhotoCrop") return { default: "SavedCrop" };
      if (name === "./main-profile-photo-upload") return { uploadMainProfilePhoto: async (...args) => { uploads.push(args); return result; } };
      if (name.endsWith(".css")) return {};
      throw new Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.DancerMainPhotoPanel({ profile, onProfileChange: next => { profile = next; } });
  }
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  render();
  return {
    uploads,
    get image() { return nodes().find(node => node.type === "img"); },
    get button() { return nodes().find(node => node.type === "button"); },
    get crop() { return nodes().find(node => node.type === "SavedCrop"); },
    get status() { return nodes().find(node => node.props?.role === "status").props.children; },
    update(next) { profile = next; render(); },
    async upload() {
      nodes().find(node => node.type === "input").props.onChange({ target: { files: [new File(["photo"], "main.jpg", { type: "image/jpeg" })], value: "" } });
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
  };
}

test("a first main upload appears in the main slot while awaiting approval, including after reload", async () => {
  const profile = { pending_photo_reviews: [pending] };
  const ui = fixture({}, { decision: "review", profile });
  await ui.upload();
  for (const view of [ui, fixture(profile)]) {
    assert.equal(view.image.props.src, pending.previewUrl);
    assert.equal(view.image.props.alt, "Main photo awaiting approval");
    assert.equal(view.button.props.children, "Awaiting approval");
    assert.equal(view.button.props.disabled, true);
    assert.equal(view.crop, undefined);
    assert.match(view.status, /awaiting approval/);
  }
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
  assert.equal(ui.button.props.disabled, false);
  assert.ok(ui.crop);
  assert.doesNotMatch(ui.status, /awaiting approval/);
});

test("a pending main replacement previews privately without changing the approved profile data", () => {
  const profile = { dancer_photos: [main], pending_photo_reviews: [pending] };
  const ui = fixture(profile);
  assert.equal(ui.image.props.src, pending.previewUrl);
  assert.equal(profile.dancer_photos[0], main);
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
});

test("pending gallery photos do not occupy or disable the main photo slot", () => {
  const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [{ ...pending, is_primary: false, sort_order: 2 }] });
  assert.equal(ui.image.props.src, main.imageUrl);
  assert.equal(ui.button.props.disabled, false);
  assert.ok(ui.crop);
});

test("a main upload identified by its upload context still appears in the main slot", () => {
  const ui = fixture({ pending_photo_reviews: [{ ...pending, is_primary: undefined, upload_context: "main_profile_photo" }] });
  assert.equal(ui.image.props.src, pending.previewUrl);
});
