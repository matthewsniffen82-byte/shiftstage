import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyPublicBuild } from "../scripts/lib/public-build-security.mjs";

const config = () => ({ productionBrowserSourceMaps: false, typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false }, env: { DANCR_VIDEO_MODERATION_MODE: "ai" } });
async function put(root, file, text) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-build-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["public", ".next/static", ".next/server/app", ".next/server/pages", "outputs"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await put(root, ".next/required-server-files.json", JSON.stringify({ config: config() }));
  await put(root, ".next/routes-manifest.json", JSON.stringify({ headers: [] }));
  await put(root, "outputs/index.html", "<!doctype html><p>Public shell</p>");
  await put(root, "outputs/live-shell-app.js", 'console.log("Public shell");');
  return root;
}
const jwt = role => [Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from(JSON.stringify({ role })).toString("base64url"), "synthetic-signature"].join(".");
// Generate the deliberately synthetic credential shape without storing a key literal.
const syntheticStripeKey = ["sk", "live", "syntheticCredential123456789"].join("_");

test("inspects public assets and rendered data while preserving private server debugging files", async t => {
  const root = await fixture(t);
  await put(root, "public/app.js", `const config=${JSON.stringify({ key: jwt("anon"), publishable: "sb_publishable_fixture" })};`);
  await put(root, ".next/static/chunks/app.js", 'console.log("production");');
  await put(root, ".next/server/app/page.html", "<p>Safe page</p>");
  await put(root, ".next/server/app/page.rsc", "safe flight data");
  await put(root, ".next/server/pages/page.json", '{"public":true}');
  await put(root, ".next/server/app/page.js.map", "private server map");
  await put(root, ".next/server/app/page.js", jwt("service_role"));
  await put(root, ".next/server/pages/page.js.nft.json", jwt("service_role"));
  const result = await verifyPublicBuild({ root });
  assert.equal(result.files, 7);
  assert.equal(result.textFiles, 7);
  assert.ok(result.textBytes > 0);
});

for (const file of ["public/.env.local", "public/.git/config", "public/nested/app.js.map",
  "public/nested/app.css.map.gz", "public/package-lock.json", "public/backup.sql", "public/client.tsx",
  ".next/static/chunks/app.js.map", ".next/static/chunks/key.pem"]) {
  test(`rejects unintended public file ${file}`, async t => {
    const root = await fixture(t);
    await put(root, file, "synthetic private material");
    await assert.rejects(verifyPublicBuild({ root }), /private file or source map/);
  });
}
for (const text of ["//# sourceMappingURL=app.js.map", "/*# sourceMappingURL=data:application/json;base64,e30= */",
  "//# sourceURL=internal.ts", 'eval("webpack-internal://fixture")']) {
  test(`rejects browser debug metadata ${text.split("=")[0]}`, async t => {
    const root = await fixture(t);
    await put(root, ".next/static/app.js", text);
    await assert.rejects(verifyPublicBuild({ root }), /browser debugging artifact/);
  });
}
for (const file of ["public/app.js", ".next/static/chunks/app.js", ".next/server/app/page.html",
  ".next/server/app/page.rsc", ".next/server/app/live-shell.body", ".next/server/pages/page.json",
  "outputs/index.html", "outputs/live-shell-app.js"]) {
  test(`rejects private values in ${file} without disclosure`, async t => {
    const root = await fixture(t);
    const secret = "synthetic-opaque-private-value:/+123\"\\\n";
    for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), Buffer.from(secret).toString("base64")]) {
      await put(root, file, `prefix ${value} suffix`);
      await assert.rejects(verifyPublicBuild({ root, environment: { INTERNAL_SECRET: secret } }), error => {
        assert.equal(error.message.includes(value), false);
        assert.equal(error.message.includes(file), false);
        return /private credential material/.test(error.message);
      });
    }
  });
}
for (const value of [jwt("service_role"), jwt("authenticated"), "sb_secret_syntheticCredential123456789",
  syntheticStripeKey, "-----BEGIN PRIVATE KEY-----"]) {
  test(`rejects unconfigured private format ${value.startsWith("eyJ") ? value.split(".")[1] : value.slice(0, 12)}`, async t => {
    const root = await fixture(t);
    await put(root, "public/app.js", value);
    await assert.rejects(verifyPublicBuild({ root }), /(?:private credential|non-public token) material/);
  });
}
for (const field of ["productionBrowserSourceMaps", "typescript", "eslint", "env"]) {
  test(`rejects unsafe emitted configuration ${field}`, async t => {
    const root = await fixture(t);
    const candidate = config();
    candidate[field] = { productionBrowserSourceMaps: true, typescript: { ignoreBuildErrors: true },
      eslint: { ignoreDuringBuilds: true }, env: { PRIVATE: "synthetic-private-value" } }[field];
    await put(root, ".next/required-server-files.json", JSON.stringify({ config: candidate }));
    await assert.rejects(verifyPublicBuild({ root }), /Public build security rejected/);
  });
}
test("a linked public directory is rejected without following it", async t => {
  const root = await fixture(t);
  await symlink(path.join(root, "outputs"), path.join(root, "public/linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verifyPublicBuild({ root }), /linked public artifact/);
});
test("oversized text assets fail before their contents are loaded", async t => {
  const root = await fixture(t);
  const file = await open(path.join(root, "public/large.js"), "w");
  try { await file.truncate(32 * 1024 * 1024 + 1); } finally { await file.close(); }
  await assert.rejects(verifyPublicBuild({ root }), /text asset exceeds inspection limit/);
});
test("missing output directories cannot silently reduce inspection coverage", async t => {
  const root = await fixture(t);
  await rm(path.join(root, ".next/static"), { recursive: true });
  await assert.rejects(verifyPublicBuild({ root }), { code: "ENOENT" });
});
test("malformed or incomplete build metadata fails closed", async t => {
  const root = await fixture(t);
  for (const text of ["{", "{}", '{"config":{}}']) {
    await put(root, ".next/required-server-files.json", text);
    await assert.rejects(verifyPublicBuild({ root }));
  }
});
test("an unsupported explicit moderation value cannot enter public output", async t => {
  const root = await fixture(t);
  const candidate = config();
  candidate.env.DANCR_VIDEO_MODERATION_MODE = "synthetic-unreviewed-value";
  await put(root, ".next/required-server-files.json", JSON.stringify({ config: candidate }));
  await assert.rejects(verifyPublicBuild({ root }), /invalid public moderation setting/);
});
for (const key of ["SourceMap", "x-SOURCEmap"]) {
  test(`rejects emitted ${key} response headers, including external map targets`, async t => {
    const root = await fixture(t);
    await put(root, ".next/routes-manifest.json", JSON.stringify({ headers: [
      { source: "/:path*", headers: [{ key, value: "https://fixture.invalid/private.map" }] },
    ] }));
    await assert.rejects(verifyPublicBuild({ root }), /source map response header/);
  });
}
test("a missing build fails closed and the CLI never prints paths or contents", async t => {
  const root = await fixture(t);
  await rm(path.join(root, ".next/required-server-files.json"));
  const cli = fileURLToPath(new URL("../scripts/check-public-build.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PUBLIC_BUILD_SECURITY_REJECTED/);
  assert.equal(result.stderr.includes(root), false);
});
test("the production command checks artifacts before npm can run postbuild maintenance", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.build, "next build && node scripts/check-public-build.mjs");
  assert.equal(pkg.scripts.postbuild, "node scripts/manage-layout-review-postbuild.mjs");
});
