// Safe anonymous GET checks. No login, email, media upload or account mutation is submitted.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/production-regression";
const rows = [];
const documentPaths = ["/", "/?city=Las%20Vegas&view=tonight", "/?city=Las%20Vegas&view=venues", "/dancers/layout-review-09", "/venues/deja-vu-showgirls", "/tv", "/?auth=login", "/account", "/account?role=dancer&mode=signup", "/account?role=venue", "/dashboard/customer", "/dashboard/dancer", "/dashboard/venue", "/account/reset-password", "/auth/callback"];
async function read(path) {
  let url = new URL(path, base);
  const redirects = [];
  for (let hop = 0; hop < 6; hop++) {
    assert.equal(url.origin, new URL(base).origin, "Navigation must stay on the application origin");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30000), credentials: "omit" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      assert.ok(response.headers.get("location"));
      redirects.push({ status: response.status, path: url.pathname });
      url = new URL(response.headers.get("location"), url);
      await response.body?.cancel();
    } else return { response, url, redirects };
  }
  throw new Error("Too many redirects");
}
try {
  for (const path of documentPaths) {
    const { response, url, redirects } = await read(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<body[\s>]/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const policy = response.headers.get("content-security-policy") || "";
    const privatePage = path.startsWith("/dashboard/") || path === "/account/reset-password";
    if (privatePage) {
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      assert.match(policy, /script-src[^;]*'nonce-[^']+'/);
      assert.doesNotMatch(policy.match(/script-src[^;]*/)?.[0] || "", /'unsafe-inline'/);
    }
    if (path === "/account" || path.startsWith("/account?")) {
      assert.equal(url.pathname, "/", "Old account entries must resolve into the current shell");
      assert.ok(url.searchParams.has("auth") || url.searchParams.has("venueAccess"));
    }
    if (path === "/auth/callback") {
      assert.match(policy, /'sha256-/);
      assert.match(response.headers.get("cache-control") || "", /no-store/);
    }
    rows.push({ path, status: response.status, finalPath: url.pathname, redirects, privatePolicyChecked: privatePage });
  }
  for (const path of ["/api/customer/saved", "/api/account", "/api/dancer/profile", "/api/venue/profile"]) {
    const { response } = await read(path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    await response.body?.cancel();
    rows.push({ path, status: response.status, anonymousAccessDenied: true });
  }
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/results.json`, JSON.stringify({ base, readOnly: true, rows }, null, 2));
}
console.log(JSON.stringify({ passed: true, documents: documentPaths.length, privateApis: 4 }));
