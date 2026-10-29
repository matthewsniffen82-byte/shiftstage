import * as clubMedia from '../src/lib/dancr/club-media-status.ts';
import { stableVideo } from './helpers/stable-video-component.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/dashboard-test-fs.mjs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { mediaReview } from "./helpers/media-review-label.mjs";
import { loadMediaRetryComponent } from "./helpers/media-retry-component.mjs";
import * as mediaLimits from "../src/lib/dancr/media-limits.ts";

const source = readFileSync(new URL("../app/dashboard/DancerProfileMediaUploads.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requireTest = createRequire(import.meta.url);
const retryButton = loadMediaRetryComponent();
const thumbnail = {};
const pinButton = {};
const viewer = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/dashboard/DancerMediaViewer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: viewer, require: name => name === "../components/StableVideo" ? stableVideo : requireTest(name) });
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/dashboard/DancerMediaPinButton.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: pinButton, require: requireTest });
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/dashboard/DancerVideoThumbnail.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: thumbnail, require: name => name === "./dancer-profile-media-sync" ? {} : requireTest(name) });
const staticHooks = { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {} };
function loadUploads({ hooks = staticHooks, api = {}, confirm = () => false, announce = () => {} } = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Error, window: { confirm }, require: name => name === "@/src/lib/dancr/club-media-status" ? clubMedia : name === "@/src/lib/dancr/media-limits" ? mediaLimits : name === "./DancerMediaRetryButton" ? retryButton : name === "@/src/lib/dancr/media-review-label" ? mediaReview : name === "react" ? hooks : name === "./dashboard-session" ? { requestDashboardJson: async () => ({statuses: []}), ...api } : name === "./DancerVideoThumbnail" ? thumbnail : name === "./DancerMediaPinButton" ? pinButton : name === "./DancerMediaViewer" ? viewer : name === "./dancer-profile-media-sync" ? { announceDancerProfileVideosChanged: announce } : requireTest(name) });
  return exports;
}
const exports = loadUploads();
const Uploads = exports.default;
const defaultProps = { photos: [], videos: [], isApproved: false, isPublic: false, isVideoLoading: false, videoError: "", onOpen() {}, onPhotoDeleted() {}, onVideoDeleted() {} };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Uploads, { ...defaultProps, ...props })).replace(/<style>[\s\S]*?<\/style>/g, "");

test('club rejection is visible on photo and video tiles, with exact club scope',()=>{
  for(const kind of ['photo','video']){
    const html=render({compact:true,expanded:true,slotEditor:true,mediaType:kind+'s',
      [kind+'s']:[{id:'media',status:'pending',imageUrl:'/private.jpg'}],
      clubMedia:{error:'',statuses:[
        {id:'media',kind,venueId:'a',venueName:'Spearmint Rhino',status:'rejected'},
        {id:'media',kind,venueId:'b',venueName:'Other club',status:'approved'},
      ]}});
    assert.match(html,/Not approved/);
    assert.match(html,/data-rejected="true"/);
    assert.match(html,/<li[^>]*data-needs-attention="true"/);
    assert.match(html,/Spearmint Rhino: Not approved here/);
    assert.doesNotMatch(html,/class="dancer-media-approval-indicator"/);
    assert.match(html,/Other club: Approved here/);
  }
});

test("slot editors show three rows initially and keep every saved item beyond nine", () => {
  for (const count of [0, 4, 9, 10, 49, 50]) {
    for (const mediaType of ["photos", "videos"]) {
      const items = Array.from({ length: count }, (_, i) => ({ id: String(i), status: i % 2 ? "submitted" : "approved", imageUrl: "/preview.jpg" }));
      const html = render({ compact: true, expanded: true, slotEditor: true, mediaType, [mediaType]: items });
      const empty = Math.min(50, Math.max(9, Math.ceil(count / 9) * 9)) - count;
      assert.equal((html.match(/class="dancer-media-empty-slot"/g) || []).length, empty);
      assert.equal((html.match(/class="dancer-media-slot-remove"/g) || []).length, count);
      assert.equal((html.match(/<li\b/g) || []).length, count + empty);
    }
  }
});

