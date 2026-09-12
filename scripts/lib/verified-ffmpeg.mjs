import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { ffmpegRelease } from "./ffmpeg-release.mjs";

const run = promisify(execFile);
const downloadHosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function approvedDownloadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !downloadHosts.has(url.hostname)
      || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("FFmpeg download failed its origin checks.");
  }
  return url;
}

export async function matchesPinnedFile(file, bytes, sha256) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size !== bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function downloadPinnedArchive(release, destination, fetchImpl = fetch) {
  let url = approvedDownloadUrl(`${release.source}/releases/download/${release.release}/${release.archive}`);
  const signal = AbortSignal.timeout(180_000);
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetchImpl(url.href, { signal, redirect: "manual" });
    if (!redirectStatuses.has(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3) throw new Error("FFmpeg download exceeded its reviewed redirect policy.");
    // Validate every hop before making a request to it, including relative URLs.
    url = approvedDownloadUrl(new URL(location, url));
  }
  try { approvedDownloadUrl(response.url); }
  catch (error) { await response.body?.cancel(); throw error; }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("FFmpeg download failed its origin or HTTP checks.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== release.archiveBytes) {
    await response.body.cancel();
    throw new Error("FFmpeg archive size did not match the reviewed release.");
  }
  let bytes = 0;
  const hash = createHash("sha256");
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > release.archiveBytes) return callback(new Error("FFmpeg archive exceeds its reviewed size."));
      hash.update(chunk);
      callback(null, chunk);
    },
  }), createWriteStream(destination, { flags: "wx" }));
  if (bytes !== release.archiveBytes || hash.digest("hex") !== release.archiveSha256) {
    throw new Error("FFmpeg archive failed SHA-256 verification.");
  }
}

export async function ffmpegInstallTarget(root, release, environment = process.env) {
  // ffmpeg-static's path-only wrapper is retained, but its downloader is disabled.
  // An environment override must not silently select a different executable.
  if (environment.FFMPEG_BIN || environment.FFMPEG_BINARY_RELEASE || environment.FFMPEG_BINARIES_URL) {
    throw new Error("Remove FFmpeg environment overrides; this application requires its reviewed binary.");
  }
  const directory = path.join(root, "node_modules", "ffmpeg-static");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("FFmpeg package directory must be a regular installed directory.");
  const wrapper = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (wrapper.name !== "ffmpeg-static" || wrapper.version !== "5.3.0") {
    throw new Error("The FFmpeg path wrapper differs from the reviewed version.");
  }
  return path.join(directory, release.binary);
}

export async function installVerifiedFfmpeg({ root = process.cwd(), platform, arch, fetchImpl = fetch, extract = run } = {}) {
  const release = ffmpegRelease(platform, arch);
  const target = await ffmpegInstallTarget(root, release);
  if (await matchesPinnedFile(target, release.binaryBytes, release.binarySha256)) return target;
  const temporaryRoot = path.resolve(tmpdir());
  const workspace = await mkdtemp(path.join(temporaryRoot, "mydancr-ffmpeg-install-"));
  const pending = `${target}.verified-install-${randomUUID()}`;
  try {
    const archive = path.join(workspace, release.archive);
    await downloadPinnedArchive(release, archive, fetchImpl);
    // Extract only named members from a digest-verified archive, never a wildcard.
    await extract("tar", ["-xf", archive, "-C", workspace,
      `${release.directory}/bin/${release.binary}`, `${release.directory}/LICENSE.txt`],
    { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 });
    const binary = path.join(workspace, release.directory, "bin", release.binary);
    if (!await matchesPinnedFile(binary, release.binaryBytes, release.binarySha256)) {
      throw new Error("Extracted FFmpeg binary failed SHA-256 verification.");
    }
    await copyFile(binary, pending);
    await chmod(pending, 0o755);
    await copyFile(path.join(workspace, release.directory, "LICENSE.txt"), path.join(path.dirname(target), "ffmpeg.LICENSE"));
    await writeFile(path.join(path.dirname(target), "ffmpeg.RELEASE.json"), JSON.stringify(release, null, 2) + "\n");
    await rename(pending, target);
    return target;
  } finally {
    await rm(pending, { force: true });
    if (path.dirname(path.resolve(workspace)) !== temporaryRoot
        || !path.basename(workspace).startsWith("mydancr-ffmpeg-install-")) {
      throw new Error("Unexpected FFmpeg temporary directory; cleanup was refused.");
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function verifyInstalledFfmpeg(root = process.cwd()) {
  const release = ffmpegRelease();
  const target = await ffmpegInstallTarget(root, release);
  if (!await matchesPinnedFile(target, release.binaryBytes, release.binarySha256)) {
    throw new Error("FFmpeg is missing or differs from the reviewed binary. Run npm run install:ffmpeg.");
  }
  return target;
}
