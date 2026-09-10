import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function contact({ session = true, loginFlag = true, cachedApproval = false, role = "dancer", accountState = "active" } = {}) {
  const destinations = [], signIns = [];
  const context = {
    authSession: session ? { accessToken: "fixture", account: { role, accountState } } : null,
    isDancerSession: () => session && role === "dancer",
    isCustomerSession: () => false,
    isVenueSession: () => session && role === "venue",
    isVenueLoggedIn: loginFlag && role === "venue",
    isDancerLoggedIn: loginFlag && role === "dancer",
    isCustomerLoggedIn: false,
    dancerSetup: { approval: cachedApproval },
    openAuthRole: role => signIns.push(role),
    window: { location: { assign: url => destinations.push(url) } },
    openDancerDashboard: () => assert.fail("Contact must never open the legacy dancer dashboard"),
  };
  const functions = ["activeSupportRole", "openUnifiedDashboard", "openContactAdmin"].map(name => {
    const source = home.match(new RegExp(`    function ${name}\\([\\s\\S]*?\\n    }`))?.[0];
    assert.ok(source, `${name} must exist`);
    return source;
  });
  runInNewContext(functions.join("\n") + "\nopenContactAdmin();", context);
  return { destinations, signIns };
}

for (const cachedApproval of [false, true]) test(`dancer Contact uses current messaging regardless of cached approval (${cachedApproval})`, () => {
  assert.deepEqual(contact({ cachedApproval }).destinations, ["/dashboard/dancer#dancer-support"]);
});

test("dancer Contact works before the old login flag catches up", () => {
  assert.deepEqual(contact({ loginFlag: false }).destinations, ["/dashboard/dancer#dancer-support"]);
});

test("an expired dancer session opens sign-in instead of the legacy dashboard", () => {
  const result = contact({ session: false });
  assert.deepEqual(result.destinations, []);
  assert.deepEqual(result.signIns, ["dancer"]);
});

for (const accountState of ["active", "disabled"]) test(`venue Contact opens messaging for an ${accountState} account`, () => {
  assert.deepEqual(contact({ role: "venue", accountState, loginFlag: false }).destinations, ["/dashboard/venue#venue-support"]);
});

