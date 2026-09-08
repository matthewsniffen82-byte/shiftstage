import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const shell = read("outputs/index.html");
const carousel = read("app/dancers/[slug]/DancerPhotoCarousel.tsx");
const shellOwner = shell.slice(shell.indexOf("    const deletedProfileMedia = new Set();"), shell.indexOf("    function profilePhotoThumbMarkup"));
const orderSource = carousel.slice(carousel.indexOf("function orderPinnedMedia"), carousel.indexOf("export function DancerPhotoCarousel"));
const handlerSource = carousel.slice(carousel.indexOf("  async function pinMedia"), carousel.indexOf("  function showPlaybackFeedback"));
const p1 = "11111111-1111-4111-8111-111111111111";
const p2 = "22222222-2222-4222-8222-222222222222";
const v1 = "33333333-3333-4333-8333-333333333333";
const v2 = "44444444-4444-4444-8444-444444444444";
const photos = () => [{ id:p1, kind:"photo", sortOrder:0, isPrimary:true }, { id:p2, kind:"photo", sortOrder:1 }];
const videos = () => [{ id:v1, kind:"video", publishedAt:"2026-09-07" }, { id:v2, kind:"video", publishedAt:"2026-09-01" }];
const response = (id, isPinned, ok = true) => ({ ok, json:async () => ({ ok, media:{ id, isPinned }, error:ok ? undefined : "Please try again" }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function menuFixture(props = {}, open = false) {
  const calls = [];
  const listeners = new Map();
  const element = { open, contains:target => target === element, querySelector:() => ({ focus:() => calls.push("focus") }) };
  const other = { open:true };
  const effects = [];
  const exports = {};
  vm.runInNewContext(compile(read("app/dashboard/DancerMediaPinButton.tsx")), {
    exports, document:{ querySelectorAll:() => [element, other], addEventListener:(name, fn) => listeners.set(name, fn), removeEventListener:name => listeners.delete(name) },
    require:name => name === "react" ? { useRef:() => ({current:element}), useState:() => [open, () => {}], useEffect:fn => effects.push(fn) } : { jsx:(type, props) => ({type, props}), jsxs:(type, props) => ({type, props}) },
  });
  const tree = exports.default({ label:"photo 2", onClick:() => calls.push("pin"), ...props });
  return { tree, summary:tree.props.children[0], action:tree.props.children[1].props.children, element, other, effects, calls, listeners };
}

test("three-dot disclosure opens without pinning; its action reflects saved state and closes it", () => {
  for (const pinned of [false, true]) {
    const m = menuFixture({pinned});
    assert.equal(m.tree.type, "details");
    assert.equal(m.summary.props["aria-label"], "Options for photo 2");
    assert.equal(m.action.props.children, pinned ? "Unpin" : "Pin");
    m.summary.props.onClick({preventDefault:() => assert.fail("enabled options must open")});
    m.element.open = true;
    m.tree.props.onToggle({currentTarget:m.element});
    assert.equal(m.other.open, false);
    assert.deepEqual(m.calls, []);
    m.action.props.onClick();
    assert.equal(m.element.open, false);
    assert.deepEqual(m.calls, ["focus", "pin"]);
  }
});

test("options do not trigger media playback, close with Escape/outside press, and clean up listeners", () => {
  const m = menuFixture({}, true);
  let stopped = 0;
  m.tree.props.onClick({stopPropagation:() => stopped++});
  m.tree.props.onKeyDown({key:"Escape", preventDefault() {}, stopPropagation:() => stopped++});
  assert.equal(stopped, 2);
  assert.equal(m.element.open, false);
  const cleanup = m.effects[0]();
  m.element.open = true;
  m.listeners.get("pointerdown")({target:m.element});
  assert.equal(m.element.open, true);
  m.listeners.get("pointerdown")({target:{}});
  assert.equal(m.element.open, false);
  cleanup();
  assert.equal(m.listeners.size, 0);
});

test("disabled or busy menus cannot submit another pin", () => {
  for (const props of [{disabled:true}, {busy:true}]) {
    const m = menuFixture(props);
    let prevented = false;
    m.summary.props.onClick({preventDefault:() => { prevented = true; }});
    m.action.props.onClick();
    assert.equal(prevented, true);
    assert.equal(m.action.props.disabled, true);
    assert.deepEqual(m.calls, []);
  }
});

function publicFixture() {
  const calls = [], messages = [], viewerUpdates = [];
  let timeout;
  const gallery = { dataset:{profileMediaProfile:"owner"}, profilePhotoItems:photos(), profileTvVideos:videos(), profileVisiblePhotoCount:2, profileVisibleVideoCount:2 };
  const photoViewer = { hidden:true, dataset:{profilePhotoIndex:"0"} };
  const videoViewer = { hidden:true, dataset:{videoIndex:"0"}, profileTvVideos:gallery.profileTvVideos };
  const context = vm.createContext({
    AbortController, modalGallery:gallery, profilePhotoViewer:photoViewer,
    document:{getElementById:() => videoViewer}, authSession:{accessToken:"owner-token"}, isDancerSession:() => true,
    isReportableContentId:id => /^[1-4][0-9a-f-]{35}$/.test(id),
    getAuthenticatedJson:async () => ({ok:true, profile:{id:"owner", dancer_photos:[{id:p2, is_pinned:false, sort_order:1}]}}),
    window:{setTimeout:fn => {timeout = fn; return 1;}, clearTimeout:() => {timeout = undefined;}, confirm:() => true},
    authenticatedRequestHeaders:() => ({Authorization:"Bearer owner-token"}),
    fetch:async (url, options) => {calls.push({url, options}); const data=JSON.parse(options.body); return response(data.mediaId, data.pinned);},
    applyResponseSession:() => {}, profileNavigationPrefetchCache:new Map([["old", {}]]),
    appendNextProfileMediaBatch:kind => { gallery[kind === "photo" ? "profileVisiblePhotoCount" : "profileVisibleVideoCount"] += 2; },
    setProfileMediaTab:kind => calls.push({tab:kind}),
    renderProfilePhotoViewerSlides:() => {}, scrollProfilePhotoViewerTo:index => viewerUpdates.push({kind:"photo", index}),
    renderProfileTvViewerSlides:() => {}, renderProfileTvViewerItem:index => viewerUpdates.push({kind:"video", index}),
    showToast:message => messages.push(message),
  });
  vm.runInContext(shellOwner, context);
  vm.runInContext("syncProfileMediaDeleteControls = () => {};", context);
  return { context, gallery, calls, messages, photoViewer, videoViewer, viewerUpdates, expire:() => timeout?.() };
}

for (const kind of ["photo", "video"]) {
  test(`live-profile ${kind} pins wait for confirmation, preserve the viewer, and unpin restores order`, async () => {
    const f = publicFixture();
    await f.context.verifyProfileMediaOwner("owner");
    const key = kind === "photo" ? "profilePhotoItems" : "profileTvVideos";
    const item = f.gallery[key][1];
    const firstId = f.gallery[key][0].id;
    (kind === "photo" ? f.photoViewer : f.videoViewer).hidden = false;
    const pending = deferred();
    f.context.fetch = async (url, options) => {f.calls.push({url, options}); return pending.promise;};
    const save = f.context.pinOpenProfileMedia(kind, item);
    assert.equal(f.gallery[key][0].id, firstId);
    assert.equal(Boolean(item.isPinned), false);
    await f.context.pinOpenProfileMedia(kind, item);
    await f.context.deleteOpenProfileMedia(kind, item);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/api/dancer/media/pin");
    assert.equal(f.calls[0].options.method, "PATCH");
    assert.deepEqual(JSON.parse(f.calls[0].options.body), {mediaType:kind, mediaId:item.id, pinned:true});
    pending.resolve(response(item.id, true));
    await save;
    assert.equal(f.gallery[key][0].id, item.id);
    assert.equal(item.isPinned, true);
    assert.deepEqual(f.viewerUpdates, [{kind, index:1}]);
    assert.equal(f.context.profileNavigationPrefetchCache.size, 0);
    (kind === "photo" ? f.photoViewer : f.videoViewer).hidden = true;
    f.context.fetch = async () => response(item.id, false);
    await f.context.pinOpenProfileMedia(kind, item);
    assert.equal(f.gallery[key][0].id, firstId);
    assert.equal(item.isPinned, false);
  });
}

test("public pins require a verified matching owner and an item in their open profile", async () => {
  const f = publicFixture();
  await f.context.pinOpenProfileMedia("photo", f.gallery.profilePhotoItems[0]);
  await f.context.verifyProfileMediaOwner("owner");
  await f.context.pinOpenProfileMedia("photo", {id:v1});
  await f.context.pinOpenProfileMedia("photo", {id:"invalid"});
  f.gallery.dataset.profileMediaProfile = "someone-else";
  await f.context.pinOpenProfileMedia("photo", f.gallery.profilePhotoItems[0]);
  f.gallery.dataset.profileMediaProfile = "owner";
  f.context.authSession.accessToken = "different-account";
  await f.context.pinOpenProfileMedia("photo", f.gallery.profilePhotoItems[0]);
  assert.equal(f.calls.length, 0);
});

test("public pin failures and mismatched acknowledgements preserve saved state and permit retry", async () => {
  for (const result of [response(p2, true, false), response(p1, true), response(p2, false)]) {
    const f = publicFixture();
    await f.context.verifyProfileMediaOwner("owner");
    const item = f.gallery.profilePhotoItems[1];
    f.context.fetch = async () => result;
    await f.context.pinOpenProfileMedia("photo", item);
    assert.equal(item.isPinned, false);
    assert.equal(f.gallery.profilePhotoItems[0].id, p1);
    assert.match(f.messages[0], /try again/i);
    f.context.fetch = async () => response(p2, true);
    await f.context.pinOpenProfileMedia("photo", item);
    assert.equal(item.isPinned, true);
  }
});

test("late public pin responses cannot modify a different profile/account or apply after timeout", async () => {
  for (const change of ["profile", "account", "timeout"]) {
    const f = publicFixture();
    await f.context.verifyProfileMediaOwner("owner");
    const pending = deferred(), item = f.gallery.profilePhotoItems[1];
    f.context.fetch = () => pending.promise;
    const save = f.context.pinOpenProfileMedia("photo", item);
    if (change === "profile") f.gallery.dataset.profileMediaProfile = "other";
    if (change === "account") f.context.authSession.accessToken = "other";
    if (change === "timeout") f.expire();
    pending.resolve(response(p2, true));
    await save;
    assert.equal(item.isPinned, false);
    assert.equal(f.gallery.profilePhotoItems[0].id, p1);
    assert.equal(f.messages.length, 0);
  }
});

function reactFixture() {
  const calls = [], messages = [], parentUpdates = [];
  let timeout, overrides = {}, busy = false;
  const context = vm.createContext({
    AbortController, Error, canDeleteMedia:true, ownerToken:"owner-token", token:"owner-token",
    UUID_PATTERN:/^[1-4][0-9a-f-]{35}$/, deleteInFlight:{current:false}, pinRequest:{current:null},
    readBrowserAuthSession:() => ({accessToken:context.token, refreshToken:"refresh"}), readBrowserAccessToken:() => context.token,
    window:{setTimeout:fn => {timeout=fn; return 1;}, clearTimeout:() => {timeout=undefined;}},
    fetch:async (url, options) => {calls.push({url,options}); const data=JSON.parse(options.body); return response(data.mediaId, data.pinned);},
    setDeleteBusy:value => {busy=value;}, setDeleteStatus:message => messages.push(message), setPinOverrides:update => {overrides=update(overrides);},
    setOwnerToken:() => {}, persistRefreshedBrowserAuthSession:() => {}, currentViewer:{current:{viewer:null, items:photos(), activeItem:null}},
    onMediaPinned:(kind, id, pinned) => parentUpdates.push({kind, id, pinned}),
    pendingViewerIndex:{current:0}, viewerOpeningIndex:{current:0}, setViewer:value => calls.push({viewer:value}), settleViewerAtIndex:() => {},
  });
  vm.runInContext(compile(orderSource + handlerSource), context);
  return {context, calls, messages, parentUpdates, saved:() => overrides, busy:() => busy, expire:() => timeout?.()};
}

test("React public pins require server confirmation, share the action guard, and preserve latest viewer position", async () => {
  const f = reactFixture(), pending = deferred(), item = photos()[1];
  f.context.fetch = async (url, options) => {f.calls.push({url,options}); return pending.promise;};
  const save = f.context.pinMedia(item);
  await f.context.pinMedia(item);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.saved(), {});
  assert.deepEqual(f.parentUpdates, []);
  assert.equal(f.busy(), true);
  // User opened the first photo while the save was pending.
  f.context.currentViewer.current = {viewer:{kind:"photo", index:0}, items:photos(), activeItem:photos()[0]};
  pending.resolve(response(p2, true));
  await save;
  assert.equal(f.saved()[`photo:${p2}`], true);
  assert.deepEqual(f.parentUpdates, [{kind:"photo", id:p2, pinned:true}]);
  assert.equal(f.calls[1].viewer.index, 1);
  assert.equal(f.busy(), false);
  assert.equal(f.context.deleteInFlight.current, false);
});

test("React late pins cannot reopen a closed viewer, cross accounts, or update after unmount/timeout", async () => {
  for (const change of ["closed", "account", "unmounted", "timeout"]) {
    const f = reactFixture(), pending = deferred();
    f.context.fetch = () => pending.promise;
    const save = f.context.pinMedia(photos()[1]);
    if (change === "account") f.context.token = "other";
    if (change === "unmounted") {f.context.pinRequest.current.abort(); f.context.pinRequest.current = null;}
    if (change === "timeout") f.expire();
    pending.resolve(response(p2, true));
    await save;
    assert.equal(f.calls.length, 0);
    assert.equal(f.saved()[`photo:${p2}`], change === "closed" ? true : undefined);
  }
});

test("React failed or mismatched pins preserve state and release the busy guard", async () => {
  for (const result of [response(p2, true, false), response(p1, true), response(p2, false)]) {
    const f = reactFixture();
    f.context.fetch = async () => result;
    await f.context.pinMedia(photos()[1]);
    assert.deepEqual(f.saved(), {});
    assert.equal(f.busy(), false);
    assert.equal(f.context.deleteInFlight.current, false);
    assert.match(f.messages.at(-1), /try again/i);
  }
});

test("React pin sorting keeps photos and videos in their original section order when unpinned", () => {
  const f = reactFixture();
  for (const items of [photos(), videos()]) {
    items[1].isPinned = true;
    assert.equal(f.context.orderPinnedMedia(items)[0].id, items[1].id);
    items[1].isPinned = false;
    assert.equal(f.context.orderPinnedMedia(items)[0].id, items[0].id);
  }
});
