import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { staticAssetVersions } from "../src/generated/static-asset-versions.mjs";
import { staticAssetPaths } from "../src/lib/dancr/static-asset-paths.mjs";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";
import { externalizeLiveShellAppScript } from "../src/lib/dancr/live-shell-script.mjs";
import { IMMUTABLE_STATIC_CACHE, REVALIDATE_STATIC_CACHE, staticAssetCacheHeaders, versionedStaticAssetUrl, versionStaticAssetReferences } from "../src/lib/dancr/static-asset-cache.mjs";

test("every public static version matches its shipped content", async () => {
  assert.deepEqual(Object.keys(staticAssetVersions), staticAssetPaths);
  for (const asset of staticAssetPaths) {
    const bytes = await readFile(new URL(`../public${asset}`, import.meta.url));
    const content = /\.(css|js|svg)$/.test(asset) ? bytes.toString("utf8").replace(/\r\n?/g, "\n") : bytes;
    assert.equal(staticAssetVersions[asset], createHash("sha256").update(content).digest("hex").slice(0, 16), asset);
  }
});

test("only the current content version is immutable; mutable aliases revalidate", () => {
  const headers = staticAssetCacheHeaders();
  function policy(path, version) {
    return headers.filter(rule => rule.source === path && (!rule.has || rule.has.every(condition => condition.value === version))).at(-1)?.headers[0].value;
  }
  for (const asset of staticAssetPaths) {
    assert.equal(policy(asset), REVALIDATE_STATIC_CACHE);
    assert.equal(policy(asset, "obsolete-version"), REVALIDATE_STATIC_CACHE);
    assert.equal(policy(asset, staticAssetVersions[asset]), IMMUTABLE_STATIC_CACHE);
  }
  assert.equal(policy("/api/customer/dashboard"), undefined);
  assert.equal(policy("/outputs/dancr-hero-480-10b0c648e5b6.webp"), IMMUTABLE_STATIC_CACHE);
});

test("HTML versioning preserves inline code, CSS, signed media, external URLs and app script", () => {
  const asset = "/profile-photo-crop.js";
  const versioned = versionedStaticAssetUrl(asset);
  assert.equal(versionedStaticAssetUrl(`${asset}?v=1`), versioned);
  const inline = `<script>const template = '<img src="${asset}">';</script><style>.a { content: '<img src="${asset}">'; }</style>`;
  const unchanged = `<script src="/live-shell.js?v=abc" defer></script><img src="https://media.example/x?token=private"><a href="/api/customer/dashboard">Account</a>`;
  const input = `<script src="${asset}?v=1" defer></script><img src='${asset}'>${inline}${unchanged}`;
  assert.equal(versionStaticAssetReferences(input), `<script src="${versioned}" defer></script><img src='${versioned}'>${inline}${unchanged}`);
  assert.equal(versionedStaticAssetUrl(`https://example.com${asset}`), `https://example.com${asset}`);
  assert.equal(versionedStaticAssetUrl("//example.com/asset.js"), "//example.com/asset.js");
});

test("versioning the actual deployed shell leaves its inline CSP hashes unchanged", async () => {
  const source = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
  const shell = externalizeLiveShellAppScript(source, "/live-shell.js?v=current");
  const versioned = versionStaticAssetReferences(shell);
  assert.equal(createRootContentSecurityPolicy(versioned), createRootContentSecurityPolicy(shell));
  for (const asset of ["/mydancr-api-transport.js", "/profile-photo-crop.js", "/dancr-aesthetic.v1.css"]) {
    assert.ok(versioned.includes(versionedStaticAssetUrl(asset)), asset);
  }
});
