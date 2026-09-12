import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FFMPEG_RELEASES, ffmpegRelease } from "../scripts/lib/ffmpeg-release.mjs";
import {
  downloadPinnedArchive, ffmpegInstallTarget, installVerifiedFfmpeg, matchesPinnedFile,
} from "../scripts/lib/verified-ffmpeg.mjs";
import { assertSupportedNodeRuntime } from "../src/lib/security/node-runtime.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
async function fixture(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "mydancr-native-dependency-test-"));
  try { await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function responseFor(body, options = {}) {
  const response = new Response(body, { status: options.status ?? 200, headers: options.headers });
  Object.defineProperty(response, "url", { value: options.url ?? "https://release-assets.githubusercontent.com/reviewed-asset" });
  return response;
}
const bytes = Buffer.from("synthetic archive, never executable");
const sampleRelease = {
  source: "https://github.com/BtbN/FFmpeg-Builds", release: "pinned", archive: "fixture.tar.xz",
  archiveBytes: bytes.length, archiveSha256: digest(bytes),
};

for (const version of ["24.18.1", "24.18.2", "24.19.0", "24.21.0", "24.99.0"]) {
  test(`patched Node runtime ${version} is accepted`, () => assert.doesNotThrow(() => assertSupportedNodeRuntime(version)));
}
for (const version of ["24.16.0", "24.17.0", "24.18.0", "22.23.2", "20.0.0", "25.0.0", "26.8.2", "24.21.0-rc.1", "24.21", "24.21.0\n", "invalid"]) {
  test(`unreviewed or vulnerable Node runtime ${JSON.stringify(version)} is rejected`, () => assert.throws(() => assertSupportedNodeRuntime(version), /Node.js 24.18.1/));
}
for (const [platform, arch] of [["linux", "arm64"], ["darwin", "x64"], ["win32", "ia32"], ["toString", "x64"]]) {
  test(`unsupported native platform ${platform}-${arch} has no legacy fallback`, () => assert.throws(() => ffmpegRelease(platform, arch), /reviewed FFmpeg/));
}
for (const [key, release] of Object.entries(FFMPEG_RELEASES)) {
  test(`${key} locks the archive and executable independently`, () => {
    assert.equal(release.version, "n8.1.2-50-g1a748fe2cd");
    assert.equal(release.release, "autobuild-2026-08-31-13-27");
    assert.match(release.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(release.binarySha256, /^[a-f0-9]{64}$/);
    assert.notEqual(release.archiveSha256, release.binarySha256);
    assert.ok(release.archiveBytes > 0 && release.binaryBytes > 0);
    assert.ok(Object.isFrozen(release));
  });
}
test("file verification checks content, size, absence and regular file type", () => fixture(async directory => {
  const target = path.join(directory, "sample");
  assert.equal(await matchesPinnedFile(target, bytes.length, digest(bytes)), false);
  await writeFile(target, bytes);
  assert.equal(await matchesPinnedFile(target, bytes.length, digest(bytes)), true);
  assert.equal(await matchesPinnedFile(target, bytes.length + 1, digest(bytes)), false);
  assert.equal(await matchesPinnedFile(target, bytes.length, "0".repeat(64)), false);
  assert.equal(await matchesPinnedFile(directory, bytes.length, digest(bytes)), false);
}));
test("verified download retains exact bytes and selects the pinned release URL", () => fixture(async directory => {
  const target = path.join(directory, "archive");
  await downloadPinnedArchive(sampleRelease, target, async (url, options) => {
    assert.equal(url, "https://github.com/BtbN/FFmpeg-Builds/releases/download/pinned/fixture.tar.xz");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, "manual");
    return responseFor(bytes, { headers: { "content-length": String(bytes.length) } });
  });
  assert.deepEqual(await readFile(target), bytes);
}));
test("approved redirects are followed only after validation", () => fixture(async directory => {
  const seen = [];
  await downloadPinnedArchive(sampleRelease, path.join(directory, "archive"), async (url, options) => {
    assert.equal(options.redirect, "manual"); seen.push(url);
    return seen.length === 1
      ? responseFor(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/pinned" } })
      : responseFor(bytes);
  });
  assert.deepEqual(seen, ["https://github.com/BtbN/FFmpeg-Builds/releases/download/pinned/fixture.tar.xz", "https://release-assets.githubusercontent.com/pinned"]);
}));
for (const location of ["http://github.com/archive", "https://attacker.invalid/archive", "http://169.254.169.254/metadata", "https://github.com:8443/archive", "https://user:secret@github.com/archive"]) {
  test(`unapproved redirect is rejected before the next request: ${location}`, () => fixture(async directory => {
    let requests = 0;
    await assert.rejects(downloadPinnedArchive(sampleRelease, path.join(directory, "archive"), async () => {
      requests++; return responseFor(null, { status: 302, headers: { location } });
    }), /FFmpeg download/);
    assert.equal(requests, 1);
  }));
}
test("redirect loops stop within four requests", () => fixture(async directory => {
  let requests = 0;
  await assert.rejects(downloadPinnedArchive(sampleRelease, path.join(directory, "archive"), async () => {
    requests++; return responseFor(null, { status: 307, headers: { location: "/again" } });
  }), /redirect policy/);
  assert.equal(requests, 4);
}));
test("redirects without a location fail closed", () => fixture(async directory => {
  await assert.rejects(downloadPinnedArchive(sampleRelease, path.join(directory, "archive"), async () => responseFor(null, { status: 302 })), /redirect policy/);
}));
for (const [label, response] of [
  ["failed HTTP", () => responseFor(bytes, { status: 502 })],
  ["unapproved redirect host", () => responseFor(bytes, { url: "https://attacker.invalid/archive" })],
  ["insecure redirect", () => responseFor(bytes, { url: "http://github.com/archive" })],
  ["credential-bearing URL", () => responseFor(bytes, { url: "https://user:secret@github.com/archive" })],
  ["declared oversize", () => responseFor(bytes, { headers: { "content-length": String(bytes.length + 1) } })],
  ["declared undersize", () => responseFor(bytes, { headers: { "content-length": "1" } })],
  ["invalid declared size", () => responseFor(bytes, { headers: { "content-length": "unknown" } })],
  ["undeclared oversize", () => responseFor(Buffer.concat([bytes, Buffer.from("x")]))],
  ["undeclared truncation", () => responseFor(bytes.subarray(1))],
  ["same-size corruption", () => responseFor(Buffer.alloc(bytes.length))],
]) test(`download rejects ${label}`, () => fixture(async directory => {
  await assert.rejects(downloadPinnedArchive(sampleRelease, path.join(directory, "archive"), async () => response()), /FFmpeg/);
}));
test("download does not overwrite an existing destination", () => fixture(async directory => {
  const target = path.join(directory, "archive");
  await writeFile(target, "preserve");
  await assert.rejects(downloadPinnedArchive(sampleRelease, target, async () => responseFor(bytes)), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "preserve");
}));
async function wrapperAt(root, version = "5.3.0") {
  const directory = path.join(root, "node_modules", "ffmpeg-static");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "ffmpeg-static", version }));
  return directory;
}
test("installed path remains compatible with the application's existing wrapper", () => fixture(async root => {
  const directory = await wrapperAt(root);
  const release = ffmpegRelease();
  assert.equal(await ffmpegInstallTarget(root, release, {}), path.join(directory, release.binary));
}));
for (const variable of ["FFMPEG_BIN", "FFMPEG_BINARY_RELEASE", "FFMPEG_BINARIES_URL"]) {
  test(`${variable} cannot bypass the pinned dependency`, () => fixture(async root => {
    await wrapperAt(root);
    await assert.rejects(ffmpegInstallTarget(root, ffmpegRelease(), { [variable]: "unreviewed" }), /overrides/);
  }));
}
test("an unreviewed wrapper version is rejected", () => fixture(async root => {
  await wrapperAt(root, "5.4.0");
  await assert.rejects(ffmpegInstallTarget(root, ffmpegRelease(), {}), /reviewed version/);
}));
test("a failed install never extracts unverified content or replaces the previous binary", () => fixture(async root => {
  const directory = await wrapperAt(root);
  const target = path.join(directory, ffmpegRelease().binary);
  await writeFile(target, "previous binary");
  let extracts = 0;
  await assert.rejects(installVerifiedFfmpeg({ root,
    fetchImpl: async () => responseFor(bytes),
    extract: async () => { extracts++; },
  }), /FFmpeg archive failed/);
  assert.equal(extracts, 0);
  assert.equal(await readFile(target, "utf8"), "previous binary");
}));