test("the plus slot opens its own uploader and removal is separate from preview", () => {
  let adds = 0;
  const tree = Uploads({ ...defaultProps, compact: true, expanded: true, slotEditor: true, mediaType: "photos",
    photos: [{ id: "pending", status: "pending" }], onAdd: () => { adds++; } });
  const controls = buttons(tree);
  controls.find(button => button.props.className === "dancer-media-slot-add").props.onClick();
  assert.equal(adds, 1);
  assert.equal(controls.find(button => button.props.className === "dancer-media-slot-remove").props["aria-label"], "Remove photo 1");
  assert.ok(controls.every(button => buttons(button).length === 1));
});

test("slot editors put pending approval on the image and keep captions clear without hiding failures", () => {
  const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
  for (const mediaType of ["photos", "videos"]) {
    const tree = Uploads({ ...defaultProps, compact: true, expanded: true, slotEditor: true, mediaType,
      [mediaType]: [
        { id: "main", status: "pending", isPrimary: true, imageUrl: "/main.jpg" },
        { id: "approved", status: "approved", imageUrl: "/approved.jpg" },
        { id: "rejected", status: "rejected", imageUrl: "/rejected.jpg" },
      ] });
    const nodes=walk(tree), cards=nodes.filter(n=>n.type==='li'&&n.props['data-review-status']);
    assert.equal(cards[0].props['data-needs-attention'],undefined);
    assert.equal(cards[1].props['data-needs-attention'],undefined);
    assert.equal(cards[2].props['data-needs-attention'],true);
    for(const card of cards.slice(0,2)) assert.equal(React.Children.toArray(card.props.children).filter(n=>n.type==='strong'||n.type==='small').length,0);
    const indicator=walk(cards[0]).find(n=>n.props.className==='dancer-media-approval-indicator');
    assert.equal(indicator.props['aria-label'],'Awaiting final approval');
    assert.equal(indicator.props.title,'Awaiting final approval');
    assert.equal(nodes.filter(n=>n.props.className==='dancer-media-approval-indicator').length,1);
    assert.equal(nodes.filter(n=>n.props.className==='dancer-main-photo-badge').length,mediaType==='photos'?1:0);
    assert.equal(cards[2].props['data-rejected'],true);
    assert.equal(walk(cards[2]).find(n=>n.props.className==='dancer-media-rejected-indicator').props.children, `Not approved — choose another ${mediaType==='photos'?'picture':'video'}`);
    const remove=walk(cards[0]).find(n=>n.props.className==='dancer-media-slot-remove');
    assert.equal(remove.props['data-close-control'],'');
    assert.equal(React.Children.only(remove.props.children).type,'svg');
  }
});

test('new and saved rejections use the same badge and finished-card layout for photos and videos', () => {
  const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[];
  for (const kind of ['photo','video']) {
    let expectedBadge;
    for (const source of ['platform','club']) for (const uploading of [false,true]) for (const error of [undefined,'Not approved']) {
      let removes=0;
      const item={id:'rejected',status:source==='club'?'pending':'rejected',isPrimary:kind==='photo',imageUrl:'/rejected.jpg',
        ...(uploading?{upload:{label:'Processing',progress:100,error,onRemove(){removes++;}}}:{})};
      const tree=Uploads({...defaultProps,compact:true,expanded:true,slotEditor:true,mediaType:kind+'s',[kind+'s']:[item],
        clubMedia:{error:'',statuses:source==='club'?[{id:item.id,kind,venueId:'club',venueName:'Club',status:'rejected'}]:[]}});
      const nodes=walk(tree),card=nodes.find(n=>n.type==='li'&&n.props['data-rejected']);
      assert.ok(card);
      const badge=walk(card).filter(n=>n.props.className==='dancer-media-rejected-indicator');
      assert.equal(badge.length,1);
      const markup=renderToStaticMarkup(badge[0]);
      expectedBadge ||= markup;
      assert.equal(markup,expectedBadge);
      assert.equal(walk(card).some(n=>n.props.className==='dancer-media-slot-progress'||n.props.role==='progressbar'),false);
      assert.equal(walk(card).some(n=>String(n.props.className).includes('dancer-media-uploading-slot')),false);
      const remove=walk(card).find(n=>n.props.className==='dancer-media-slot-remove');
      assert.equal(remove.props['aria-label'],`Remove ${kind} 1`);
      if(uploading){remove.props.onClick();assert.equal(removes,1);assert.equal(walk(card).find(n=>n.props.className==='profile-upload-preview').props['aria-busy'],false);}
    }
  }
});

