import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerIdentityEditor.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];

function fixture({ valid = true, save = async () => true } = {}) {
  const slots = [];
  let cursor = 0, effects = [], dirty = true, tree, saves = 0, closes = 0, currentDialog;
  const document = { body: { style: { overflow: "auto" } } };
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { if (this.open) { this.open = false; currentDialog.props.onClose({ currentTarget: this }); } },
    querySelector: () => ({ reportValidity: () => valid }),
  };
  const hooks = {
    ...React,
    useId: () => "identity-title",
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const exports = {};
  runInNewContext(code, { exports, document, require(name) {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./DashboardShared") return { saveDancerProfileEditor: () => { saves++; return save(); } };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  function render() {
    for (let i = 0; dirty && i < 20; i++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.default({ children: React.createElement("form", { "data-identity-fields": true }), onClose: () => { closes++; } });
      const nextDialog = elements(tree).find(node => node.type === "dialog");
      if (nextDialog) { currentDialog = nextDialog; nextDialog.props.ref.current = dialog; }
      else if (currentDialog) currentDialog.props.ref.current = null;
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false);
    return elements(tree);
  }
  render();
  return {
    render, dialog, document,
    counts: () => ({ saves, closes }),
    open() { render().find(node => node.type === "button").props.onClick(); return render(); },
    submit() { currentDialog.props.onSubmitCapture({ preventDefault() {}, stopPropagation() {} }); },
    cancel() { let prevented = false; currentDialog.props.onCancel({ preventDefault() { prevented = true; } }); if (!prevented) dialog.close(); render(); return prevented; },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("Edit mounts only the identity form and closes directly after saving, without media prerequisites", async () => {
  const f = fixture();
  assert.equal(f.render().some(node => node.type === "form"), false);
  const opened = f.open();
  assert.equal(f.dialog.open, true);
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(opened.filter(node => node.type === "form").length, 1);
  assert.equal(opened.some(node => /preview|media-upload|carousel/.test(String(node.props.className))), false);
  f.submit(); await settle(); f.render();
  assert.deepEqual(f.counts(), { saves: 1, closes: 1 });
  assert.equal(f.dialog.open, false);
  assert.equal(f.document.body.style.overflow, "auto");
});

test("invalid identity fields never start a save", () => {
  const f = fixture({ valid: false }); f.open(); f.submit(); f.render();
  assert.equal(f.counts().saves, 0);
  assert.equal(f.dialog.open, true);
});

for (const failure of [false, new Error("Connection lost. Try again.")]) test(`failed identity save stays in the dialog: ${String(failure)}`, async () => {
  const f = fixture({ save: async () => { if (failure instanceof Error) throw failure; return failure; } });
  f.open(); f.submit(); await settle();
  const nodes = f.render();
  assert.equal(f.dialog.open, true);
  assert.equal(f.counts().closes, 0);
  assert.ok(nodes.some(node => node.props.role === "status" && node.props.children));
  assert.equal(f.cancel(), false);
  assert.equal(f.dialog.open, false);
});

test("a pending save rejects duplicate submits and Escape, then returns to the dropdown", async () => {
  let resolve;
  const f = fixture({ save: () => new Promise(done => { resolve = done; }) });
  f.open(); f.submit(); f.submit();
  assert.equal(f.counts().saves, 1);
  assert.equal(f.render().find(node => node.type === "fieldset").props.disabled, true);
  assert.equal(f.cancel(), true);
  resolve(true); await settle(); f.render();
  assert.deepEqual(f.counts(), { saves: 1, closes: 1 });
});
