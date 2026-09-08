import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { mediaReview } from "./helpers/media-review-label.mjs";

const requireTest = createRequire(import.meta.url);
function compile(file, resolver) {
  const exports = {};
  const source = readFileSync(new URL(`../app/dashboard/${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: resolver });
  return exports;
}
const thumbnail = compile("DancerVideoThumbnail.tsx", name => name === "./dancer-profile-media-sync" ? {} : requireTest(name));
const pinButton = compile("DancerMediaPinButton.tsx", requireTest);
const previews = compile("DancerVideoPreviews.tsx", name => name === "@/src/lib/dancr/media-review-label" ? mediaReview : name === "./DancerVideoThumbnail" ? thumbnail : name === "./DancerMediaPinButton" ? pinButton : requireTest(name));
const videos = ["approved", "rejected", "moderating"].map((status, index) => ({
  id: `video-${index}`, videoUrl: `/video-${index}.mp4`, posterUrl: `/poster-${index}.jpg`, status,
  moderationDecision: "approved", moderationFrameCount: 9, reviewNotes: "Automatically approved by safety review.", metrics: { engaged_view: 10 },
}));
const props = { videos, removingId: "", disabled: false, onRemove() {} };
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(previews.default, { ...props, ...overrides })).replace(/<style>[\s\S]*?<\/style>/g, "");

test("every video shows three-dot options with Pin or Unpin inside", () => {
  const html = render({ onPin() {}, videos: videos.map((video, index) => ({ ...video, isPinned: index === 0 })) });
  const pins = html.match(/<button[^>]*aria-label="(?:Unpin|Pin) [^>]*>/g);
  assert.equal(pins.length, 3);
  assert.equal((html.match(/<summary aria-label="Options for video/g) || []).length, 3);
  assert.match(pins[0], /aria-label="Unpin video 1"/);
  assert.doesNotMatch(pins[0], /disabled/);
  for (const [index, pin] of pins.slice(1).entries()) {
    assert.match(pin, new RegExp(`aria-label="Pin video ${index + 2}"`));
    assert.match(pin, /disabled=""/);
  }
  assert.doesNotMatch(html, /<details[^>]* open=""|class="dancer-media-pin /);
  assert.match(html, /Delete video 1/);
});

test("video review labels are concise and pending uploads never imply approval or rejection", () => {
  assert.equal(previews.videoPreviewStatus("approved"), "Approved");
  assert.equal(previews.videoPreviewStatus("rejected"), "Not approved");
  for (const status of ["moderating", "pending"]) assert.equal(previews.videoPreviewStatus(status), "Checking");
  for (const status of ["submitted", "review"]) assert.equal(previews.videoPreviewStatus(status), "Awaiting review");
  assert.equal(previews.videoPreviewStatus("uploading"), "Upload incomplete");
  assert.equal(previews.videoPreviewStatus("failed"), "Upload failed");
  assert.equal(previews.videoPreviewStatus("unknown"), "Check upload status");
});

test("saved video previews use lazy posters without downloading full videos or showing review explanations", () => {
  const html = render();
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.equal((html.match(/loading="lazy"/g) || []).length, 3);
  assert.match(html, /Delete video 3/);
  assert.match(html, /Approved/);
  assert.match(html, /Not approved/);
  assert.match(html, /Checking/);
  assert.doesNotMatch(html, /<video|Automatically|frames checked|Engaged views|Remove video/);
  assert.equal((render({ disabled: true, removingId: "video-0" }).match(/disabled=""/g) || []).length, 6);
  assert.match(render({ disabled: true, removingId: "video-0" }), /aria-label="Deleting video 1" aria-busy="true"/);
});

test("the dashboard video manager shows compact previews while the separate TV studio retains its metrics", () => {
  const hooks = { ...React, useCallback: fn => fn, useEffect() {}, useRef: initial => ({ current: initial }), useState: initial => [initial === null ? { videos, profileEligible: false, maxVideos: 50 } : initial === true ? false : initial, () => {}] };
  const Studio = compile("DancerTvStudio.tsx", name => {
    if (name === "@/src/lib/dancr/media-review-label") return mediaReview;
    if (name === "react") return hooks;
    if (name === "./DancerVideoPreviews") return { default: previews.default };
    if (name === "./DancerMediaPinButton") return pinButton;
    if (name === "next/link") return { default: ({ children, href }) => React.createElement("a", { href }, children) };
    if (name === "@/src/lib/dancr/navigation") return { homeDiscoveryHref: () => "/tv" };
    if (name === "@/src/lib/dancr/media-limits") return { MAX_DANCER_PROFILE_VIDEOS: 50 };
    if (name === "react/jsx-runtime") return requireTest(name);
    return {};
  }).default;
  const embedded = renderToStaticMarkup(React.createElement(Studio, { embedded: true })).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(embedded, /video-preview-list/);
  assert.match(embedded, /Delete video 1/);
  assert.doesNotMatch(embedded, /tv-managed-video|<video|Automated review|frames checked|Moderation passed|Engaged views|after setup and approval/);
  const uploadOnly = renderToStaticMarkup(React.createElement(Studio, { embedded: true, uploadOnly: true })).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(uploadOnly, /Choose profile videos from your library/);
  assert.match(uploadOnly, /Record a new profile video/);
  assert.match(uploadOnly, /Confirm permissions/);
  assert.doesNotMatch(uploadOnly, /My videos|video-preview-list|tv-video-manager|Delete video|<video|Engaged views/);
  const standalone = renderToStaticMarkup(React.createElement(Studio)).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(standalone, /Engaged views/);
  assert.match(standalone, /<video/);
});