// Exercise the real dashboard branch and approval helper with saved profile states.
const approval = {};
runInNewContext(compile(readFileSync(new URL("../src/lib/dancr/profile-approval.ts", import.meta.url), "utf8")), { exports: approval });
const panelSource = dashboard.slice(dashboard.indexOf("function DancerPanel("), dashboard.indexOf("\nfunction DancerActivationConfirmation("));
const panelCode = compile(panelSource + "\nexport { DancerPanel };");
function sections(profile, accountState = "active") {
  const exports = {};
  const components = Object.fromEntries([...panelSource.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map(match => [match[1], match[1]]));
  runInNewContext(panelCode, {
    ...components, exports,
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect() {}, useCallback: fn => fn,
    effectiveDancerProfileStatus: approval.effectiveDancerProfileStatus,
    dancerNeedsCommissionPayoutSetup: () => false,
    dancerPhotoItemsFromProfile: () => [],
    persistedDancerStageName: () => "Fixture",
    normalizePhotoStatus: value => value, photoStatusLabel: () => "Approved",
    formatCents: () => "$0", formatRankMove: () => "—",
    saveDancerProfileEditor() {},
  });
  const tree = exports.DancerPanel({ profile, accountState, affiliations: [] });
  return tree.props.children.flat(Infinity).filter(Boolean);
}

for (const profile of [
  { status: "draft", verification_status: "pending" },
  { status: "pending_review", verification_status: "pending", photo_review_status: "approved" },
  { status: "approved", verification_status: "pending", photo_review_status: "approved" },
]) test(`pre-tap profile stays in onboarding (${profile.status})`, () => {
  const nodes = sections(profile);
  assert.ok(nodes.some(node => node.type === "DancerOnboardingCommand"));
  assert.ok(!nodes.some(node => ["dancer-overview", "dancer-schedule", "dancer-performance"].includes(node.props?.id)));
});

test("a fully approved dancer gets the full dashboard even while incognito", () => {
  const nodes = sections({ status: "approved", verification_status: "approved", venue_approved_at: "2026-09-07T12:00:00Z", is_public: false });
  assert.ok(!nodes.some(node => node.type === "DancerOnboardingCommand"));
  for (const id of ["dancer-overview", "dancer-profile-media", "dancer-schedule", "dancer-performance"]) {
    assert.ok(nodes.some(node => node.props?.id === id), `${id} should be present`);
  }
});

test("Contact targets messaging inside Help & Account and opens its collapsed ancestors after loading", () => {
  const account = dashboard.slice(dashboard.indexOf('id="dancer-account"'), dashboard.indexOf('id="venue-account"'));
  assert.match(account, /<SupportInboxPanel[^>]*panelId="dancer-support"/);
  const inbox = dashboard.slice(dashboard.indexOf("function SupportInboxPanel("), dashboard.indexOf("\nfunction AccountControlsPanel("));
  assert.match(inbox, /id=\{panelId\} tabIndex=\{panelId \? -1 : undefined\}/);
  const start = dashboard.indexOf('  useEffect(() => {\n    if (isLoading || state.error) return;');
  const end = dashboard.indexOf('\n\n  const updateProfile', start);
  assert.ok(start >= 0 && end > start);
  const effect = dashboard.slice(start, end);
  class Details { open = false; parentElement = null; }
  const accountDetails = new Details();
  const calls = [];
  const support = { parentElement: accountDetails, scrollIntoView: () => calls.push("scroll"), focus: () => calls.push("focus") };
  let pendingFrame;
  const context = {
    isLoading: true, state: {}, role: "dancer", initialSection: undefined,
    supportReady: true, initialSectionTargetRef: { current: "" },
    useEffect: fn => fn(), HTMLDetailsElement: Details,
    document: { getElementById: id => id === "dancer-support" ? support : null },
    window: { location: { hash: "#dancer-support" }, requestAnimationFrame: fn => { pendingFrame = fn; return 1; }, cancelAnimationFrame() {} },
  };
  runInNewContext(effect, context);
  assert.equal(pendingFrame, undefined, "wait for the loaded profile and support panel");
  context.isLoading = false;
  runInNewContext(effect, context);
  pendingFrame();
  assert.equal(accountDetails.open, true);
  assert.deepEqual(calls, ["scroll", "focus"]);
});

test("paused venue Contact waits for deferred messaging and navigates only once", () => {
  const start = dashboard.indexOf('  useEffect(() => {\n    if (isLoading || state.error) return;');
  const end = dashboard.indexOf('\n\n  const updateProfile', start);
  const effect = dashboard.slice(start, end);
  class Details { open = false; parentElement = null; }
  const account = new Details();
  const calls = [];
  const support = { parentElement: account, scrollIntoView: () => calls.push("scroll"), focus: () => calls.push("focus") };
  let mounted = false, pendingFrame, previousDependencies;
  const context = {
    isLoading: true, state: { account: { accountState: "disabled" } }, role: "venue", initialSection: undefined,
    supportReady: false, initialSectionTargetRef: { current: "" }, HTMLDetailsElement: Details,
    useEffect: (callback, dependencies) => {
      if (!previousDependencies || dependencies.some((value, index) => !Object.is(value, previousDependencies[index]))) callback();
      previousDependencies = dependencies;
    },
    document: { getElementById: id => mounted && id === "venue-support" ? support : null },
    window: { location: { hash: "#venue-support" }, requestAnimationFrame: callback => { pendingFrame = callback; return 1; }, cancelAnimationFrame() {} },
  };
  const render = () => {
    pendingFrame = undefined;
    runInNewContext(effect, context);
    pendingFrame?.();
  };
  render();
  context.isLoading = false;
  render();
  assert.deepEqual(calls, [], "recovery can render before messaging without losing the destination");
  assert.equal(context.initialSectionTargetRef.current, "");
  mounted = true;
  context.supportReady = true;
  context.state.supportThreads = [];
  render();
  assert.equal(account.open, true);
  assert.deepEqual(calls, ["scroll", "focus"], "opening Contact must land on messaging when it arrives");
  context.state.supportThreads = [{ id: "refreshed-thread" }];
  render();
  // A later reload must not steal the user's position after Contact has landed.
  context.isLoading = true;
  render();
  context.isLoading = false;
  render();
  assert.deepEqual(calls, ["scroll", "focus"]);
});

test("opening Help & Account does not scroll away from its focused messaging panel", () => {
  const start = dashboard.indexOf("function alignOpenedDashboardSection(");
  const end = dashboard.indexOf("\nfunction DashboardLoadingState(", start);
  const exports = {}, calls = [], support = {}, summary = {};
  const section = { open: true, querySelector: () => summary, contains: el => el === support || el === summary, scrollIntoView: () => calls.push("heading") };
  const document = { activeElement: support };
  runInNewContext(compile(dashboard.slice(start, end) + "\nexport { alignOpenedDashboardSection };"), {
    exports, document,
    window: { requestAnimationFrame: fn => fn(), matchMedia: () => ({ matches: true }) },
  });
  exports.alignOpenedDashboardSection({ target: section, currentTarget: section });
  assert.deepEqual(calls, [], "preserve the messaging destination");
  document.activeElement = summary;
  exports.alignOpenedDashboardSection({ target: section, currentTarget: section });
  assert.deepEqual(calls, ["heading"], "manual section opening still aligns the heading");
});
