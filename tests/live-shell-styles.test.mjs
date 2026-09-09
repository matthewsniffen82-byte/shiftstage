import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { externalizeLiveShellStyles, extractLiveShellStyles } from "../src/lib/dancr/live-shell-styles.mjs";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";

const html = (await readFile(new URL("../outputs/index.html", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");

test("external CSS preserves every declaration and exact cascade position", () => {
  const css = extractLiveShellStyles(html);
  const link = '<link rel="stylesheet" href="/outputs/live-shell.css?v=test">';
  const result = externalizeLiveShellStyles(html, "/outputs/live-shell.css?v=test");
  assert.ok(css.length > 800_000);
  assert.equal(result.replace(link, `<style>${css}</style>`), html);
  assert.equal(createRootContentSecurityPolicy(result), createRootContentSecurityPolicy(html));
  assert.ok(result.indexOf(link) < result.indexOf('/dancr-brand-tokens.v1.css'));
  assert.match(result, /Keep the city readable/);
  assert.match(result, /main\.stack,/);
});

test("stylesheet URL keeps the document base for relative asset references", () => {
  assert.equal(new URL("asset.webp", "https://www.mydancr.com/outputs/live-shell.css").href,
    new URL("asset.webp", "https://www.mydancr.com/outputs/").href);
  assert.throws(() => extractLiveShellStyles("<style>body{color:red}</style>"), /could not be found/);
});

test("stylesheet delivery only grants immutable caching to the matching release", async () => {
  const route = await readFile(new URL("../app/outputs/live-shell.css/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestedVersion === LIVE_SHELL_SHA256/);
  assert.match(route, /public, max-age=31536000, immutable/);
  assert.match(route, /public, max-age=0, must-revalidate/);
  assert.match(route, /text\/css; charset=utf-8/);
});
