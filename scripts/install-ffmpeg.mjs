import { assertSupportedNodeRuntime } from "../src/lib/security/node-runtime.mjs";
import { installVerifiedFfmpeg } from "./lib/verified-ffmpeg.mjs";

assertSupportedNodeRuntime();
await installVerifiedFfmpeg();
console.log("FFMPEG_VERIFIED_INSTALL_COMPLETE");
