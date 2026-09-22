import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerProfileEditor.tsx", import.meta.url), "utf8");
const workspace = source.slice(source.indexOf("export function DancerOnboardingProfileMediaWorkspace("));
const code = ts.transpileModule(workspace, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];

function fixture({ ready = true, storedDraft } = {}) {
  const slots = [], effects = [], storage = new Map();
  let cursor = 0, saveSucceeds = true;
  const exports = {};
  const Preview = ({ buttonLabel }) => React.createElement("button", null, buttonLabel);
  const props = {
    profile: { id: "fixture", identity_saved_at: ready ? "2026-09-22" : null, stage_name: ready ? "Dancer" : "", city: ready ? "Las Vegas" : "", avatarPhotoUrl: ready ? "/avatar.jpg" : "", dancer_photos: ready ? [{ status: "approved" }] : [] },
    draftIdentity: { stageName: ready ? "Dancer" : "", city: ready ? "Las Vegas" : "" },
    profileReady: ready, continueToAgreement() {}, identityContent: () => null,
  };
  if (storedDraft) storage.set(`mydancr:dancer-${storedDraft}-draft:fixture`, "{\"changed\":true}");
  vm.runInNewContext(code, {
    exports, require, Boolean, String,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useCallback: fn => fn,
    useEffect: fn => effects.push(fn),
    persistedDancerStageName: profile => profile.identity_saved_at ? profile.stage_name : "",
    dancerPhotoItemsFromProfile: profile => profile.dancer_photos,
    dancerStepOneStateLabel: state => state,
    DancerProfilePreview: Preview,
    saveDancerProfileEditor: async () => saveSucceeds,
    window: { localStorage: { getItem: key => storage.get(key) ?? null } },
  });
  const render = () => { cursor = 0; effects.length = 0; return exports.DancerOnboardingProfileMediaWorkspace(props); };
  const hydrate = () => { render(); effects.splice(0).forEach(effect => effect()); return render(); };
  const status = tree => renderToStaticMarkup(walk(tree).find(node => node.props.role === "status"));
  const editor = tree => walk(tree).find(node => node.type === Preview).props;
  return { props, render, hydrate, status, editor, storage, failSave() { saveSucceeds = false; } };
}

test("a persisted, complete profile shows saved beside the heading after checking for drafts", () => {
  const f = fixture();
  assert.doesNotMatch(f.status(f.render()), /Profile saved/);
  const tree = f.hydrate();
  assert.match(f.status(tree), /aria-hidden="true">✓<\/span> Profile saved/);
  assert.match(f.status(tree), /aria-live="polite"/);
  assert.doesNotMatch(f.status(tree), /Unsaved changes/);
  assert.match(renderToStaticMarkup(tree), /Profile details<\/strong><span class="dancer-profile-save-indicator"/);
});

test("new and incomplete profiles are never labelled saved", () => {
  const f = fixture({ ready: false });
  assert.doesNotMatch(f.status(f.hydrate()), /Profile saved/);
  f.props.draftIdentity = { stageName: "New dancer", city: "Las Vegas" };
  assert.match(f.status(f.render()), /Unsaved changes/);
});

test("edits remain unsaved after a failed save and clear only when persisted values match", async () => {
  const f = fixture(); f.hydrate();
  f.props.draftIdentity = { ...f.props.draftIdentity, stageName: "Updated dancer" };
  assert.match(f.status(f.render()), /Unsaved changes/);
  f.failSave();
  assert.equal(await f.editor(f.render()).onEditorSave(), false);
  assert.match(f.status(f.render()), /Unsaved changes/);
  f.props.profile = { ...f.props.profile, stage_name: "Updated dancer" };
  assert.match(f.status(f.hydrate()), /Profile saved/);
});

test("stored identity and social drafts survive a reload and refresh when the editor closes", () => {
  for (const storedDraft of ["profile", "social"]) {
    const f = fixture({ storedDraft });
    assert.match(f.status(f.hydrate()), /Unsaved changes/);
    f.storage.clear();
    f.editor(f.render()).onClose();
    assert.match(f.status(f.render()), /Profile saved/);
  }
});
