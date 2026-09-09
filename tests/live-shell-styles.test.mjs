import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inlineLiveShellStyles, extractLiveShellStyles } from "../src/lib/dancr/live-shell-styles.mjs";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";
import postcss from "postcss";
import { compactLiveShellStyles } from "../src/lib/dancr/compact-live-shell-styles.mjs";
import { staticAssetCacheHeaders, versionedStaticAssetUrl } from "../src/lib/dancr/static-asset-cache.mjs";

const html = (await readFile(new URL("../outputs/index.html", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");

test("inline CSS preserves the exact cascade position without another request", () => {
  const css = extractLiveShellStyles(html);
  const result = inlineLiveShellStyles(html, compactLiveShellStyles(css));
  assert.ok(css.length > 800_000);
  assert.equal(inlineLiveShellStyles(html, css), html);
  assert.ok(inlineLiveShellStyles(html, ':root{--literal:"$&"}').includes('<style>:root{--literal:"$&"}</style>'));
  assert.equal(createRootContentSecurityPolicy(result), createRootContentSecurityPolicy(html));
  assert.ok(result.indexOf(`<style>${compactLiveShellStyles(css)}</style>`) < result.indexOf('/dancr-brand-tokens.v1.css'));
  assert.match(result, /Keep the city readable/);
  assert.match(result, /main\.stack,/);
});

test("stylesheet URL keeps the document base for relative asset references", () => {
  assert.equal(new URL("asset.webp", "https://www.mydancr.com/outputs/live-shell.css").href,
    new URL("asset.webp", "https://www.mydancr.com/outputs/").href);
  assert.throws(() => extractLiveShellStyles("<style>body{color:red}</style>"), /could not be found/);
});

test("critical CSS stays inline and the deployment includes the build artifact", async () => {
  const source = await readFile(new URL("../app/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rel=preload|externalizeLiveShellStyles/);
  assert.match(source, /inlineLiveShellStyles\(withExternalAppScript, compactStyles\)/);
  const config = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /"\/": \["\.\/public\/outputs\/live-shell\.css"\]/);
});

test("the build emits compact static CSS with a matching content version", async () => {
  const original = extractLiveShellStyles(html);
  const compact = compactLiveShellStyles(original);
  assert.equal(await readFile(new URL("../public/outputs/live-shell.css", import.meta.url), "utf8"), compact);
  function signature(css) {
    const result = [];
    postcss.parse(css).walk(node => result.push([node.type, node.selector, node.prop, node.value, node.important, node.name, node.params, node.text]));
    return result;
  }
  assert.deepEqual(signature(compact), signature(original));
  assert.ok(compact.length < original.length);
  const url = new URL(versionedStaticAssetUrl("/outputs/live-shell.css"), "https://example.com");
  const headers = staticAssetCacheHeaders().filter(rule => rule.source === url.pathname);
  assert.equal(headers[0].headers[0].value, "public, max-age=0, must-revalidate");
  assert.equal(headers[1].has[0].value, url.searchParams.get("v"));
  assert.equal(headers[1].headers[0].value, "public, max-age=31536000, immutable");
});
