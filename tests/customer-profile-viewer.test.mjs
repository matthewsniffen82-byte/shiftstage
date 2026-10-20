import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("app/dashboard/CustomerProfileViewer.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const id = "00000000-0000-4000-8000-000000000001";
function fixture(props = {}, request = async () => ({}), sameSession = () => true) {
  const states = [], exports = {};
  let cursor = 0;
  class Element { constructor(link) { this.link = link; } closest() { return this.link; } }
  vm.runInNewContext(code, {
    exports, URL, Element, window: { location: { origin: "https://example.invalid" } },
    require: name => name === "react" ? {
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
    } : name === "react/jsx-runtime" ? require(name)
      : name === "./dashboard-session" ? { requestDashboardJson: request }
      : name.endsWith("/browser-session") ? { captureBrowserAuthSessionGuard: () => sameSession }
      : { ClubProfileDialog: "dialog" },
  });
  const children = { type: "Dashboard", props: { children: "Unfinished form" } };
  const render = () => { cursor = 0; return exports.CustomerProfileViewer({ children, ...props }); };
  const link = { href: "https://example.invalid/?city=Las+Vegas&profile=star", target: "", hasAttribute: () => false,
    dataset: { profileId: id, profileName: "Star" }, querySelector: () => ({ currentSrc: "https://example.invalid/card.jpg" }) };
  const event = overrides => ({ button: 0, target: new Element(link), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides });
  return { render, event, link, children };
}

test("all customer cards use one warm viewer and keep the dashboard mounted", () => {
  const f = fixture();
  let tree = f.render();
  assert.equal(tree.props.children[2].props.prewarm, true);
  const event = f.event();
  tree.props.children[0].props.onClickCapture(event);
  tree = f.render();
  assert.equal(event.defaultPrevented, true);
  assert.equal(tree.props.children[0].props.children, f.children);
  const viewer = tree.props.children[2].props;
  assert.equal(viewer.profile, null, "The frame must authorize public content itself");
  assert.equal(viewer.profileId, id);
  assert.equal(viewer.publicSlug, "star");
  assert.equal(viewer.loadingIdentity.photoUrl, "https://example.invalid/card.jpg");
  viewer.onClose();
  assert.equal(f.render().props.children[2].props.profileId, "");
  assert.equal(f.render().props.children[0].props.children, f.children);
});

test("modified clicks, new tabs, downloads and foreign URLs retain ordinary link behavior", () => {
  for (const override of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const f = fixture(), event = f.event(override);
    f.render().props.children[0].props.onClickCapture(event);
    assert.equal(f.render().props.children[2].props.profileId, "");
  }
  for (const change of [{ target: "_blank" }, { hasAttribute: () => true }, { href: "https://foreign.invalid/?profile=star" }, { href: "https://example.invalid/venues/club" }, { dataset: { profileId: "invalid" } }]) {
    const f = fixture(); Object.assign(f.link, change);
    const event = f.event(); f.render().props.children[0].props.onClickCapture(event);
    assert.equal(event.defaultPrevented, false);
  }
});

test("unavailable customer profiles close the viewer and show a retry message", () => {
  const f = fixture();
  f.render().props.children[0].props.onClickCapture(f.event());
  f.render().props.children[2].props.onError();
  const tree = f.render();
  assert.equal(tree.props.children[2].props.profileId, "");
  assert.match(tree.props.children[1].props.children, /unavailable.*try again/i);
});

test("confirmed follows and Going appear immediately, and closing reconciles actions without overwriting edits", async () => {
  const saved = { follows: [{ dancerId: id, notificationsEnabled: true }], goingSignals: [{ shift: { status: "posted", dancer: { id } } }], dealSaves: [{ dealId: "device", deviceOnly: true }] };
  const updates = [];
  const f = fixture({ saved, onSavedChange: update => updates.push(update) }, async () => ({ saved: { follows: [], goingSignals: [] } }));
  f.render().props.children[0].props.onClickCapture(f.event());
  const viewer = f.render().props.children[2].props;
  assert.deepEqual(JSON.parse(JSON.stringify(viewer.publicActions)), { following: true, notificationsEnabled: true, going: true });
  viewer.onClose();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(updates[0](saved).follows, []);
  assert.equal(updates[0](saved).dealSaves, saved.dealSaves, "Local saved deals survive reconciliation");
  const newer = { ...saved, follows: [{ dancerId: "another" }] };
  assert.equal(updates[0](newer), newer, "An older read cannot overwrite a newer dashboard edit");
});

test("a profile close read cannot overwrite a different signed-in account", async () => {
  let active = true, finish;
  const response = new Promise(resolve => { finish = resolve; });
  const f = fixture({ saved: {}, onSavedChange: () => assert.fail("Changed account cannot receive this response") }, () => response, () => active);
  f.render().props.children[2].props.onClose();
  active = false; finish({ saved: { follows: [] } });
  await new Promise(resolve => setImmediate(resolve));
});