test('photo and video transfers keep progress and cancellation inside the same grid card without Retry', () => {
  const walk=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(walk)]:[];
  for(const kind of ['photos','videos'])for(const error of [undefined,'Upload interrupted. Check your connection, then tap Retry.']){
    let cancels=0;
    const tree=Uploads({...defaultProps,compact:true,expanded:true,slotEditor:true,mediaType:kind,
      [kind]:[{id:'upload',previewKey:'selection',status:'uploading',imageUrl:'/local.jpg',upload:{label:error?'Upload failed':'Uploading',progress:45,error,onRemove(){cancels++;}}}]});
    const nodes=walk(tree),card=nodes.find(n=>n.type==='li'&&n.props['data-review-status']);
    assert.equal(card.props['data-needs-attention'],error ? true : undefined);
    assert.match(card.key,/selection$/);assert.equal(nodes.filter(n=>n.type==='li').length,9);
    const progress=walk(card).find(n=>n.props.role==='progressbar');
    assert.equal(Boolean(progress),!error);if(progress)assert.equal(progress.props['aria-valuenow'],45);
    walk(card).find(n=>n.props.className==='dancer-media-slot-remove').props.onClick();assert.equal(cancels,1);
    const html=renderToStaticMarkup(tree).replace(/<style>[\s\S]*?<\/style>/g,'');
    assert.doesNotMatch(html,/>Retry<|dancer-media-review-retry|dancer-pending-media-box/);
    if(error)assert.match(html,/remove this item and add it again/);
  }
  const pending=render({compact:true,expanded:true,slotEditor:true,mediaType:'photos',photos:[{id:'pending',status:'pending',moderationStatus:'moderating',imageUrl:'/local.jpg'}]});
  assert.doesNotMatch(pending,/dancer-media-review-retry/);
});

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
  assert.match(html, /after club approval and completion of your profile setup/);
});

test("compact approved libraries collapse with counts while keeping their content mounted", () => {
  const html = render({ compact: true, photos: [{ id: "p", imageUrl: "/p.jpg", status: "approved" }], videos: [{ id: "v", videoUrl: "/v.mp4", status: "approved" }] });
  assert.equal((html.match(/<details class="profile-upload-group">/g) || []).length, 2);
  assert.equal((html.match(/<summary><strong>(Photos|Videos)<\/strong><span>1 added<\/span><\/summary>/g) || []).length, 2);
  assert.match(html, /src="\/p.jpg"/);
  assert.doesNotMatch(html, /<details class="profile-upload-group" open/);
});

test("guided onboarding shows approved libraries immediately without nested expand controls", () => {
  const html = render({ compact: true, expanded: true, photos: [{ id: "p", imageUrl: "/p.jpg", status: "approved" }], videos: [{ id: "v", videoUrl: "/v.mp4", status: "approved" }] });
  assert.equal((html.match(/<div class="profile-upload-group">/g) || []).length, 2);
  assert.match(html, /<header><strong>Photos<\/strong><span>1 added<\/span><\/header>/);
  assert.match(html, /src="\/p.jpg"/);
  assert.doesNotMatch(html, /<details class="profile-upload-group"/);
});

