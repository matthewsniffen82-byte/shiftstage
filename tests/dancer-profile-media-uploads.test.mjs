import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/dashboard/DancerProfileMediaUploads.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireTest = createRequire(import.meta.url);
const staticHooks = { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {} };
function loadUploads({ hooks = staticHooks, api = {}, confirm = () => false } = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Error, window: { confirm }, require: name => name === "react" ? hooks : name === "./dashboard-session" ? api : requireTest(name) });
  return exports;
}
const exports = loadUploads();
const Uploads = exports.default;
const defaultProps = { photos: [], videos: [], isApproved: false, isPublic: false, isVideoLoading: false, videoError: "", onOpen() {}, onPhotoDeleted() {} };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Uploads, { ...defaultProps, ...props })).replace(/<style>[\s\S]*?<\/style>/g, "");

function buttons(node) {
  if (!React.isValidElement(node)) return [];
  return [node.type === "button" ? node : null, ...React.Children.toArray(node.props.children).flatMap(buttons)].filter(Boolean);
}

test("an empty profile offers exactly one photo control and one video control without placeholder tiles", () => {
  const html = render();
  assert.equal((html.match(/<button /g) || []).length, 2);
  assert.match(html, /Add photo/);
  assert.match(html, /Add video/);
  assert.equal((html.match(/Camera or phone files/g) || []).length, 2);
  assert.doesNotMatch(html, /<li|<img|<video/);
  assert.match(html, /after review and completion of your profile setup/);
});

test("both upload controls and existing thumbnails open the corresponding production manager", () => {
  const opened = [];
  const tree = Uploads({ ...defaultProps, photos: [{ id: "p", status: "approved" }], videos: [{ id: "v", status: "submitted" }], onOpen: (section) => opened.push(section) });
  const controls = buttons(tree).filter(button => button.props.className !== "profile-upload-delete");
  assert.equal(controls.length, 4);
  for (const control of controls) control.props.onClick();
  assert.deepEqual(opened, ["photos", "photos", "videos", "videos"]);
});

test("uploaded previews retain pending and rejected items without presenting them as posted", () => {
  const html = render({
    photos: [{ id: "approved", imageUrl: "/approved.jpg", status: "approved" }, { id: "pending", status: "pending" }, { id: "rejected", status: "rejected" }],
    videos: [{ id: "checking", status: "moderating" }],
  });
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.match(html, /3 added/);
  assert.match(html, /1 added/);
  assert.match(html, /Approved/);
  assert.match(html, /Checking/);
  assert.match(html, /Not approved/);
  assert.doesNotMatch(html, /Added to your profile/);
});

test("upload progress, failure, and unknown statuses never imply publication", () => {
  assert.equal(exports.profileUploadStatus("uploading"), "Upload incomplete");
  assert.equal(exports.profileUploadStatus("failed"), "Upload failed · Try again");
  assert.equal(exports.profileUploadStatus("unknown"), "Check upload status");
  assert.equal(exports.profileUploadStatus("submitted"), "Checking");
});

test("saved media visibility copy respects profile approval and incognito", () => {
  assert.match(render({ isApproved: true, isPublic: true }), /Approved uploads appear on your profile/);
  const hidden = render({ isApproved: true, isPublic: false });
  assert.match(hidden, /Uploads stay saved. Turn off incognito/);
  assert.doesNotMatch(hidden, /Approved uploads appear on your profile/);
});

test("all saved gallery photos use ordinary photo labels including legacy primary photos", () => {
  const html = render({ photos: [{ id: "main", status: "approved", isPrimary: true }, { id: "other", status: "approved" }] });
  assert.match(html, /Manage photo 1: Approved/);
  assert.match(html, /<strong>Photo 1<\/strong>/);
  assert.match(html, /<strong>Photo 2<\/strong>/);
  assert.doesNotMatch(render({ photos: [{ id: "first", status: "approved" }] }), /Main photo/);
  assert.doesNotMatch(html, /Main photo|Make main/);
});

test("each preview picture has a separate accessible Delete button", () => {
  const tree = Uploads({ ...defaultProps, photos: [{ id: "p", status: "approved" }, { id: "pending", status: "pending" }], videos: [{ id: "v", status: "approved" }] });
  const deletes = buttons(tree).filter(button => button.props.className === "profile-upload-delete");
  assert.deepEqual(deletes.map(button => button.props["aria-label"]), ["Delete photo 1", "Delete photo 2"]);
  for (const button of buttons(tree)) assert.equal(buttons(button).length, 1, "delete and preview buttons must never be nested");
});

