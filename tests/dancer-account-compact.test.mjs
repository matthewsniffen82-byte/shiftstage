import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const root = postcss.parse(read("app/dashboard/dancer-account.css"));
const scope = "body.dancr-button-system #dancer-dashboard #dancer-destination-account";
function values(suffix, media) {
  const result = {};
  root.walkRules(rule => {
    if (rule.selector !== scope + suffix || (rule.parent.type === "atrule" ? rule.parent.params : undefined) !== media) return;
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

test("all compact styles are limited to the full dancer Account destination", () => {
  assert.match(read("app/dashboard/DancerDashboardWorkspace.tsx"), /import "\.\/dancer-account\.css"/);
  root.walkRules(rule => assert.ok(rule.selector.startsWith(scope), rule.selector));
  assert.equal(values("").gap, "8px");
  assert.equal(values("").display, undefined, "do not override the hidden destination state");
  root.walkDecls("display", decl => assert.notEqual(decl.value, "none", "account content must remain accessible"));
});

test("section and panel padding no longer nests framed cards", () => {
  for (const selector of [" > .dashboard-section", " .info-panel"]) {
    const panel = values(selector);
    assert.equal(panel.border, "0");
    assert.equal(panel["border-radius"], "0");
    assert.equal(panel.background, "transparent");
  }
  assert.equal(values(" > .dashboard-section").padding, "0");
  assert.equal(values(" > .dashboard-section > .venue-dashboard-section-body").padding, "6px 0 10px");
  assert.equal(values(" > .dashboard-section > summary")["min-height"], "56px");
});

test("credentials wrap safely and retain mobile input and password-toggle clearance", () => {
  const fields = values(" :is(.customer-credential-form input, .support-panel input, .support-panel textarea, .account-delete-confirmation input)");
  assert.equal(fields["min-height"], "44px");
  assert.equal(fields["font-size"], "16px");
  assert.equal(fields["min-width"], "0");
  assert.equal(values(" .customer-password-control input")["padding-right"], "56px");
  assert.equal(values(" .customer-account-email > strong")["overflow-wrap"], "anywhere");
  assert.equal(values(" :is(.customer-credential-options, .customer-credential-form-actions)")["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(values(" .customer-credential-options", "(max-width: 360px)")["grid-template-columns"], "minmax(0, 1fr)");
});

test("compact notifications keep full switch targets and wrap the inbox toolbar", () => {
  const toggle = values(" button.dancer-notification-switch");
  assert.equal(toggle["min-height"], "44px");
  assert.equal(toggle.width, "64px");
  assert.equal(values(" .dancer-preference-row")["grid-template-columns"], "minmax(0, 1fr) 64px");
  assert.equal(values(" .notification-toolbar")["flex-wrap"], "wrap");
  assert.equal(values(" .notification-row")["min-height"], "44px");
});

test("connected-club controls and support fields stay usable in the compact layout", () => {
  assert.equal(values(" .dancer-nfc-panel-compact > summary")["min-height"], "44px");
  assert.equal(values(" .dancer-nfc-roster section > span")["min-width"], "0");
  const textarea = values(" .support-panel textarea");
  assert.equal(textarea["min-height"], "88px");
  assert.equal(textarea.resize, "vertical");
  assert.equal(values(" .dancer-agreement-panel")["flex-wrap"], "wrap");
});

test("short security actions stay beside their descriptions without removing delete safeguards", () => {
  assert.equal(values(" .account-action-row")["grid-template-columns"], "minmax(0, 1fr) auto");
  assert.equal(values(" .account-action-row > .account-action-button").width, "auto");
  assert.equal(values(" .account-action-row > .account-action-button")["min-width"], "78px");
  const shared = read("app/dashboard/DashboardShared.tsx");
  assert.match(shared, /Type <strong>DELETE<\/strong> to confirm/);
  assert.match(shared, /disabled=\{isWorking \|\| deleteConfirmation !== "DELETE"\}/);
});

test("command sizing preserves a minimum 44px touch area across Account sections", () => {
  const command = root.nodes.find(rule => rule.type === "rule" && rule.selector.includes(".customer-credential-option, .customer-credential-form-actions button"));
  const declarations = Object.fromEntries(command.nodes.map(decl => [decl.prop, decl.value]));
  assert.equal(declarations["min-height"], "44px");
  assert.equal(declarations["white-space"], "normal");
  assert.equal(declarations["overflow-wrap"], "anywhere");
});

test("Account uses a single mobile column and two desktop columns without implicit tracks", () => {
  assert.equal(values(" .venue-dashboard-account-grid")["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(values(" .venue-dashboard-account-grid > .info-panel")["grid-column"], "auto");
  assert.equal(values(" .venue-dashboard-account-grid", "(min-width: 900px)")["grid-template-columns"], "repeat(2, minmax(0, 1fr))");
  assert.equal(values(" .venue-dashboard-account-grid > :is(.account-controls-panel, .dancer-agreement-panel)", "(min-width: 900px)")["grid-column"], "1 / -1");
});