test("tapping a compact gallery photo opens its editing menu and retains View photo", () => {
  const tree = Uploads({ ...defaultProps, compact: true, photos: [{ id: "p", imageUrl: "/p.jpg", status: "approved" }] });
  const menu = { open: false };
  const edit = buttons(tree).find(button => button.props["aria-label"] === "Edit photo 1: Approved");
  edit.props.onClick({ currentTarget: { parentElement: { querySelector: () => menu } } });
  assert.equal(menu.open, true);
  assert.ok(buttons(tree).some(button => button.props.children === "View photo"));
});

test("separate upload sections render only their own media and loading feedback", () => {
  const media = { photos: [{ id: "photo", imageUrl: "/photo.jpg", status: "approved" }], videos: [{ id: "video", videoUrl: "/video.mp4", status: "approved" }], compact: true };
  const photos = render({ ...media, mediaType: "photos", isVideoLoading: true, videoError: "Video error" });
  assert.match(photos, /aria-label="Uploaded photos"/);
  assert.match(photos, /Photo 1/);
  assert.doesNotMatch(photos, /Video 1|Video error|Loading/);
  const videos = render({ ...media, mediaType: "videos" });
  assert.match(videos, /aria-label="Uploaded videos"/);
  assert.match(videos, /Video 1/);
  assert.doesNotMatch(videos, /Photo 1|photo\.jpg/);
  assert.match(render({ mediaType: "videos", compact: true, isVideoLoading: true }), /Loading/);
});

test("Add buttons open upload controls while thumbnails preview only the selected media", () => {
  const opened = [];
  const states = [];
  let cursor = 0;
  const Module = loadUploads({ hooks: { ...staticHooks, useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { states[i] = value; }]; } } }).default;
  const props = { ...defaultProps, photos: [{ id: "p", imageUrl: "/p.jpg", status: "approved" }], videos: [{ id: "v", videoUrl: "/v.mp4", status: "submitted" }], onOpen: (section) => opened.push(section) };
  const draw = () => { cursor = 0; return Module(props); };
  const controls = buttons(draw()).filter(button => button.props.className !== "profile-upload-delete");
  assert.equal(controls.length, 4);
  controls[0].props.onClick(); controls[2].props.onClick();
  assert.deepEqual(opened, ["photos", "videos"]);
  for (const [buttonIndex, media] of [[1, "photo"], [3, "video"]]) {
    controls[buttonIndex].props.onClick();
    const preview = React.Children.toArray(draw().props.children).find(child => child?.type === viewer.default);
    assert.equal(preview.props.kind, media);
    assert.equal(preview.props.label, media === "photo" ? "Photo 1" : "Video 1");
    assert.equal(preview.props[media === "photo" ? "imageUrl" : "videoUrl"], media === "photo" ? "/p.jpg" : "/v.mp4");
    preview.props.onClose();
    assert.ok(!React.Children.toArray(draw().props.children).some(child => child?.type === viewer.default));
  }
  assert.deepEqual(opened, ["photos", "videos"], "viewing media must never reopen an upload box");
});

test("uploaded previews retain pending and rejected items without presenting them as posted", () => {
  const html = render({
    photos: [{ id: "approved", imageUrl: "/approved.jpg", status: "approved" }, { id: "pending", status: "pending" }, { id: "rejected", status: "rejected" }],
    videos: [{ id: "checking", status: "moderating" }],
  });
  assert.equal((html.match(/<li\b/g) || []).length, 4);
  assert.match(html, /3 added/);
  assert.match(html, /1 added/);
  assert.match(html, /Approved/);
  assert.match(html, /Awaiting final approval/);
  assert.match(html, /Not approved/);
  assert.doesNotMatch(html, /Added to your profile/);
});

test("upload progress, failure, and unknown statuses never imply publication", () => {
  assert.equal(exports.profileUploadStatus("uploading"), "Upload incomplete");
  assert.equal(exports.profileUploadStatus("failed"), "Upload failed");
  assert.equal(exports.profileUploadStatus("unknown"), "Check upload status");
  assert.equal(exports.profileUploadStatus("submitted"), "Awaiting final approval");
});

