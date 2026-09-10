import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { compactLiveShellScript } from "../scripts/lib/compact-live-shell-script.mjs";
import { externalizeLiveShellAppScript, extractLiveShellAppScript } from "../src/lib/dancr/live-shell-script.mjs";
import { LIVE_SHELL_SCRIPT_SHA256 } from "../src/generated/live-shell-script-version.mjs";

const [html, delivered, routeSource, nextConfig] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../outputs/live-shell-app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/live-shell.js/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../next.config.mjs", import.meta.url), "utf8"),
]);
const normalized = html.replace(/\r\n?/g, "\n");
const original = extractLiveShellAppScript(normalized);
const sourceVersion = createHash("sha256").update(normalized).digest("hex");

test("cold loads discover the app before styles without blocking on its helpers", () => {
  const url = `/live-shell.js?v=${LIVE_SHELL_SCRIPT_SHA256}`;
  const page = externalizeLiveShellAppScript(normalized, url);
  const preload = `<link rel="preload" as="script" href="${url}">`;
  assert.ok(page.indexOf(preload) < page.indexOf("<style>"));
  const scripts = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  assert.deepEqual(scripts.slice(0, 2).map(match => match[1].split("?")[0]), [
    "/mydancr-api-transport.js", "/profile-photo-crop.js",
  ]);
  assert.ok(scripts.every(match => /\bdefer\b/.test(match[0])));
  assert.equal(scripts.filter(match => match[1] === url).length, 1);
  assert.equal(scripts.at(-1)[1], url, "preserve helper-before-app execution order");
});

test("the generated script is deterministic, smaller, and content-addressed", async () => {
  assert.equal(delivered, await compactLiveShellScript(original));
  assert.equal(createHash("sha256").update(delivered).digest("hex"), LIVE_SHELL_SCRIPT_SHA256);
  assert.ok(Buffer.byteLength(delivered) < Buffer.byteLength(original) * 0.75);
  assert.ok(gzipSync(delivered).length < gzipSync(original).length * 0.85);
  assert.doesNotThrow(() => new vm.Script(delivered));
  assert.match(nextConfig, /"\/live-shell\.js": \["\.\/outputs\/live-shell-app\.js"\]/);
});

test("compaction preserves classic globals, callback names, closures, templates and eval", async () => {
  const fixture = [
    'const selectedCity = "Las Vegas";',
    'let selectedTab = "all";',
    'class DiscoveryCard { constructor(name) { this.stageName = name; } }',
    'function chooseTab(tab) { selectedTab = tab; return selectedCity + ":" + selectedTab; }',
    'function makeHandler(venueName) { return function openProfile() { return `Open ${venueName} · ×`; }; }',
    'function readDynamicName() { const localName = "Nikki"; return eval("localName"); }',
    'globalThis.card = new DiscoveryCard("Nikki");',
    'globalThis.handler = makeHandler("Starlight Club");',
    'globalThis.result = [chooseTab("now"), handler(), readDynamicName(), card.stageName, handler.name, DiscoveryCard.name];',
  ].join("\n");
  const before = vm.createContext({});
  const after = vm.createContext({});
  vm.runInContext(fixture, before);
  vm.runInContext(await compactLiveShellScript(fixture), after);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result));
  assert.equal(vm.runInContext('chooseTab("upcoming")', after), "Las Vegas:upcoming");
  assert.equal(vm.runInContext("selectedTab", after), "upcoming");
});

function scriptRoute(mode) {
  const exports = {};
  const dependencies = {
    "node:fs/promises": { readFile },
    "node:path": path,
    "../../src/generated/live-shell-version": { LIVE_SHELL_SHA256: sourceVersion },
    "../../src/generated/live-shell-script-version.mjs": { LIVE_SHELL_SCRIPT_SHA256 },
    "../../src/lib/dancr/live-shell-script.mjs": { extractLiveShellAppScript },
  };
  const code = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
    process: { cwd: () => process.cwd(), env: { NODE_ENV: mode } }, Response, URL,
  });
  return exports.GET;
}

test("production serves built bytes and only their exact version is immutable", async () => {
  const get = scriptRoute("production");
  for (const version of [LIVE_SHELL_SCRIPT_SHA256, sourceVersion, "old-version", ""]) {
    const response = await get(new Request(`https://www.mydancr.com/live-shell.js?v=${version}`));
    assert.equal(await response.text(), delivered);
    assert.equal(response.headers.get("x-dancr-live-shell-script-version"), LIVE_SHELL_SCRIPT_SHA256);
    assert.equal(response.headers.get("cache-control"), version === LIVE_SHELL_SCRIPT_SHA256
      ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate");
  }
});

test("development keeps source edits visible without requiring a production rebuild", async () => {
  const response = await scriptRoute("development")(new Request(`http://localhost/live-shell.js?v=${sourceVersion}`));
  assert.equal(await response.text(), original);
  assert.equal(response.headers.get("x-dancr-live-shell-script-version"), sourceVersion);
});
