import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const home = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

function fixture({ signedIn = true, customerFlag = true } = {}) {
  const navigations = [], auth = [], legacy = [], publicContact = [];
  const context = vm.createContext({
    authSession: signedIn ? { accessToken: "navigation-test", account: { role: "customer" } } : null,
    activeDashboardType: "customer",
    isCustomerLoggedIn: customerFlag,
    isDancerLoggedIn: false,
    isCustomerSession: () => signedIn,
    isDancerSession: () => false,
    openAuthRole: role => auth.push(role),
    openPublicContactForm: () => publicContact.push(true),
    window: { location: { assign: url => navigations.push(url) } },
    customerDashboard: { classList: { add: value => legacy.push(value) } },
    profileReturnSurfaceElement: () => { throw new Error("Customer return must not resolve a legacy panel"); },
  });
  for (const name of ["openUnifiedDashboard", "openDashboard", "activeSupportRole", "openContactAdmin", "restoreProfileReturnContext"]) {
    const source = home.match(new RegExp(`    function ${name}\\([\\s\\S]*?\\n    }`))?.[0];
    assert.ok(source, `${name} must exist`);
    vm.runInContext(source, context);
  }
  return { context, navigations, auth, legacy, publicContact };
}

test("Contact opens Help & support in the current customer dashboard", () => {
  const f = fixture();
  f.context.openContactAdmin();
  assert.deepEqual(f.navigations, ["/dashboard/customer#customer-support"]);
  assert.deepEqual(f.legacy, []);
});

test("Contact recognizes a customer session before legacy login flags catch up", () => {
  const f = fixture({ customerFlag: false });
  f.context.openContactAdmin();
  assert.deepEqual(f.navigations, ["/dashboard/customer#customer-support"]);
});

test("unsigned visitors retain the public contact form", () => {
  const f = fixture({ signedIn: false, customerFlag: false });
  f.context.openContactAdmin();
  assert.deepEqual(f.publicContact, [true]);
  assert.deepEqual(f.navigations, []);
});

test("the legacy customer opener routes to the current dashboard", () => {
  const f = fixture();
  f.context.openDashboard();
  assert.deepEqual(f.navigations, ["/dashboard/customer"]);
  assert.deepEqual(f.legacy, []);
});

test("legacy demo flags cannot open a dashboard without a real session", () => {
  const f = fixture({ signedIn: false });
  f.context.openDashboard();
  assert.deepEqual(f.auth, ["customer"]);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.legacy, []);
});

test("returning from a profile cannot restore the old customer dashboard", () => {
  const f = fixture();
  assert.equal(f.context.restoreProfileReturnContext({ surface: "customer-dashboard", location: "/#customerDashboard" }), true);
  assert.deepEqual(f.navigations, ["/dashboard/customer"]);
  assert.deepEqual(f.legacy, []);
});

test("expired customer profile return requires sign-in instead of showing legacy UI", () => {
  const f = fixture({ signedIn: false });
  assert.equal(f.context.restoreProfileReturnContext({ surface: "customer-dashboard" }), false);
  assert.deepEqual(f.auth, ["customer"]);
  assert.deepEqual(f.legacy, []);
});

test("the retired customer surface stays hidden and inert even if an old show class returns", () => {
  const surface = home.match(/<section[^>]*id="customerDashboard"[^>]*>/)?.[0] || "";
  assert.match(surface, /hidden inert style="display: none !important;"/);
  assert.doesNotMatch(home, /customerDashboard\.classList\.add\("show"\)/);
});
