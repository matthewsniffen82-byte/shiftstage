import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const source = dashboard.slice(dashboard.indexOf("function DancerProfilePreview("), dashboard.indexOf("function DancerOnboardingCommand("));
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function fixture({ open = false, editor = true, approved = true, pendingRequest } = {}) {
  const states = [], refs = [], effects = [], requests = [], changes = [], listeners = new Map();
  let stateIndex = 0, refIndex = 0;
  const videos = [{ id: "v1", status: "approved", videoUrl: "/v1.mp4", posterUrl: "/v1.jpg", isPinned: false }];
  const profile = { id: "dancer-a", stageName: "Luna", city: "Las Vegas", dancer_photos: [{ id: "p1", status: "approved", imageUrl: "/p1.jpg" }, { id: "p2", status: "pending" }] };
  const context = vm.createContext({
    AbortController, Error, exports: {},
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = index === 0 ? open : index === 9 ? videos : typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useCallback: fn => fn,
    useEffect: fn => effects.push(fn),
    persistedDancerStageName: p => p.stageName,
    relabelPhotoItems: items => items,
    dancerPhotoItemsFromProfile: p => p.dancer_photos,
    dancerPreviewSocialLinks: () => [],
    DANCER_PROFILE_EDITOR_SECTION_LABELS: { photos: "Photos", videos: "Videos" },
    DANCER_PROFILE_VIDEOS_CHANGED_EVENT: "videos-changed",
    DANCER_PHOTOS_KEEP_OPEN_EVENT: "photos-open",
    readSession: () => ({ accessToken: "owner" }),
    requestDancerTvVideosJson: options => { requests.push(options); return pendingRequest ? pendingRequest : Promise.resolve({ videos }); },
    window: { scrollY: 120, clearTimeout() {}, setTimeout() {}, requestAnimationFrame: () => 1, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    document: { querySelector: () => null },
    AvatarUploadBusyContext: { Provider: "AvatarUploadBusyContext" },
    SOCIAL_PLATFORMS: [],
  });
  for (const match of source.matchAll(/<([A-Z]\w*)\b/g)) context[match[1]] ||= match[1];
  vm.runInContext(code, context);
  const props = { profile, buttonClassName: "edit-profile", buttonLabel: "Edit profile", isApproved: approved, isPublic: true, editorSections: editor ? { photos: "photo-manager", videos: "video-manager" } : undefined, onProfileChange: next => changes.push(next) };
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return context.DancerProfilePreview(props); };
  return { render, states, effects, requests, changes, listeners, profile };
}

test("the dashboard shows only the editor launch until Edit profile is clicked", () => {
  const ui = fixture();
  const nodes = elements(ui.render());
  assert.equal(nodes.filter(node => node.type === "button").length, 1);
  assert.ok(!nodes.some(node => node.type === "DancerProfileMediaUploads"));
  const loadVideos = ui.effects.find(fn => fn.toString().includes("requestDancerTvVideosJson"));
  assert.equal(loadVideos(), undefined);
  assert.equal(ui.requests.length, 0);
  nodes.find(node => node.type === "button").props.onClick();
  const opened = elements(ui.render());
  assert.equal(opened.filter(node => node.props?.role === "dialog").length, 1);
  const uploads = opened.find(node => node.type === "DancerProfileMediaUploads");
  assert.equal(uploads.props.photos.length, 2);
  assert.equal(uploads.props.videos.length, 1);
  assert.equal(uploads.props.photos[1].status, "pending");
  assert.equal(typeof uploads.props.onMediaPinned, "function");
});

test("profile media opens the matching upload editor, and busy deletion prevents switching", () => {
  for (const section of ["photos", "videos"]) {
    const ui = fixture({ open: true });
    const nodes = elements(ui.render());
    const uploads = nodes.find(node => node.type === "DancerProfileMediaUploads");
    uploads.props.onOpen(section);
    assert.equal(ui.states[0], true);
    assert.equal(ui.states[1], section);
  }
  const ui = fixture({ open: true });
  const uploads = elements(ui.render()).find(node => node.type === "DancerProfileMediaUploads");
  uploads.props.onDeleteBusyChange(true);
  const edit = elements(ui.render()).find(node => node.props?.className === "edit-profile");
  assert.equal(edit.props.disabled, true);
});

test("active and onboarding editors use management previews but the guest preview remains view-only", () => {
  for (const approved of [false, true]) {
    const nodes = elements(fixture({ open: true, approved }).render());
    assert.equal(nodes.filter(node => node.type === "DancerProfileMediaUploads").length, 1);
    assert.ok(!nodes.some(node => node.props?.className === "dancer-dashboard-media-manager"));
    assert.ok(!nodes.some(node => node.type === "DancerProfileActionsPreview" || node.type === "VenueQrUnavailable"));
    assert.ok(!nodes.some(node => /profile-tonight|profile-overview|profile-metrics/.test(node.props?.className || "")));
    assert.ok(nodes.some(node => node.props?.["data-profile-editor-trigger"] === "avatar"));
    assert.ok(nodes.some(node => node.props?.["data-profile-editor-trigger"] === "identity"));
    assert.ok(nodes.some(node => node.props?.className?.includes("dancer-profile-builder-socials")));
  }
  const nodes = elements(fixture({ open: true, editor: false }).render());
  assert.ok(nodes.some(node => node.type === "DancerPhotoCarousel"));
  assert.ok(!nodes.some(node => node.type === "DancerProfileMediaUploads"));
});

test("successful media updates change only the selected dashboard item and do not close the section", () => {
  const ui = fixture({ open: true });
  const uploads = elements(ui.render()).find(node => node.type === "DancerProfileMediaUploads");
  uploads.props.onMediaPinned("photo", "p1", true);
  assert.equal(ui.changes[0].dancer_photos[0].is_pinned, true);
  assert.equal(ui.changes[0].dancer_photos[1].is_pinned, undefined);
  uploads.props.onMediaPinned("video", "v1", true);
  assert.equal(ui.states[9][0].isPinned, true);
  uploads.props.onPhotoDeleted("p1");
  assert.deepEqual(ui.changes.at(-1).dancer_photos.map(p => p.id), ["p2"]);
  uploads.props.onVideoDeleted("v1");
  assert.equal(ui.states[9].length, 0);
  assert.equal(ui.states[0], true);
  assert.ok(elements(ui.render()).some(node => node.type === "DancerProfileMediaUploads"));
});

test("profile editor videos load on demand and clean up stale work when closed", async () => {
  let release;
  const ui = fixture({ open: true, pendingRequest: new Promise(resolve => { release = resolve; }) });
  ui.render();
  const effect = ui.effects.find(fn => fn.toString().includes("requestDancerTvVideosJson"));
  const cleanup = effect();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].cache, "no-store");
  assert.ok(ui.listeners.has("videos-changed"));
  cleanup();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.listeners.size, 0);
  release({ videos: [{ id: "late", status: "approved", videoUrl: "/late.mp4" }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.states[9].length, 0);
});
