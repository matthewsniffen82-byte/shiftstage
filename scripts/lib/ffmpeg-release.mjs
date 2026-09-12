// Reviewed 2026-09-12. Month-end BtbN builds are retained for two years.
// https://ffmpeg.org/download.html links this distributor; never float to latest.
const release = "autobuild-2026-08-31-13-27";
const version = "n8.1.2-50-g1a748fe2cd";
const source = "https://github.com/BtbN/FFmpeg-Builds";

export const FFMPEG_RELEASES = Object.freeze({
  "linux-x64": Object.freeze({
    version, release, source,
    archive: `ffmpeg-${version}-linux64-gpl-8.1.tar.xz`,
    archiveBytes: 125758156,
    archiveSha256: "c733b4b2951e5957e15505f788b2c65a7a41b6da4b289e295852cc38079b4d2b",
    directory: `ffmpeg-${version}-linux64-gpl-8.1`,
    binary: "ffmpeg",
    binaryBytes: 145410576,
    binarySha256: "ad7a8c8e8fe4f50972f32f63705cfcc57f44cd3531f57aa8defe388372242f5e",
  }),
  "win32-x64": Object.freeze({
    version, release, source,
    archive: `ffmpeg-${version}-win64-gpl-8.1.zip`,
    archiveBytes: 168259078,
    archiveSha256: "273abb45f3f9f76c303e35ff39f5bb6c23c163ae65f6244a32b7d4a7f6cf0616",
    directory: `ffmpeg-${version}-win64-gpl-8.1`,
    binary: "ffmpeg.exe",
    binaryBytes: 144442368,
    binarySha256: "19121c4a9dece4780f33e6cfc2ba58e36347d4c64f0df4efc05a6959a8191aa6",
  }),
});

export function ffmpegRelease(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!Object.hasOwn(FFMPEG_RELEASES, key)) {
    throw new Error("A reviewed FFmpeg build is required for this platform. Supported: Windows x64 and Linux x64.");
  }
  return FFMPEG_RELEASES[key];
}
