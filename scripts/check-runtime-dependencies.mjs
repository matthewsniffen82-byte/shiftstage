import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSupportedNodeRuntime } from "../src/lib/security/node-runtime.mjs";
import { verifyInstalledFfmpeg } from "./lib/verified-ffmpeg.mjs";
import { ffmpegRelease } from "./lib/ffmpeg-release.mjs";

assertSupportedNodeRuntime();
const binary = await verifyInstalledFfmpeg();
// Exercise the real platform executable with synthetic pixels only. This also
// catches incompatible Linux native libraries during the Vercel build.
await promisify(execFile)(binary, [
  "-hide_banner", "-loglevel", "error", "-threads", "1",
  "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.04",
  "-frames:v", "1", "-c:v", "libx264", "-f", "null", "-",
], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
console.log(`RUNTIME_DEPENDENCIES_VERIFIED node=${process.versions.node} ffmpeg=${ffmpegRelease().version}`);
