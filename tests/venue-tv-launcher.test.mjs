import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const panelSource = source("app/dashboard/VenueTvPanel.tsx");
function load(code, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name) });
  return exports;
}

function render({ count = 9, status = "", loading = false, hidden = false } = {}) {
  const states = [Array.from({ length: count }, (_, id) => ({ id: String(id) })), status, loading];
  const Panel = load(panelSource, {
    react: { ...React, useEffect() {}, useState: () => [states.shift(), () => {}] },
    "next/link": { default: props => React.createElement("a", props) },
    "@/src/lib/dancr/navigation": load(source("src/lib/dancr/navigation.ts")),
    "./dashboard-session": {},
    "./VenueDashboardIdentity": load(source("app/dashboard/VenueDashboardIdentity.tsx")),
  }).default;
  return renderToStaticMarkup(React.createElement(Panel, { city: "Las Vegas", venueId: "test-venue", hidden }));
}

test("the whole MyDancr TV control links to the current venue feed with its icon and count", () => {
  const html = render();
  assert.equal((html.match(/<a\b/g) || []).length, 1);
  assert.match(html, /<a class="venue-tv-launch-button"[^>]*href="\/\?city=Las%20Vegas&amp;view=tv&amp;tv_venue=test-venue"/);
  assert.match(html, /aria-labelledby="venue-tv-heading" aria-describedby="venue-tv-count"/);
  assert.match(html, /<a[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?MyDancr TV[\s\S]*?9 videos<\/span><\/a>/);
  assert.doesNotMatch(html, /class="venue-tv-panel"|class="venue-tv-title"/);
});

test("video states and workspace visibility are retained", () => {
  assert.match(render({ count: 1 }), />1 video<\/span>/);
  assert.match(render({ count: 0 }), />0 videos<\/span>[\s\S]*?<p>No videos yet\.<\/p>/);
  const loading = render({ count: 0, loading: true });
  assert.match(loading, /id="venue-tv-count" aria-live="polite">\u2026<\/span>/);
  assert.doesNotMatch(loading, /No videos yet/);
  const failed = render({ count: 0, status: "Unable to load venue videos." });
  assert.match(failed, />Unavailable<\/span>/);
  assert.match(failed, /role="status">Unable to load venue videos\.<\/p>/);
  assert.doesNotMatch(failed, /No videos yet/);
  assert.match(render({ hidden: true }), /<section[^>]*id="venue-tv" hidden=""/);
});

test("the launcher uses the shared gray face with a full-width touch target and keyboard focus", () => {
  const css = postcss.parse(panelSource.match(/<style>\{`([\s\S]*?)`\}<\/style>/)[1]);
  const declarations = selector => Object.fromEntries(css.nodes.find(node => node.selector === selector).nodes.map(node => [node.prop, node.value]));
  const button = declarations(".venue-tv-launch-button");
  assert.equal(button.background, "var(--dancr-control-secondary-background)");
  assert.equal(button.width, "100%");
  assert.equal(button["min-height"], "56px");
  assert.equal(button["flex-wrap"], "wrap");
  assert.match(declarations(".venue-tv-launch-button:focus-visible").outline, /^2px solid/);
  assert.equal(declarations(".venue-tv-launcher[hidden]").display, "none");
  assert.equal(declarations(".venue-tv-launcher").background, undefined);
});
