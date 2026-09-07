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
const exports = {};
vm.runInNewContext(code, { exports, require: createRequire(import.meta.url) });
const Uploads = exports.default;
const defaultProps = { photos: [], videos: [], isApproved: false, isPublic: false, isVideoLoading: false, videoError: "", onOpen() {} };
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
  const controls = buttons(tree);
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
  assert.match(html, /Ready for profile/);
  assert.match(html, /Checking · Not public yet/);
  assert.match(html, /Not posted · Replace/);
  assert.doesNotMatch(html, /Added to your profile/);
});

test("upload progress, failure, and unknown statuses never imply publication", () => {
  assert.equal(exports.profileUploadStatus("uploading"), "Upload incomplete");
  assert.equal(exports.profileUploadStatus("failed"), "Upload failed · Try again");
  assert.equal(exports.profileUploadStatus("unknown"), "Check upload status");
  assert.equal(exports.profileUploadStatus("submitted"), "Checking · Not public yet");
});

test("saved media visibility copy respects profile approval and incognito", () => {
  assert.match(render({ isApproved: true, isPublic: true }), /Approved uploads appear on your profile/);
  const hidden = render({ isApproved: true, isPublic: false });
  assert.match(hidden, /Uploads stay saved. Turn off incognito/);
  assert.doesNotMatch(hidden, /Approved uploads appear on your profile/);
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
  assert.match(html, /Manage video 50: Ready for profile/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /<video/);
});

test("video upload confirmation only claims posting for approved media on an eligible visible profile", () => {
  const studio = readFileSync(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");
  assert.match(studio, /video.status === "approved" \? \([\s\S]*?!workspace.profileEligible[\s\S]*?after setup and approval[\s\S]*?workspace.profileVisible[\s\S]*?Added to your profile[\s\S]*?Hidden while incognito is on/);
});