test("an approved dancer sees the actual review state of each photo", () => {
  const html = render({ isApproved: true, isPublic: true, photos: [
    { id: "approved", status: "approved", moderationStatus: "pending_review" },
    { id: "waiting", status: "pending", moderationStatus: "pending_review" },
    { id: "active", status: "pending", moderationStatus: "moderating" },
    { id: "delayed", status: "pending", moderationStatus: "moderation_error" },
  ] });
  assert.match(html, /View photo 1: Approved/);
  assert.match(html, /View photo 2: Awaiting final approval/);
  assert.match(html, /View photo 3: Awaiting final approval/);
  assert.match(html, /View photo 4: Review delayed/);
});

test("every photo and video has three-dot options with an approval-aware pin action inside", () => {
  const items = ["approved", "pending", "rejected"].map((status, index) => ({ id: String(index), status, isPinned: index === 0 }));
  const html = render({ photos: items, videos: items, onMediaPinned() {} });
  const pins = html.match(/<button[^>]*aria-label="(?:Unpin|Pin) [^>]*>/g);
  assert.equal(pins.length, 6);
  assert.equal((html.match(/<summary class="dashboard-menu-trigger" aria-label="Options for/g) || []).length, 6);
  assert.equal((html.match(/<details class="dancer-media-menu/g) || []).length, 6);
  for (const [index, pin] of pins.entries()) {
    const approved = index % 3 === 0;
    assert.match(pin, new RegExp(`aria-label="${approved ? "Unpin" : "Pin"} ${index < 3 ? "photo" : "video"} ${index % 3 + 1}"`));
    if (approved) assert.doesNotMatch(pin, /disabled/);
    else assert.match(pin, /disabled=""/);
  }
  assert.doesNotMatch(html, /<details[^>]* open=""|class="dancer-media-pin /);
});

test("saved media visibility copy respects profile approval and incognito", () => {
  const visible = render({ isApproved: true, isPublic: true });
  assert.match(visible, /<span aria-hidden="false">Approved uploads appear on your profile\.<\/span>/);
  assert.match(visible, /<span aria-hidden="true">Uploads stay saved\. Hidden while incognito\.<\/span>/);
  const hidden = render({ isApproved: true, isPublic: false });
  assert.match(hidden, /<span aria-hidden="false">Uploads stay saved\. Hidden while incognito\.<\/span>/);
  assert.match(hidden, /<span aria-hidden="true">Approved uploads appear on your profile\.<\/span>/);
});

test("saved gallery photos keep numbered labels and identify the main photo once", () => {
  const html = render({ photos: [{ id: "main", status: "approved", isPrimary: true }, { id: "other", status: "approved" }] });
  assert.match(html, /View photo 1: Approved/);
  assert.match(html, /<strong>Photo 1<\/strong>/);
  assert.match(html, /<strong>Photo 2<\/strong>/);
  assert.doesNotMatch(render({ photos: [{ id: "first", status: "approved" }] }), /Main photo/);
  assert.equal((html.match(/>Main photo</g) || []).length, 1);
});

test("each photo and video preview has a separate accessible Delete button", () => {
  const tree = Uploads({ ...defaultProps, photos: [{ id: "p", status: "approved" }, { id: "pending", status: "pending" }], videos: [{ id: "v", status: "approved" }] });
  const deletes = buttons(tree).filter(button => button.props.className === "profile-upload-delete");
  assert.deepEqual(deletes.map(button => button.props["aria-label"]), ["Delete photo 1", "Delete photo 2", "Delete video 1"]);
  for (const button of buttons(tree)) assert.equal(buttons(button).length, 1, "delete and preview buttons must never be nested");
});

function deletionHarness({ section = "photos", items, statuses = [], props = {}, confirm = () => true, remove = async () => ({ ok: true }) } = {}) {
  const slots = [], effects = [], requests = [], changes = [], busy = [], announcements = [];
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
  const Module = loadUploads({ hooks, confirm, announce: () => announcements.push(true), api: {
    requestDashboardJson: async () => ({statuses}),
    requestDancerPhotosJson: options => { requests.push(options); return remove(options); },
    requestDancerProfileJson: options => { requests.push(options); throw new Error("Deletion must not wait for a profile refresh."); },
    requestDancerTvVideoJson: (videoId, options) => { requests.push({ ...options, videoId }); return remove(options); },
  } }).default;
  const cleanups = [];
  function renderState() {
    if (!dirty) return;
    dirty = false; cursor = 0;
    tree = Module({ ...defaultProps, ...props, [section]: items || [{ id: section === "photos" ? "photo-id" : "video-id", imageUrl: "/preview.jpg", status: "pending" }], onPhotoDeleted: (...args) => changes.push(args), onVideoDeleted: (...args) => changes.push(args), onDeleteBusyChange: value => busy.push(value) });
    effects.splice(0).forEach(effect => cleanups.push(effect()));
  }
  renderState();
  return {
    requests, changes, busy, announcements,
    get controls() { return buttons(tree); },
    get deleteButton() { return buttons(tree).find(button => button.props.className === "profile-upload-delete"); },
    get html() { return renderToStaticMarkup(tree).replace(/<style>[\s\S]*?<\/style>/g, ""); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); renderState(); },
    rerender() { dirty = true; renderState(); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test("Add more expands either media grid nine slots at a time and stops at capacity", () => {
  for (const section of ['photos','videos']) {
    const ui=deletionHarness({section,items:[],props:{compact:true,expanded:true,slotEditor:true,mediaType:section}});
    const more=()=>ui.controls.find(b=>b.props.className==='dancer-media-more-slots');
    const count=()=> (ui.html.match(/<li\b/g)||[]).length;
    assert.equal(count(),9);
    for(const expected of [18,27,36,45,50]){
      const added=expected-count();
      assert.match(more().props['aria-label'],new RegExp(`Add ${added} more`));
      more().props.onClick();ui.rerender();assert.equal(count(),expected);
    }
    assert.equal(more(),undefined);
    assert.equal(ui.requests.length,0);
  }
});

test("filling a revealed page keeps its slot count until Add more is chosen again", () => {
  const items=[],ui=deletionHarness({items,props:{compact:true,expanded:true,slotEditor:true,mediaType:'photos'}});
  const more=()=>ui.controls.find(b=>b.props.className==='dancer-media-more-slots');
  more().props.onClick();ui.rerender();
  items.push(...Array.from({length:10},(_,i)=>({id:`p${i}`,status:'pending',imageUrl:'/photo.jpg'})));
  ui.rerender();assert.equal((ui.html.match(/<li\b/g)||[]).length,18);
  more().props.onClick();ui.rerender();assert.equal((ui.html.match(/<li\b/g)||[]).length,27);
});

test("photo deletion removes the preview immediately, blocks duplicates, and confirms without a profile refresh", async () => {
  let release, confirmations = 0;
  const ui = deletionHarness({ confirm: () => { confirmations++; return true; }, remove: () => new Promise(resolve => { release = resolve; }) });
  const button = ui.deleteButton;
  button.props.onClick(); button.props.onClick(); await ui.settle();
  assert.equal(confirmations, 1);
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.busy, [true]);
  assert.deepEqual(JSON.parse(ui.requests[0].body), { photoId: "photo-id" });
  assert.equal(ui.requests[0].method, "DELETE");
  assert.equal(ui.deleteButton, undefined);
  assert.match(ui.html, /0 added/);
  assert.match(ui.html, /Deleting photo…/);
  assert.doesNotMatch(ui.html, /Photo deleted\./);
  assert.equal(ui.changes.length, 0, "do not mutate the saved profile before confirmation");
  ui.rerender();
  assert.equal(ui.deleteButton, undefined, "stale parent photos must not restore a pending deletion");
  release({ ok: true }); await ui.settle();
  assert.equal(ui.deleteButton, undefined);
  assert.match(ui.html, /0 added/);
  assert.doesNotMatch(ui.html, /Deleting photo|Photo deleted|profile-upload-status/);
  assert.deepEqual(ui.changes, [["photo-id"]]);
  assert.equal(ui.requests.length, 1);
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

test("failed preview deletion restores the picture and exposes a usable error", async () => {
  let reject;
  const ui = deletionHarness({ remove: () => new Promise((_, fail) => { reject = fail; }) });
  ui.deleteButton.props.onClick(); await ui.settle();
  assert.equal(ui.deleteButton, undefined);
  reject(new Error("Connection lost. Try again.")); await ui.settle();
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.deleteButton.props.disabled, false);
  assert.match(ui.html, /1 added/);
  assert.match(ui.html, /Connection lost\. Try again\./);
  assert.deepEqual(ui.busy, [true, false]);
  assert.doesNotMatch(ui.html, /Photo deleted\./);
});

test("remaining thumbnails stay enabled while a photo deletion is pending", async () => {
  let release;
  const ui = deletionHarness({ items: [
    { id: "first", imageUrl: "/first.jpg", status: "approved" },
    { id: "second", imageUrl: "/second.jpg", status: "approved" },
  ], remove: () => new Promise(resolve => { release = resolve; }) });
  ui.deleteButton.props.onClick(); await ui.settle();
  assert.match(ui.html, /1 added/);
  assert.doesNotMatch(ui.html, /src="\/first.jpg"/);
  const preview = ui.controls.find(control => control.props["aria-label"] === "View photo 1: Approved");
  assert.equal(preview.props.disabled, false);
  assert.equal(ui.deleteButton.props.disabled, true, "conflicting mutations wait for confirmation");
  release({ ok: true }); await ui.settle();
  assert.equal(ui.deleteButton.props.disabled, false);
});

test("stale parent photos never restore a confirmed deleted preview", async () => {
  const ui = deletionHarness();
  ui.deleteButton.props.onClick(); await ui.settle();
  ui.rerender();
  assert.equal(ui.deleteButton, undefined);
  assert.equal(ui.changes.length, 1);
  assert.doesNotMatch(ui.html, /Deleting photo|Photo deleted|profile-upload-status/);
  assert.equal(ui.requests.length, 1);
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

test("video preview deletion confirms once, blocks duplicate clicks, and refreshes the saved library", async () => {
  let release, confirmations = 0;
  const ui = deletionHarness({ section: "videos", confirm: () => { confirmations++; return true; }, remove: () => new Promise(resolve => { release = resolve; }) });
  const button = ui.deleteButton;
  button.props.onClick(); button.props.onClick(); await ui.settle();
  assert.equal(confirmations, 1);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].videoId, "video-id");
  assert.equal(ui.requests[0].method, "DELETE");
  assert.match(ui.html, /aria-label="Deleting video 1" aria-busy="true"/);
  assert.ok(ui.controls.every(control => control.props.disabled));
  release({ ok: true }); await ui.settle();
  assert.equal(ui.deleteButton, undefined);
  assert.deepEqual(ui.changes, [["video-id"]]);
  assert.deepEqual(ui.busy, [true, false]);
  assert.deepEqual(ui.announcements, [true]);
  assert.doesNotMatch(ui.html, /Video deleted|profile-upload-status/);
});

test("cancelled or failed video deletion keeps the preview without claiming success", async () => {
  const cancelled = deletionHarness({ section: "videos", confirm: () => false });
  cancelled.deleteButton.props.onClick(); await cancelled.settle();
  assert.equal(cancelled.requests.length, 0);
  const failed = deletionHarness({ section: "videos", remove: async () => { throw new Error("Connection lost. Try again."); } });
  failed.deleteButton.props.onClick(); await failed.settle();
  assert.ok(failed.deleteButton);
  assert.equal(failed.deleteButton.props.disabled, false);
  assert.equal(failed.changes.length, 0);
  assert.equal(failed.announcements.length, 0);
  assert.match(failed.html, /Connection lost\. Try again\./);
});

test("closing during video deletion aborts and ignores late responses", async () => {
  let release;
  const ui = deletionHarness({ section: "videos", remove: () => new Promise(resolve => { release = resolve; }) });
  ui.deleteButton.props.onClick(); ui.unmount();
  release({ ok: true }); await ui.settle();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.announcements.length, 0);
});

test("loading and a failed video request are distinguishable from an empty video library", () => {
  const loading = render({ isVideoLoading: true });
  assert.match(loading, /Loading…/);
  assert.equal((loading.match(/0 added/g) || []).length, 1);
  const opened = [];
  let retries = 0;
  const props = { ...defaultProps, videoError: "Unable to load your videos.", onOpen: (section) => opened.push(section) };
  const html = render(props);
  assert.match(html, /Unavailable/);
  assert.match(html, /Unable to load your videos/);
  assert.equal((html.match(/0 added/g) || []).length, 1);
  const Module = loadUploads({ announce: () => { retries++; } }).default;
  buttons(Module(props)).at(-1).props.onClick();
  assert.equal(retries, 1);
  assert.deepEqual(opened, []);
});

test("large saved libraries remain accessible and thumbnails do not start video downloads", () => {
  const html = render({ videos: Array.from({ length: 50 }, (_, index) => ({ id: `v-${index}`, imageUrl: `/poster-${index}.jpg`, status: "approved" })) });
  assert.equal((html.match(/<li\b/g) || []).length, 50);
  assert.match(html, /Play video 50: Approved/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /<video/);
});

test("video upload confirmation only claims posting for approved media on an eligible visible profile", () => {
  const studio = readFileSync(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");
  assert.match(studio, /video.status === "approved" \? \([\s\S]*?!workspace\??\.profileEligible[\s\S]*?after setup and approval[\s\S]*?workspace\??\.profileVisible[\s\S]*?Added to your profile[\s\S]*?Hidden while incognito is on/);
});

test('dancers see independent approvals and rejections labeled with their club', async()=>{
 const ui=deletionHarness({statuses:[
  {id:'upload',photoId:'photo-id',kind:'photo',venueId:'a',venueName:'Club A',status:'approved'},
  {id:'upload',photoId:'photo-id',kind:'photo',venueId:'b',venueName:'Club B',status:'rejected',reason:'Club dress code'},
  {id:'new-upload',kind:'photo',venueId:'b',venueName:'Club B',status:'pending'},
 ]});await ui.settle();
 assert.match(ui.html,/Club A: Approved here/);assert.match(ui.html,/Club B: Not approved here/);assert.match(ui.html,/Not approved/);
 ui.unmount();
});

test('selected club labels do not treat another club rejection as a global rejection or remove uploads',()=>{
 const statuses=[
  {id:'saved',kind:'photo',venueId:'a',venueName:'Club A',status:'approved'},
  {id:'saved',kind:'photo',venueId:'b',venueName:'Club B',status:'rejected',reason:'Choose a different outfit'},
 ];
 const props={compact:true,expanded:true,slotEditor:true,mediaType:'photos',photos:[{id:'saved',status:'approved',imageUrl:'/saved.jpg'}]};
 const atA=render({...props,clubMedia:{statuses,error:'',selectedClub:{id:'a',name:'Club A'}}});
 assert.match(atA,/Approved at Club A/);assert.doesNotMatch(atA,/data-rejected="true"|Not approved at Club B/);assert.match(atA,/saved.jpg/);
 const atB=render({...props,clubMedia:{statuses,error:'',selectedClub:{id:'b',name:'Club B'}}});
 assert.match(atB,/Not approved at Club B/);assert.match(atB,/Choose a different outfit/);assert.match(atB,/saved.jpg/);
 const all=render({...props,clubMedia:{statuses,error:'',selectedClub:null}});
 assert.match(all,/Club A: Approved here/);assert.match(all,/Club B: Not approved here/);assert.doesNotMatch(all,/data-rejected="true"/);
});
