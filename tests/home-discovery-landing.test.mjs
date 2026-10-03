import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/live-shell/app/19-reset-home-discovery-feed-qr-prompt.js", import.meta.url), "utf8");
const functions = ["homeResultsDocumentTop", "alignHomeDiscoveryStart"].map((name) => {
  const fn = source.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`))?.[0];
  assert.ok(fn, `${name} must be present in the production source`);
  return fn;
}).join("\n");

function landing({ margin = "58px", padding = "auto", offset = 40, connected = true, filters = true } = {}) {
  const calls = [];
  const root = {};
  const controls = { isConnected: connected, offsetTop: offset, offsetParent: { offsetTop: 500 } };
  const heading = { isConnected: true, offsetTop: 760 };
  const citySelect = { closest: (selector) => selector === ".home-discovery-controls" && filters ? controls : null };
  const tabTitle = { closest: () => heading };
  const window = {
    scrollY: 2500,
    scrollTo: (value) => calls.push(value),
    getComputedStyle: (element) => element === root ? { scrollPaddingTop: padding } : { scrollMarginTop: margin },
  };
  const align = new Function("citySelect", "tabTitle", "results", "document", "window", `${functions}; return alignHomeDiscoveryStart;`)(
    citySelect, tabTitle, heading, { documentElement: root }, window,
  );
  return { align, calls };
}

test("Dancers, Clubs and TV land at the same filter position despite different scroll insets", () => {
  for (const config of [
    { margin: "58px", padding: "auto" },
    { margin: "58px", padding: "0px" },
    { margin: "0px", padding: "58px" },
  ]) {
    const { align, calls } = landing(config);
    align("smooth");
    assert.deepEqual(calls, [{ top: 482, left: 0, behavior: "smooth" }]);
  }
});

test("installed phone safe areas and layouts without a notice retain the same 12px filter clearance", () => {
  for (const [config, expected] of [
    [{ margin: "0px", padding: "105px" }, 435],
    [{ margin: "12px", padding: "auto" }, 528],
  ]) {
    const { align, calls } = landing(config);
    align();
    assert.equal(calls[0].top, expected);
  }
});

test("landing clamps at the page start, skips detached controls, and falls back when filters are absent", () => {
  const start = landing({ offset: -480 });
  start.align();
  assert.equal(start.calls[0].top, 0);
  const detached = landing({ connected: false });
  detached.align();
  assert.equal(detached.calls.length, 0);
  const fallback = landing({ filters: false });
  fallback.align();
  assert.equal(fallback.calls[0].top, 702);
});
