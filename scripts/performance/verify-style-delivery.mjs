import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extractLiveShellStyles } from "../../src/lib/dancr/live-shell-styles.mjs";
import { versionedStaticAssetUrl } from "../../src/lib/dancr/static-asset-cache.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/style-delivery";
await mkdir(output, { recursive: true });
const html = (await readFile("outputs/index.html", "utf8")).replace(/\r\n?/g, "\n");
const original = extractLiveShellStyles(html);
const built = await readFile("public/outputs/live-shell.css", "utf8");
const url = versionedStaticAssetUrl("/outputs/live-shell.css");
const response = await fetch(base + url);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type"), /text\/css/);
assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
const deployed = await response.text();
assert.equal(deployed, built);
const documentResponse = await fetch(base);
assert.equal(documentResponse.headers.get("link"), `<${url}>; rel=preload; as=style`);
const document = await documentResponse.text();
assert.ok(document.includes(`href="${url}"`));
assert.ok(!document.includes(original));
for (const suffix of ["", "?v=obsolete-version"]) {
  const obsolete = await fetch(`${base}/outputs/live-shell.css${suffix}`, { method: "HEAD" });
  assert.equal(obsolete.status, 200);
  assert.equal(obsolete.headers.get("cache-control"), "public, max-age=0, must-revalidate");
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ original, deployed }) => {
    const before = new CSSStyleSheet(), after = new CSSStyleSheet();
    before.replaceSync(original); after.replaceSync(deployed);
    const a = [...before.cssRules].map(rule => rule.cssText), b = [...after.cssRules].map(rule => rule.cssText);
    return { originalRules: a.length, deployedRules: b.length, changedRules: a.filter((rule, index) => rule !== b[index]).length };
  }, { original, deployed });
  assert.equal(result.originalRules, result.deployedRules);
  assert.equal(result.changedRules, 0);
  await writeFile(`${output}/results.json`, JSON.stringify({ url, originalBytes: Buffer.byteLength(original), deployedBytes: Buffer.byteLength(deployed), ...result }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
