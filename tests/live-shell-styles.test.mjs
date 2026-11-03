import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inlineLiveShellStyles, extractLiveShellStyles, externalizeLiveShellStyles, extractLiveShellOverrideStyles } from "../src/lib/dancr/live-shell-styles.mjs";
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

test("production uses versioned stylesheets at their original cascade positions", async () => {
  const source = await readFile(new URL("../app/route.ts", import.meta.url), "utf8");
  assert.match(source, /externalizeLiveShellStyles\(withExternalAppScript\)/);
  const result = externalizeLiveShellStyles(html);
  assert.ok(result.indexOf('/outputs/live-shell.css') < result.indexOf('/dancr-brand-tokens.v1.css'));
  assert.ok(result.indexOf('/outputs/live-shell-overrides.css') > result.indexOf('/dancr-brand-tokens.v1.css'));
  assert.ok(result.length < html.length - 1_000_000);
  assert.equal(createRootContentSecurityPolicy(result), createRootContentSecurityPolicy(html));
});

test("the build emits compact static CSS with a matching content version", async () => {
  const original = extractLiveShellStyles(html);
  const compact = compactLiveShellStyles(original);
  assert.equal(await readFile(new URL("../public/outputs/live-shell.css", import.meta.url), "utf8"), compact);
  function signature(css) {
    const result = [];
    const root = postcss.parse(css);
    const normalize = container => {
      const rules = (container.nodes || []).filter(node => node.type === 'rule');
      const identity = rule => JSON.stringify([rule.selector, rule.nodes.map(n => [n.type,n.prop,n.value,n.important,n.text])]);
      const identities = rules.map(identity), last = new Map(identities.map((key,index)=>[key,index]));
      for (const [index, rule] of rules.entries()) if (last.get(identities[index]) !== index) rule.remove();
      for (const child of container.nodes || []) if (child.type === 'atrule' && /^(media|supports|container)$/i.test(child.name)) normalize(child);
    };
    normalize(root);
    root.walk(node => result.push([node.type, node.selector, node.prop, node.value, node.important, node.name, node.params, node.text]));
    return result;
  }
  assert.deepEqual(signature(compact), signature(original));
  const overrides = extractLiveShellOverrideStyles(html);
  const compactOverrides = await readFile(new URL('../public/outputs/live-shell-overrides.css', import.meta.url), 'utf8');
  assert.deepEqual(signature(compactOverrides), signature(overrides));
  const theme = await readFile(new URL('../public/dancr-aesthetic.v1.css', import.meta.url), 'utf8');
  const compactTheme = await readFile(new URL('../public/outputs/dancr-aesthetic.css', import.meta.url), 'utf8');
  assert.deepEqual(signature(compactTheme), signature(theme), 'same selectors, declarations, media queries and cascade');
  assert.ok(compactTheme.length < theme.length * .95);
  assert.ok(compact.length < original.length);
  const url = new URL(versionedStaticAssetUrl("/outputs/live-shell.css"), "https://example.com");
  const headers = staticAssetCacheHeaders().filter(rule => rule.source === url.pathname);
  assert.equal(headers[0].headers[0].value, "public, max-age=0, must-revalidate");
  assert.equal(headers[1].has[0].value, url.searchParams.get("v"));
  assert.equal(headers[1].headers[0].value, "public, max-age=31536000, immutable");
});

test('CSS deduplication retains the last rule and never crosses media, layers or keyframes', () => {
  const css = '.a{color:red}.b{color:blue}.a{color:red}@media(max-width:1px){.a{color:green}.a{color:green}}@layer x{.a{color:red}.a{color:red}}@keyframes x{0%{opacity:0}0%{opacity:0}}';
  assert.equal(compactLiveShellStyles(css), '.b{color:blue}.a{color:red}@media(max-width:1px){.a{color:green}}@layer x{.a{color:red}.a{color:red}}@keyframes x{0%{opacity:0}0%{opacity:0}}');
});
