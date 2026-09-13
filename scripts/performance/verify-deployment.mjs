import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { LIVE_SHELL_SCRIPT_SHA256 } from "../../src/generated/live-shell-script-version.mjs";
import { LIVE_SHELL_FEATURE_VERSIONS } from "../../src/generated/live-shell-feature-versions.mjs";

const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/deployed-health";
const source = (await readFile("outputs/index.html", "utf8")).replace(/\r\n?/g, "\n");
const version = createHash("sha256").update(source).digest("hex");
const homepage = await fetch(base, { cache: "no-store" });
assert.equal(homepage.status, 200);
const html = await homepage.text();
assert.equal(homepage.headers.get("x-dancr-live-shell-version"), version, "live home matches validated source");
assert.equal(homepage.headers.get("x-dancr-live-shell-script-version"), LIVE_SHELL_SCRIPT_SHA256);
assert.ok(html.includes(`/live-shell.js?v=${LIVE_SHELL_SCRIPT_SHA256}`));
const response = await fetch(`${base}/live-shell.js?v=${LIVE_SHELL_SCRIPT_SHA256}`);
assert.equal(response.status, 200);
const delivered = await response.text();
assert.equal(delivered, await readFile("outputs/live-shell-app.js", "utf8"));
const features = [];
for (const [feature, hash] of Object.entries(LIVE_SHELL_FEATURE_VERSIONS)) {
  const chunk = await fetch(`${base}/live-shell-feature.js?feature=${feature}&v=${hash}`);
  assert.equal(chunk.status, 200);
  assert.equal(await chunk.text(), await readFile(`outputs/live-shell-${feature}.js`, "utf8"));
  assert.ok(chunk.headers.get("cache-control")?.includes("immutable"));
  features.push(feature);
}
assert.equal((await fetch(`${base}/live-shell-feature.js?feature=tv&v=obsolete`)).status, 404);
const catalog = await fetch(base + "/api/public/tv?city=Las%20Vegas&limit=12").then(response => response.json());
const clip = catalog.videos?.find(video => video.adaptiveUrl);
assert.ok(clip, "A prepared public clip is required for adaptive deployment verification");
const master = await fetch(new URL(clip.adaptiveUrl, base));
assert.equal(master.status, 200);
assert.ok(master.headers.get("cache-control")?.includes("private, no-store"));
const playlist = await master.text();
const adaptiveLevels = (playlist.match(/#EXT-X-STREAM-INF/g) || []).length;
assert.ok(adaptiveLevels >= 2);
assert.equal((playlist.match(/CODECS="avc1\.[a-f0-9]{6}(?:,mp4a\.40\.2)?"/g) || []).length, adaptiveLevels);
const health = [];
for (const endpoint of ["/api/health", "/api/health/supabase", "/api/public/cities"]) {
  const res = await fetch(base + endpoint);
  health.push({ endpoint, status: res.status });
  assert.equal(res.status, 200);
}
const privateResponse = await fetch(base + "/api/customer/saved");
assert.equal(privateResponse.status, 401);
assert.ok(privateResponse.headers.get("cache-control")?.includes("no-store"));
const report = {
  commit: process.env.PERF_COMMIT, base, shellVersion: version, scriptBytes: Buffer.byteLength(delivered),
  matchesValidatedSource: true, features, adaptiveLevels, health, anonymousPrivateAccess: privateResponse.status,
  privateCache: privateResponse.headers.get("cache-control"),
};
await mkdir(output, { recursive: true });
await writeFile(`${output}/health.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