function deletionHarness({ confirm = () => true, remove = async () => ({ ok: true }), refresh = async () => ({ profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [], pending_photo_reviews: [] } }) } = {}) {
  const slots = [], effects = [], requests = [], changes = [], busy = [];
  let cursor = 0, dirty = true, tree;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect) { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(effect); } },
  };
  const Module = loadUploads({ hooks, confirm, api: {
    requestDancerPhotosJson: options => { requests.push(options); return remove(options); },
    requestDancerProfileJson: options => { requests.push(options); return refresh(options); },
  } }).default;
  const cleanups = [];
  function renderState() {
    if (!dirty) return;
    dirty = false; cursor = 0;
    tree = Module({ ...defaultProps, photos: [{ id: "photo-id", imageUrl: "/photo.jpg", status: "pending" }], onPhotoDeleted: (...args) => changes.push(args), onDeleteBusyChange: value => busy.push(value) });
    effects.splice(0).forEach(effect => cleanups.push(effect()));
  }
  renderState();
  return {
    requests, changes, busy,
    get controls() { return buttons(tree); },
    get deleteButton() { return buttons(tree).find(button => button.props.className === "profile-upload-delete"); },
    get html() { return renderToStaticMarkup(tree).replace(/<style>[\s\S]*?<\/style>/g, ""); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); renderState(); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test("preview deletion confirms once, blocks duplicate clicks, and updates counts without deleting the avatar", async () => {
  let release, confirmations = 0;
  const ui = deletionHarness({ confirm: () => { confirmations++; return true; }, remove: () => new Promise(resolve => { release = resolve; }) });
  const button = ui.deleteButton;
  button.props.onClick(); button.props.onClick(); await ui.settle();
  assert.equal(confirmations, 1);
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.busy, [true]);
  assert.deepEqual(JSON.parse(ui.requests[0].body), { photoId: "photo-id" });
  assert.equal(ui.requests[0].method, "DELETE");
  assert.equal(ui.deleteButton.props.disabled, true);
  assert.match(ui.html, /aria-label="Deleting photo 1" aria-busy="true"/);
  release({ ok: true }); await ui.settle();
  assert.equal(ui.deleteButton, undefined);
  assert.match(ui.html, /0 added/);
  assert.match(ui.html, /Photo deleted\./);
  assert.equal(ui.changes.length, 2);
  assert.equal(ui.changes[1][1].avatarPhotoUrl, "/avatar.jpg");
  assert.deepEqual(ui.busy, [true, false]);
});

test("the profile editor keeps closing and saving unavailable while a preview deletion is in flight", () => {
  const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /if \(avatarUploadingRef.current \|\| photoDeletingRef.current\) return/);
  assert.match(dashboard, /if \(!onEditorSave \|\| isEditorSaving \|\| photoDeletingRef.current\) return/);
  assert.match(dashboard, /onDeleteBusyChange=\{reportPhotoDeleteBusy\}/);
  assert.match(dashboard, /disabled=\{isEditorSaving \|\| isPhotoDeleting \|\| !requirementsComplete\}/);
});

test("canceling preview deletion makes no request", async () => {
  const ui = deletionHarness({ confirm: () => false });
  ui.deleteButton.props.onClick(); await ui.settle();
  assert.equal(ui.requests.length, 0);
  assert.ok(ui.deleteButton);
});

test("failed preview deletion keeps the picture and exposes a usable error", async () => {
  const ui = deletionHarness({ remove: async () => { throw new Error("Connection lost. Try again."); } });
  ui.deleteButton.props.onClick(); await ui.settle();
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.deleteButton.props.disabled, false);
  assert.match(ui.html, /1 added/);
  assert.match(ui.html, /Connection lost\. Try again\./);
});

test("a failed refresh never restores a confirmed deleted preview or sends another delete", async () => {
  const ui = deletionHarness({ refresh: async () => { throw new Error("Offline"); } });
  ui.deleteButton.props.onClick(); await ui.settle();
  assert.equal(ui.deleteButton, undefined);
  assert.equal(ui.changes.length, 1);
  assert.match(ui.html, /Photo deleted\. Reload your profile/);
  assert.equal(ui.requests.filter(request => request.method === "DELETE").length, 1);
});

test("closing a preview aborts its request and ignores late results", async () => {
  let release;
  const ui = deletionHarness({ remove: () => new Promise(resolve => { release = resolve; }) });
  ui.deleteButton.props.onClick(); ui.unmount();
  release({ ok: true }); await ui.settle();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.changes.length, 0);
});

test("loading and a failed video request are distinguishable from an empty video library", () => {
  const loading = render({ isVideoLoading: true });
  assert.match(loading, /Loading…/);
  assert.equal((loading.match(/0 added/g) || []).length, 1);
  const opened = [];
  const props = { ...defaultProps, videoError: "Unable to load your videos.", onOpen: (section) => opened.push(section) };
  const html = render(props);
  assert.match(html, /Unavailable/);
  assert.match(html, /Unable to load your videos/);
  assert.equal((html.match(/0 added/g) || []).length, 1);
  buttons(Uploads(props)).at(-1).props.onClick();
  assert.deepEqual(opened, ["videos"]);
});

test("large saved libraries remain accessible and thumbnails do not start video downloads", () => {
  const html = render({ videos: Array.from({ length: 50 }, (_, index) => ({ id: `v-${index}`, imageUrl: `/poster-${index}.jpg`, status: "approved" })) });
  assert.equal((html.match(/<li>/g) || []).length, 50);
  assert.match(html, /Manage video 50: Approved/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /<video/);
});

test("video upload confirmation only claims posting for approved media on an eligible visible profile", () => {
  const studio = readFileSync(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");
  assert.match(studio, /video.status === "approved" \? \([\s\S]*?!workspace.profileEligible[\s\S]*?after setup and approval[\s\S]*?workspace.profileVisible[\s\S]*?Added to your profile[\s\S]*?Hidden while incognito is on/);
});
