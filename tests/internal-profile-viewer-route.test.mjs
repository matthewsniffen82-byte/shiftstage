import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";

const require = createRequire(import.meta.url);
const id = "00000000-0000-4000-8000-000000000001";
const shell = '<html><head><script>void 0;</script></head><body>Shared profile viewer</body></html>';
const publicPolicy = createRootContentSecurityPolicy(shell);
function compile(file) {
  return ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
function fixture(policy = publicPolicy) {
  const headers = new Headers({ "content-security-policy": policy, "cache-control": "public, max-age=30", "x-frame-options": "DENY" });
  let renders = 0;
  const exports = {};
  vm.runInNewContext(compile("app/internal/profile-viewer/route.ts"), {
    exports, URL, Response, Headers, Error,
    require(name) {
      assert.equal(name, "../../route");
      return { GET: async () => { renders++; return new Response(shell, { headers }); } };
    },
  });
  return { headers, get: query => exports.GET(new Request(`https://example.invalid/internal/profile-viewer${query}`)), renders: () => renders };
}

test("the Internal frame loads the actual shell with same-origin-only framing", async () => {
  const f = fixture();
  const result = await f.get(`?internal_profile=${id}`);
  assert.equal(result.status, 200);
  const html = await result.text();
  assert.equal(html.replace(/<style id="internal-profile-viewport">[\s\S]*?<\/style>/, ""), shell);
  assert.equal(result.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(result.headers.get("content-security-policy"), publicPolicy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  assert.equal(createRootContentSecurityPolicy(html), publicPolicy, "Viewport styles preserve the shell's script hashes");
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
  assert.equal(result.headers.get("x-robots-tag"), "noindex, nofollow");
  for (const header of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) assert.match(result.headers.get(header), /no-store/);
  assert.equal(f.headers.get("content-security-policy"), publicPolicy, "Public shell framing stays blocked");
  assert.equal(f.headers.get("x-frame-options"), "DENY");
  assert.equal(f.headers.get("cache-control"), "public, max-age=30");
});

test("missing or malformed profile IDs do not render a frame", async () => {
  const f = fixture();
  for (const query of ["", "?internal_profile=", "?internal_profile=invalid", "?internal_profile=https://other.invalid"]) {
    assert.equal((await f.get(query)).status, 400);
  }
  assert.equal(f.renders(), 0);
});

test("an unexpected source framing policy fails closed", async () => {
  const f = fixture("default-src 'self'");
  await assert.rejects(f.get(`?internal_profile=${id}`), /framing policy is unavailable/);
});

test("the roster embeds the dedicated viewer without putting its club token in HTML", () => {
  const exports = {};
  vm.runInNewContext(compile("app/internal/InternalFullProfile.tsx"), {
    exports, require: name => require(name),
  });
  const markup = renderToStaticMarkup(React.createElement(exports.InternalFullProfile, {
    profile: { id, stage_name: "Demo dancer", photos: [], videos: [], socialLinks: [] },
    token: "private-club-capability", onClose() {},
  }));
  assert.match(markup, new RegExp(`src="/internal/profile-viewer\\?internal_profile=${id}"`));
  assert.match(markup, /referrerPolicy="no-referrer"/i);
  assert.doesNotMatch(markup, /private-club-capability|token=/);
});
