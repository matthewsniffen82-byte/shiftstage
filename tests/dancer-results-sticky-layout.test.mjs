import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const root = postcss.parse(readFileSync(new URL("../app/dashboard/dancer-results.css", import.meta.url), "utf8"));
const prefix = "body.dancr-button-system #dancer-dashboard .dancer-analytics-toolbar";
const compact = "body.dancr-button-system main#dancer-dashboard.dashboard-shell.dashboard-shell-dancer #dancer-performance ";
function values(selector) {
  const result = {};
  root.walkRules(selector, rule => {
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

test("Results sticks two pixels below the measured nav with safe-area and banner clearance", () => {
  const toolbar = values(prefix);
  assert.equal(toolbar.position, "sticky");
  assert.equal(toolbar["--dancer-results-sticky-gap"], "2px");
  assert.equal(toolbar.top, "calc(max(var(--mydancr-preview-banner-offset, 0px), var(--mydancr-demo-banner-height, 0px), env(safe-area-inset-top, 0px)) + var(--dancer-dashboard-nav-height, 94px) + var(--dancer-results-sticky-gap))");
  assert.equal(toolbar["z-index"], "30");
});

test("the toolbar has no opaque strip above its rounded border", () => {
  assert.deepEqual(values(prefix + "::before"), {});
});

test("tightening the gap preserves the control dimensions and navigation-aligned toolbar width", () => {
  const toolbar = values(compact + ".dancer-analytics-toolbar");
  assert.equal(toolbar.width, "calc(100% + var(--dancer-results-toolbar-outset) + var(--dancer-results-toolbar-outset))");
  assert.equal(toolbar["margin-inline"], "calc(0px - var(--dancer-results-toolbar-outset))");
  const periodPrefix = compact.replace("#dancer-performance ", "") + ".dancer-analytics-toolbar > .dancer-analytics-period";
  assert.equal(values(periodPrefix + " > button")["min-height"], "44px");
  assert.deepEqual(values(compact + ".dancer-analytics-toolbar > .dancer-analytics-period > button"), {});
  assert.equal(values(compact + ".dancer-results-club select")["min-height"], "44px");
});
