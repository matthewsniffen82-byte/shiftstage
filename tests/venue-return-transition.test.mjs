import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/live-shell/app/26-sync-discovery-city-scope.js", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../src/live-shell/device-bootstrap.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("startup.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const openShared = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "openSharedProfileFromUrl").getText(ast);
const startup = ast.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast).startsWith("!restoredAuthResume")).getText(ast);

function fixture({ search = "?city=Las+Vegas&venue=silver-circuit", venue = { slug: "silver-circuit", name: "Silver Circuit" }, cityExists = true, error = false, auth = false } = {}) {
  const classes = new Set(), calls = [];
  const document = {
    documentElement: { classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: value => classes.delete(value) }, style: { setProperty() {} } },
    readyState: "loading", addEventListener() {}, getElementById: () => null, querySelectorAll: () => [],
  };
  let release;
  const discovery = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    URLSearchParams, URL, document, navigator: { userAgent: "Android Mobile" },
    window: { location: { search }, addEventListener() {} },
    discoveryMarket: () => cityExists ? { dancers: [] } : null,
    citySelect: {}, activeTab: "dancers", liveMarketState: { "Las Vegas": error ? "error" : "ready" },
    resolveVenueByName: () => venue,
    openVenueFromName(value) { calls.push({ type: "venue", value, covered: classes.has("venue-profile-bootstrap") }); },
    scrollToSharedVenueSection() { calls.push({ type: "section" }); },
    render() { calls.push({ type: "directory", covered: classes.has("venue-profile-bootstrap") }); },
    showToast(message) { calls.push({ type: "toast", message }); },
    setTimeout() { throw new Error("Venue navigation must not wait for a timer"); },
    initialDiscoveryRequest: discovery, initialVenuePreviewRequest: null, restoredAuthResume: auth,
    handleVenueDancerVerificationDeepLink: () => false, handleAdminDashboardDeepLink: () => false,
    handleVenueDashboardDeepLink: () => false, handleDancerDashboardDeepLink: () => false,
    handleVenueAccessDeepLink: () => false, handleAccountAccessDeepLink: () => false,
  });
  vm.runInContext(bootstrap, context);
  return { classes, calls, start() { vm.runInContext(openShared + "\n" + startup, context); },
    async finish() { release(); await new Promise(resolve => setImmediate(resolve)); } };
}

test("public venue returns are covered before app startup while normal homepage and private previews keep their own behavior", () => {
  assert.ok(fixture().classes.has("venue-profile-bootstrap"));
  for (const search of ["", "?city=Las+Vegas&view=venues", "?city=Las+Vegas&profile=luna"]) {
    assert.equal(fixture({ search }).classes.has("venue-profile-bootstrap"), false);
  }
  const preview = fixture({ search: "?city=Las+Vegas&venue=silver-circuit&venue_preview=1" });
  assert.ok(preview.classes.has("venue-preview-bootstrap"));
  assert.equal(preview.classes.has("venue-profile-bootstrap"), false);
});

test("the requested venue opens before uncovering the page without an intermediate directory render or timer", async () => {
  const f = fixture(); f.start();
  assert.ok(f.classes.has("venue-profile-bootstrap"));
  assert.deepEqual(f.calls, []);
  await f.finish();
  assert.deepEqual(f.calls, [{ type: "venue", value: "silver-circuit", covered: true }, { type: "section" }]);
  assert.equal(f.classes.has("venue-profile-bootstrap"), false);
});

test("missing and hidden venues release the loading cover and show the existing directory with an explanation", async () => {
  for (const venue of [null, { slug: "hidden-club", hidden: true }]) {
    const f = fixture({ venue }); f.start(); await f.finish();
    assert.equal(f.classes.has("venue-profile-bootstrap"), false);
    assert.deepEqual(f.calls, [{ type: "directory", covered: true }, { type: "toast", message: "Club profile not found" }]);
  }
});

test("discovery failure exposes its retry screen, and invalid links or auth destinations cannot leave the loading cover stuck", async () => {
  const failed = fixture({ venue: null, error: true }); failed.start(); await failed.finish();
  assert.deepEqual(failed.calls, [{ type: "directory", covered: true }]);
  assert.equal(failed.classes.has("venue-profile-bootstrap"), false);
  for (const options of [{ cityExists: false }, { search: "?venue=silver-circuit" }, { auth: true }]) {
    const f = fixture(options); f.start(); await f.finish();
    assert.deepEqual(f.calls, []);
    assert.equal(f.classes.has("venue-profile-bootstrap"), false);
  }
});
